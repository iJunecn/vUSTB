"""Anyshare proxy: list shared files and obtain download URLs.

Provides a public (no-auth) API for the launcher page to browse and download
files from an Anyshare (爱数) shared link without exposing the share token
or internal API details to the client.

Flow:
1. Client calls GET /api/anyshare/files  →  returns file list
2. Client calls GET /api/anyshare/download?docid=xxx&name=yyy  →  returns JSON with download URL
   Frontend opens the URL directly, bypassing Next.js client-side routing.
"""
from __future__ import annotations

import re
from typing import Any, List, Optional
from urllib.parse import quote

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(prefix="/api/anyshare", tags=["anyshare"])

# ── Config ──────────────────────────────────────────────────────────
SHARE_LINK = "https://yunpan.ustb.edu.cn/link/AAF5802B84E3874E8C8A49F6F42B9CA875"
BASE_URL = "https://yunpan.ustb.edu.cn"
API_TIMEOUT = 30
DOWNLOAD_TIMEOUT = 3600

# ── Helpers ─────────────────────────────────────────────────────────

def _extract_link_id(link_url: str) -> str:
    m = re.search(r"/link/([A-Za-z0-9]{30,64})", link_url)
    if not m:
        raise ValueError("Could not find link id in URL")
    return m.group(1)


def _api_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "X-Requested-With": "XMLHttpRequest",
    }


def _api_url(path: str) -> str:
    if path.startswith("/"):
        path = path[1:]
    return f"{BASE_URL}/api/{path}"


async def _ensure_token() -> str:
    """Visit the share link to obtain a link_token cookie, then return it."""
    link_id = _extract_link_id(SHARE_LINK)
    cookie_name = f"link_token:{link_id}"

    async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
        # Visit the share page to get the cookie set
        resp = await client.get(SHARE_LINK, follow_redirects=True)
        token = None
        for cookie in client.cookies.jar:
            if cookie.name == cookie_name:
                token = cookie.value
                break
        if not token:
            alt_url = f"{BASE_URL}/anyshare/zh-cn/link/{link_id}"
            await client.get(alt_url, follow_redirects=True)
            for cookie in client.cookies.jar:
                if cookie.name == cookie_name:
                    token = cookie.value
                    break
    if not token:
        raise HTTPException(502, "Failed to obtain Anyshare link token")
    return token


async def _get_entry_item(token: str) -> dict:
    async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
        resp = await client.get(
            _api_url("efast/v1/entry-item"),
            headers=_api_headers(token),
        )
        resp.raise_for_status()
        data = resp.json()
        if not isinstance(data, list) or not data:
            raise HTTPException(502, "Entry item not found in share link")
        return data[0]


async def _list_folder(token: str, folder_docid: str) -> tuple[list, list]:
    dirs: list = []
    files: list = []
    marker = ""
    async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
        while True:
            params = {
                "limit": "100",
                "sort": "name",
                "direction": "asc",
                "permission_attributes_required": "false",
            }
            if marker:
                params["marker"] = marker
            encoded = quote(folder_docid, safe="")
            resp = await client.get(
                _api_url(f"efast/v1/folders/{encoded}/sub_objects"),
                params=params,
                headers=_api_headers(token),
            )
            resp.raise_for_status()
            data = resp.json()
            dirs.extend(data.get("dirs") or [])
            files.extend(data.get("files") or [])
            marker = data.get("next_marker") or ""
            if not marker:
                break
    return dirs, files


async def _get_download_url(token: str, docid: str, savename: str) -> tuple[str, str]:
    """Return (method, download_url) for the given file."""
    async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
        resp = await client.post(
            _api_url("efast/v1/file/osdownload"),
            json={
                "docid": docid,
                "authtype": "1",
                "savename": savename,
                "usehttps": True,
            },
            headers=_api_headers(token),
        )
        resp.raise_for_status()
        data = resp.json()
        authrequest = data.get("authrequest")
        if not isinstance(authrequest, list) or len(authrequest) < 2:
            raise HTTPException(502, "Unexpected download authrequest format")
        method = authrequest[0] or "GET"
        url = authrequest[1]
        return method, url


# ── Models ──────────────────────────────────────────────────────────

class FileItem(BaseModel):
    name: str
    docid: str
    size: Optional[int] = None
    rev: Optional[str] = None


class FileListResponse(BaseModel):
    files: List[FileItem]


class DownloadUrlResponse(BaseModel):
    method: str
    url: str


# ── Endpoints ───────────────────────────────────────────────────────

@router.get("/files", response_model=FileListResponse)
async def list_files():
    """List downloadable files from the USTBL Anyshare share link."""
    token = await _ensure_token()
    entry = await _get_entry_item(token)
    if entry.get("type") != "folder":
        raise HTTPException(502, "The shared item is not a folder")
    root_docid = entry.get("docid") or entry.get("id")
    if not root_docid:
        raise HTTPException(502, "Root folder docid not found")

    _, files = await _list_folder(token, root_docid)
    items = []
    for f in files:
        docid = f.get("docid") or f.get("id")
        if not docid:
            continue
        items.append(FileItem(
            name=f.get("name", "unknown"),
            docid=docid,
            size=f.get("size"),
            rev=f.get("rev"),
        ))
    return FileListResponse(files=items)


@router.get("/download", response_model=DownloadUrlResponse)
async def get_download_url(
    docid: str = Query(..., description="File docid from file list"),
    name: str = Query(..., description="File name for download"),
):
    """Get download URL as JSON. Frontend opens the URL directly to start download."""
    token = await _ensure_token()
    method, url = await _get_download_url(token, docid, name)
    return DownloadUrlResponse(method=method.upper(), url=url)
