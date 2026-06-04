"""Unified GitHub OAuth callback endpoint.

Caddy routes /oauth/* to the backend. This module handles the /oauth/redirect
path which is configured as the GitHub OAuth App's callback URL.

It delegates to the _handle_github_callback function in oauth_login.py.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.routers.oauth_login import _handle_github_callback

router = APIRouter(tags=["oauth_redirect"])


@router.get("/oauth/redirect")
async def github_oauth_redirect(
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Unified GitHub OAuth callback — dispatches to login or bind handler."""
    return await _handle_github_callback(code, state, error, db)
