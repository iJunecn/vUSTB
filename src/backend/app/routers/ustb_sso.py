"""USTB 统一验证登录绑定 — 微信扫码认证，获取姓名和学号。

基于 USTB-SSO 库 (https://pypi.org/project/USTB-SSO/) 的正确认证流程实现。

核心流程（参考库的 QrAuthProcedure）：
1. GET authenticate  → 获取 lck（登录上下文）
2. POST queryAuthMethods → 获取认证方法 + userName（学号）
3. POST getMicroQr → 获取微信二维码参数
4. GET qrpage → 获取 sid
5. 前端展示二维码，轮询 GET sis.ustb.edu.cn/connect/state
6. 扫码成功 → 获取 pass_code
7. GET return_url + params → 获取认证重定向页面
8. 从页面解析 actionType/locationValue → GET locationValue 完成认证
9. 从最终页面提取用户信息（姓名、学号）

重要发现：queryAuthMethods 响应中的 userName 字段就是学号！

⚠️ 多 worker 注意：gunicorn 多进程不共享内存，所有会话数据必须存 Redis。
"""
import asyncio
import logging
import re
import secrets
import time
from html import unescape
from urllib.parse import parse_qs, unquote, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.services.auth import create_jwt
from app.utils.redis import get_json, set_json, delete

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ustb-sso", tags=["ustb_sso"])

# ---------------------------------------------------------------------------
# SSO 常量 URL（来自 USTB-SSO 库 _procedure.py）
# ---------------------------------------------------------------------------
_SSO_AUTH_ENTRY = "https://sso.ustb.edu.cn/idp/authCenter/authenticate"
_SSO_QUERY_AUTH_METHODS = "https://sso.ustb.edu.cn/idp/authn/queryAuthMethods"
_SSO_QR_INFO = "https://sso.ustb.edu.cn/idp/authn/getMicroQr"
_SIS_QR_PAGE = "https://sis.ustb.edu.cn/connect/qrpage"
_SIS_QR_IMG = "https://sis.ustb.edu.cn/connect/qrimg"
_SIS_QR_STATE = "https://sis.ustb.edu.cn/connect/state"

# 使用预设参数 (CHAT_USTB_EDU_CN)
_ENTITY_ID = "YW2025007"
_REDIRECT_URI = (
    "http://chat.ustb.edu.cn/common/actionCasLogin"
    "?redirect_url=http%3A%2F%2Fchat.ustb.edu.cn%2Fpage%2Fsite%2FnewPc%3Flogin_return%3Dtrue"
)
_STATE = "ustb"

# 超时
_SESSION_TIMEOUT = 180  # 3 分钟
_HTTP_TIMEOUT = 10      # 单个 HTTP 请求超时（秒）
_COMPLETE_TIMEOUT = 30  # complete_auth 中关键请求的超时（秒）

# Redis key 前缀
_BIND_KEY_PREFIX = "ustb_sso:bind:"
_LOGIN_KEY_PREFIX = "ustb_sso:login:"


# ---------------------------------------------------------------------------
# httpx Client Cookie 序列化（跨 worker 共享 session cookies）
# ---------------------------------------------------------------------------


def _serialize_cookies(client: httpx.Client) -> list[dict]:
    """从 httpx.Client 提取 cookies 为 JSON 可序列化的列表。"""
    cookies = []
    for cookie in client.cookies.jar:
        cookies.append({
            "name": cookie.name,
            "value": cookie.value,
            "domain": cookie.domain,
            "path": cookie.path,
        })
    return cookies


def _create_client_with_cookies(cookies: list[dict] | None = None) -> httpx.Client:
    """创建 httpx.Client 并可选地设置预存储的 cookies。"""
    client = httpx.Client(timeout=_HTTP_TIMEOUT, follow_redirects=False)
    if cookies:
        for c in cookies:
            client.cookies.set(c["name"], c["value"], domain=c.get("domain", ""), path=c.get("path", "/"))
    return client


# ---------------------------------------------------------------------------
# Redis 会话存储辅助
# ---------------------------------------------------------------------------


async def _save_bind_session(session_id: str, data: dict) -> None:
    """保存绑定模式会话到 Redis，TTL = _SESSION_TIMEOUT。"""
    await set_json(f"{_BIND_KEY_PREFIX}{session_id}", data, ex=_SESSION_TIMEOUT)


async def _load_bind_session(session_id: str) -> dict | None:
    """从 Redis 读取绑定模式会话。"""
    return await get_json(f"{_BIND_KEY_PREFIX}{session_id}")


async def _delete_bind_session(session_id: str) -> None:
    """删除绑定模式会话。"""
    await delete(f"{_BIND_KEY_PREFIX}{session_id}")


async def _save_login_session(session_id: str, data: dict) -> None:
    """保存登录模式会话到 Redis，TTL = _SESSION_TIMEOUT。"""
    await set_json(f"{_LOGIN_KEY_PREFIX}{session_id}", data, ex=_SESSION_TIMEOUT)


async def _load_login_session(session_id: str) -> dict | None:
    """从 Redis 读取登录模式会话。"""
    return await get_json(f"{_LOGIN_KEY_PREFIX}{session_id}")


async def _delete_login_session(session_id: str) -> None:
    """删除登录模式会话。"""
    await delete(f"{_LOGIN_KEY_PREFIX}{session_id}")


# ---------------------------------------------------------------------------
# 同步 SSO 操作（在 asyncio.to_thread 中执行）
# ---------------------------------------------------------------------------


def _sso_init_sync() -> tuple[str, str, list[dict], dict]:
    """同步执行 SSO 初始化流程。

    返回 (session_id, qr_url, cookies, session_data)。
    注意：不再返回 httpx.Client，而是返回序列化的 cookies。
    """
    client = httpx.Client(timeout=_HTTP_TIMEOUT, follow_redirects=False)

    # Step 1: 获取 lck（与库 _retrieve_auth_entry 一致）
    logger.debug("SSO init step 1: GET authenticate")
    try:
        rsp = client.get(
            _SSO_AUTH_ENTRY,
            params={
                "client_id": _ENTITY_ID,
                "redirect_uri": _REDIRECT_URI,
                "login_return": "true",
                "state": _STATE,
                "response_type": "code",
            },
            follow_redirects=False,
        )
    except httpx.TimeoutException as e:
        raise RuntimeError("连接 USTB 统一认证服务器超时，请检查网络后重试") from e
    except httpx.ConnectError as e:
        raise RuntimeError("无法连接 USTB 统一认证服务器，请检查网络") from e

    if rsp.status_code // 100 != 3:
        raise RuntimeError(f"SSO auth entry returned HTTP {rsp.status_code}, expected 3xx")

    location = rsp.headers.get("Location", "")
    if not location:
        raise RuntimeError("Missing Location header in SSO auth entry response")

    qs = parse_qs(urlparse(location.replace("/#/", "/")).query)
    lck = qs.get("lck", [None])[0]
    if not lck:
        raise RuntimeError("Failed to extract lck from SSO auth entry")
    logger.debug("SSO init step 1 done: lck=%s...%s", lck[:4], lck[-4:])

    # Step 2: 查询认证方法
    logger.debug("SSO init step 2: POST queryAuthMethods")
    try:
        rsp = client.post(
            _SSO_QUERY_AUTH_METHODS,
            json={"lck": lck, "entityId": _ENTITY_ID},
        )
    except httpx.TimeoutException as e:
        raise RuntimeError("查询认证方法超时") from e

    if rsp.status_code != 200:
        raise RuntimeError(f"Query auth methods failed with HTTP {rsp.status_code}")

    data = rsp.json()
    if data.get("code") != 200:
        raise RuntimeError(f"Query auth methods failed with code {data.get('code')}: {data.get('message', '')}")

    user_name = data.get("userName", "")
    logger.debug("SSO init step 2 done: userName=%s", user_name or "(empty)")

    # Step 3: 获取微信二维码参数（与库 use_wechat_auth 一致）
    logger.debug("SSO init step 3: POST getMicroQr")
    try:
        rsp = client.post(
            _SSO_QR_INFO,
            json={"entityId": _ENTITY_ID, "lck": lck},
        )
    except httpx.TimeoutException as e:
        raise RuntimeError("获取二维码参数超时") from e

    data = rsp.json()
    if str(data.get("code")) != "200":
        raise RuntimeError(f"Get QR info failed with code {data.get('code')}: {data.get('message', '')}")

    try:
        app_id = data["data"]["appId"]
        return_url = data["data"]["returnUrl"]
        random_token = data["data"]["randomToken"]
    except KeyError as e:
        raise RuntimeError(f"Missing key in QR info response: {e}") from e
    logger.debug("SSO init step 3 done: appId=%s", app_id)

    # Step 4: 获取 sid（与库 use_qr_code 一致）
    logger.debug("SSO init step 4: GET qrpage")
    try:
        rsp = client.get(
            _SIS_QR_PAGE,
            params={
                "appid": app_id,
                "return_url": return_url,
                "rand_token": random_token,
                "embed_flag": "1",
            },
        )
    except httpx.TimeoutException as e:
        raise RuntimeError("获取二维码页面超时") from e

    if rsp.status_code != 200:
        raise RuntimeError(f"QR page request failed with HTTP {rsp.status_code}")

    match = re.search(r"sid\s?=\s?(\w{32})", rsp.text)
    if not match:
        raise RuntimeError("SID not found in QR page")
    sid = match.group(1)
    logger.debug("SSO init step 4 done: sid=%s...%s", sid[:4], sid[-4:])

    # 提取 cookies（用于后续 complete_auth）
    cookies = _serialize_cookies(client)

    # 关闭 client（不再需要保持连接）
    client.close()

    session_id = secrets.token_urlsafe(32)
    session_data = {
        "user_id": None,
        "created_at": time.time(),
        "expires_at": time.time() + _SESSION_TIMEOUT,
        "app_id": app_id,
        "return_url": return_url,
        "random_token": random_token,
        "sid": sid,
        "lck": lck,
        "user_name": user_name,
        "cookies": cookies,
        "status": "waiting",
    }

    qr_url = f"{_SIS_QR_IMG}?sid={sid}"
    return session_id, qr_url, cookies, session_data


def _sso_poll_sync(session: dict) -> dict:
    """同步执行 SSO 轮询。返回 { status, real_name?, student_id? }。"""
    sid = session["sid"]

    # 轮询扫码状态（不需要 cookies，只需要 sid）
    client = httpx.Client(timeout=16, follow_redirects=False)
    try:
        rsp = client.get(_SIS_QR_STATE, params={"sid": sid}, timeout=16)
        data = rsp.json()
    except httpx.TimeoutException:
        return {"status": "waiting"}
    except Exception as e:
        logger.warning("SSO poll request failed: %s", e)
        return {"status": "waiting"}
    finally:
        client.close()

    code = data.get("code")
    if code == 1:
        pass_code = data.get("data", "")
        if not pass_code:
            return {"status": "error", "message": "Pass code is empty"}

        logger.info("SSO QR scanned, completing auth...")
        try:
            user_info = _sso_complete_auth_sync(session, pass_code)
            return {"status": "success", **user_info}
        except Exception as e:
            logger.error("SSO complete auth failed: %s", e)
            return {"status": "error", "message": str(e)}

    elif code in (3, 202):
        return {"status": "expired"}

    elif code == 4:
        return {"status": "waiting"}

    elif code in (101, 102):
        return {"status": "error", "message": f"API code {code}: {data.get('message', '')}"}

    return {"status": "waiting"}


def _sso_complete_auth_sync(session: dict, pass_code: str) -> dict:
    """完成 SSO 认证流程，获取用户姓名和学号。"""
    # 从 session 中恢复 cookies 创建 httpx.Client
    cookies = session.get("cookies", [])
    client = _create_client_with_cookies(cookies)

    try:
        app_id = session["app_id"]
        return_url = session["return_url"]
        random_token = session["random_token"]
        user_name_from_auth = session.get("user_name", "")

        # 1. 构建 SIS 认证参数
        params = {
            "appid": app_id,
            "auth_code": pass_code,
            "rand_token": random_token,
        }

        if return_url:
            query_params = parse_qs(urlparse(return_url).query)
            for key, value_list in query_params.items():
                if value_list:
                    params[key] = value_list[0]

        if not return_url:
            raise RuntimeError("Return URL not available")

        # 2. 访问 return_url（使用较长超时）
        logger.debug("SSO complete: GET return_url with params")
        try:
            rsp = client.get(return_url, params=params, follow_redirects=True, timeout=_COMPLETE_TIMEOUT)
        except httpx.TimeoutException as e:
            logger.warning("SSO complete: return_url timed out, trying API fallback")
            # return_url 超时，跳过 HTML 解析，直接尝试 API 获取用户信息
            real_name, student_id = _extract_user_info_from_apis(client)
            if not student_id and user_name_from_auth:
                student_id = user_name_from_auth
                logger.debug("SSO complete: using userName as student_id: %s", student_id)
            if real_name or student_id:
                return {"real_name": real_name or "", "student_id": student_id or ""}
            raise RuntimeError("访问认证回调超时，且无法从 API 获取用户信息") from e
        except Exception as e:
            raise RuntimeError(f"访问认证回调失败: {e}") from e

        text = rsp.text if hasattr(rsp, "text") else ""
        logger.debug("SSO complete: return_url response status=%d, length=%d", rsp.status_code, len(text))

        # 3. 认证成功后，立即尝试通过 SSO API 获取用户信息
        # （此时 client 已携带认证后的 cookies，可能可以直接拿到用户信息）
        real_name = None
        student_id = None
        api_name, api_sid = _extract_user_info_from_apis(client)
        if api_name and api_sid:
            logger.info("SSO complete: got user info from API directly: real_name=%s, student_id=%s", api_name, api_sid)
            return {"real_name": api_name, "student_id": api_sid}
        if api_sid:
            student_id = api_sid
        if api_name:
            real_name = api_name

        # 4. 解析 actionType 和 locationValue
        action_type_match = re.search(r'var actionType\s*=\s*"([^"]+)"', text)
        location_value_match = re.search(r'var locationValue\s*=\s*"([^"]+)"', text)

        if action_type_match and location_value_match:
            action_type = unescape(unquote(action_type_match.group(1)))
            location_value = unescape(unquote(location_value_match.group(1)))
            logger.debug("SSO complete: actionType=%s, locationValue=%s...", action_type, location_value[:60])

            if action_type.upper() == "GET" and location_value:
                try:
                    final_rsp = client.get(location_value, follow_redirects=True, timeout=_COMPLETE_TIMEOUT)
                    final_text = final_rsp.text if hasattr(final_rsp, "text") else ""
                    logger.debug("SSO complete: locationValue response status=%d, length=%d", final_rsp.status_code, len(final_text))
                    real_name, student_id = _extract_user_info(final_text, client)
                except Exception as e:
                    logger.warning("Failed to follow locationValue: %s, trying API fallback", e)
                    # locationValue 超时，直接尝试 API
                    real_name, student_id = _extract_user_info_from_apis(client)
        else:
            logger.warning("SSO complete: actionType/locationValue not found in response (HTML length=%d)", len(text))

        # 5. 从认证响应页面提取
        if not real_name or not student_id:
            name2, sid2 = _extract_user_info(text, client)
            real_name = real_name or name2
            student_id = student_id or sid2

        # 6. 兜底：userName 作为学号
        if not student_id and user_name_from_auth:
            student_id = user_name_from_auth
            logger.debug("SSO complete: using userName as student_id: %s", student_id)

        if real_name and student_id:
            return {"real_name": real_name, "student_id": student_id}

        if student_id:
            return {"real_name": real_name or "", "student_id": student_id}

        raise RuntimeError(
            "无法从 USTB 统一认证获取用户信息。"
            "请确认微信扫码后已成功完成认证。"
        )
    finally:
        client.close()


def _extract_user_info(text: str, client: httpx.Client) -> tuple[str | None, str | None]:
    """从认证完成页面的 HTML 中提取用户姓名和学号。"""
    real_name = None
    student_id = None

    for pattern_name, pattern in [
        ("realName", r'"realName"\s*:\s*"([^"]+)"'),
        ("name", r'"name"\s*:\s*"([^"]+)"'),
        ("userName", r'"userName"\s*:\s*"([^"]+)"'),
        ("nickname", r'"nickname"\s*:\s*"([^"]+)"'),
        ("displayName", r'"displayName"\s*:\s*"([^"]+)"'),
    ]:
        if not real_name:
            m = re.search(pattern, text)
            if m:
                real_name = unescape(m.group(1))

    for pattern_id, pattern in [
        ("usercode", r'"usercode"\s*:\s*"([^"]+)"'),
        ("studentId", r'"studentId"\s*:\s*"([^"]+)"'),
        ("uid", r'"uid"\s*:\s*"(\d+)"'),
        ("userName_num", r'"userName"\s*:\s*"(\d+)"'),
        ("loginName", r'"loginName"\s*:\s*"(\d+)"'),
        ("xh", r'"xh"\s*:\s*"(\d+)"'),
    ]:
        if not student_id:
            m = re.search(pattern, text)
            if m:
                student_id = m.group(1)

    if real_name and student_id:
        logger.debug("Extracted user info from HTML: real_name=%s, student_id=%s", real_name, student_id)
        return real_name, student_id

    # 方法 2: 微校园 API
    if not real_name or not student_id:
        try:
            info_rsp = client.get("https://xis.ustb.edu.cn/api/user/info", timeout=_HTTP_TIMEOUT, follow_redirects=True)
            if info_rsp.status_code == 200:
                try:
                    info_data = info_rsp.json()
                    if isinstance(info_data, dict):
                        d = info_data.get("data", info_data)
                        if isinstance(d, dict):
                            real_name = real_name or d.get("name") or d.get("realName") or d.get("userName")
                            student_id = student_id or d.get("usercode") or d.get("studentId") or d.get("uid")
                            if real_name and student_id:
                                return real_name, student_id
                except Exception:
                    pass
        except Exception as e:
            logger.debug("xis.ustb.edu.cn user info request failed: %s", e)

    # 方法 3: SSO 个人信息
    if not real_name or not student_id:
        try:
            profile_rsp = client.get("https://sso.ustb.edu.cn/idp/userCenter/getUserInfo", timeout=_HTTP_TIMEOUT)
            if profile_rsp.status_code == 200:
                try:
                    profile_data = profile_rsp.json()
                    if isinstance(profile_data, dict):
                        d = profile_data.get("data", profile_data)
                        if isinstance(d, dict):
                            real_name = real_name or d.get("name") or d.get("realName")
                            student_id = student_id or d.get("usercode") or d.get("userName")
                            if real_name and student_id:
                                return real_name, student_id
                except Exception:
                    pass
        except Exception as e:
            logger.debug("SSO user info request failed: %s", e)

    # 方法 4: chat.ustb.edu.cn
    if not real_name or not student_id:
        try:
            chat_rsp = client.get("http://chat.ustb.edu.cn/api/user/info", timeout=_HTTP_TIMEOUT, follow_redirects=True)
            if chat_rsp.status_code == 200:
                try:
                    chat_data = chat_rsp.json()
                    if isinstance(chat_data, dict):
                        d = chat_data.get("data", chat_data)
                        if isinstance(d, dict):
                            real_name = real_name or d.get("name") or d.get("realName") or d.get("userName")
                            student_id = student_id or d.get("usercode") or d.get("studentId") or d.get("uid")
                except Exception:
                    pass
        except Exception as e:
            logger.debug("chat.ustb.edu.cn user info request failed: %s", e)

    if real_name or student_id:
        logger.debug("Extracted partial: real_name=%s, student_id=%s", real_name, student_id)
    else:
        logger.warning("Failed to extract user info from any source")

    return real_name, student_id


def _extract_user_info_from_apis(client: httpx.Client) -> tuple[str | None, str | None]:
    """直接通过 API 获取用户信息（不依赖 HTML 页面解析）。

    在 locationValue 不可达/超时时作为兜底方案。
    认证完成后 SSO cookies 应已生效，可访问用户信息 API。
    """
    real_name = None
    student_id = None

    # 方法 1: SSO 个人信息（最可靠）
    try:
        profile_rsp = client.get(
            "https://sso.ustb.edu.cn/idp/userCenter/getUserInfo",
            timeout=_COMPLETE_TIMEOUT,
        )
        if profile_rsp.status_code == 200:
            try:
                profile_data = profile_rsp.json()
                if isinstance(profile_data, dict):
                    d = profile_data.get("data", profile_data)
                    if isinstance(d, dict):
                        real_name = d.get("name") or d.get("realName") or d.get("userName")
                        student_id = d.get("usercode") or d.get("userName") or d.get("uid")
                        if real_name or student_id:
                            logger.debug("Got user info from SSO API: real_name=%s, student_id=%s", real_name, student_id)
                            return real_name, student_id
            except Exception:
                pass
    except Exception as e:
        logger.debug("SSO user info API failed: %s", e)

    # 方法 2: 微校园 API
    try:
        info_rsp = client.get(
            "https://xis.ustb.edu.cn/api/user/info",
            timeout=_COMPLETE_TIMEOUT,
            follow_redirects=True,
        )
        if info_rsp.status_code == 200:
            try:
                info_data = info_rsp.json()
                if isinstance(info_data, dict):
                    d = info_data.get("data", info_data)
                    if isinstance(d, dict):
                        real_name = d.get("name") or d.get("realName") or d.get("userName")
                        student_id = d.get("usercode") or d.get("studentId") or d.get("uid")
                        if real_name or student_id:
                            logger.debug("Got user info from xis API: real_name=%s, student_id=%s", real_name, student_id)
                            return real_name, student_id
            except Exception:
                pass
    except Exception as e:
        logger.debug("xis user info API failed: %s", e)

    # 方法 3: chat.ustb.edu.cn
    try:
        chat_rsp = client.get(
            "http://chat.ustb.edu.cn/api/user/info",
            timeout=_COMPLETE_TIMEOUT,
            follow_redirects=True,
        )
        if chat_rsp.status_code == 200:
            try:
                chat_data = chat_rsp.json()
                if isinstance(chat_data, dict):
                    d = chat_data.get("data", chat_data)
                    if isinstance(d, dict):
                        real_name = d.get("name") or d.get("realName") or d.get("userName")
                        student_id = d.get("usercode") or d.get("studentId") or d.get("uid")
                        if real_name or student_id:
                            logger.debug("Got user info from chat API: real_name=%s, student_id=%s", real_name, student_id)
                            return real_name, student_id
            except Exception:
                pass
    except Exception as e:
        logger.debug("chat user info API failed: %s", e)

    logger.warning("Failed to extract user info from any API")
    return real_name, student_id


# ---------------------------------------------------------------------------
# API Endpoints — 绑定模式
# ---------------------------------------------------------------------------


@router.post("/init")
async def init_sso_session(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """初始化 USTB SSO 认证会话，返回二维码 URL。"""
    try:
        session_id, qr_url, cookies, session_data = await asyncio.to_thread(_sso_init_sync)
    except Exception as e:
        logger.error("SSO init failed: %s", e)
        raise HTTPException(status_code=500, detail=f"初始化认证失败: {str(e)}")

    session_data["user_id"] = user.id
    await _save_bind_session(session_id, session_data)

    return {
        "session_id": session_id,
        "qr_url": qr_url,
    }


@router.get("/poll")
async def poll_sso_status(
    session_id: str = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """轮询 USTB SSO 扫码状态。"""
    session = await _load_bind_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在或已过期")

    if session.get("user_id") != user.id:
        raise HTTPException(status_code=403, detail="无权访问此会话")

    if time.time() > session.get("expires_at", 0):
        await _delete_bind_session(session_id)
        raise HTTPException(status_code=410, detail="二维码已过期，请重新获取")

    # 认证完成中，返回 waiting（防止竞态：另一个 poll 正在 complete_auth）
    if session.get("status") == "completing":
        return {"status": "waiting", "message": "认证完成中..."}

    # 已完成，直接返回缓存结果
    if session.get("status") == "success":
        return {
            "status": "success",
            "real_name": session.get("real_name"),
            "student_id": session.get("student_id"),
        }

    # 认证已尝试但失败，返回缓存的错误（防止无限重试）
    if session.get("status") == "failed":
        return {"status": "error", "message": session.get("error_message", "认证失败，请重新获取二维码")}

    # 标记为 completing 后再执行（防止并发 poll 竞态）
    session["status"] = "completing"
    await _save_bind_session(session_id, session)

    try:
        result = await asyncio.to_thread(_sso_poll_sync, session)
    except Exception as e:
        logger.error("SSO poll failed: %s", e)
        # 认证过程中出错，标记为 failed 防止无限重试
        session["status"] = "failed"
        session["error_message"] = str(e)
        await _save_bind_session(session_id, session)
        return {"status": "error", "message": str(e)}

    if result.get("status") == "success":
        real_name = result.get("real_name")
        student_id = result.get("student_id")

        db_user = (
            await db.execute(select(User).where(User.id == user.id))
        ).scalar_one_or_none()
        if db_user:
            if real_name:
                db_user.real_name = real_name
            if student_id:
                db_user.student_id = student_id
            await db.commit()

        session["status"] = "success"
        session["real_name"] = real_name
        session["student_id"] = student_id
        await _save_bind_session(session_id, session)

    elif result.get("status") == "expired":
        await _delete_bind_session(session_id)
        return result

    else:
        # error — 标记为 failed 防止无限重试
        if result.get("status") == "error":
            session["status"] = "failed"
            session["error_message"] = result.get("message", "认证失败")
            await _save_bind_session(session_id, session)
        else:
            # waiting — 二维码尚未被扫描
            session["status"] = "waiting"
            await _save_bind_session(session_id, session)

    return result


@router.post("/unbind")
async def unbind_ustb_sso(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """解绑 USTB 统一认证，清空姓名和学号。"""
    db_user = (
        await db.execute(select(User).where(User.id == user.id))
    ).scalar_one_or_none()
    if not db_user:
        raise HTTPException(status_code=404, detail="用户不存在")

    db_user.real_name = None
    db_user.student_id = None
    await db.commit()

    return {"ok": True, "message": "已解绑北科大统一认证"}


# ---------------------------------------------------------------------------
# Login mode endpoints (no auth required)
# ---------------------------------------------------------------------------


@router.post("/login/init")
async def login_sso_init():
    """初始化 USTB SSO 登录会话（无需登录），返回二维码 URL。"""
    try:
        session_id, qr_url, cookies, session_data = await asyncio.to_thread(_sso_init_sync)
    except Exception as e:
        logger.error("SSO login init failed: %s", e)
        raise HTTPException(status_code=500, detail=f"初始化认证失败: {str(e)}")

    session_data["user_id"] = None  # Login mode — no user_id yet
    await _save_login_session(session_id, session_data)

    return {
        "session_id": session_id,
        "qr_url": qr_url,
    }


@router.get("/login/poll")
async def login_sso_poll(
    session_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """轮询 USTB SSO 登录扫码状态（无需登录）。"""
    session = await _load_login_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在或已过期")

    if time.time() > session.get("expires_at", 0):
        await _delete_login_session(session_id)
        raise HTTPException(status_code=410, detail="二维码已过期，请重新获取")

    # 认证完成中
    if session.get("status") == "completing":
        return {"status": "waiting", "message": "认证完成中..."}

    # 已完成，返回缓存结果
    if session.get("login_status") == "success":
        return {
            "status": "success",
            "access_token": session.get("access_token"),
        }
    if session.get("login_status") == "unregistered":
        return {
            "status": "unregistered",
            "oauth_token": session.get("oauth_token"),
            "real_name": session.get("real_name"),
            "student_id": session.get("student_id"),
        }

    # 认证已尝试但失败，返回缓存的错误
    if session.get("status") == "failed":
        return {"status": "error", "message": session.get("error_message", "认证失败，请重新获取二维码")}

    # 标记为 completing 后再执行
    session["status"] = "completing"
    await _save_login_session(session_id, session)

    try:
        result = await asyncio.to_thread(_sso_poll_sync, session)
    except Exception as e:
        logger.error("SSO login poll failed: %s", e)
        session["status"] = "failed"
        session["error_message"] = str(e)
        await _save_login_session(session_id, session)
        return {"status": "error", "message": str(e)}

    if result.get("status") == "success":
        real_name = result.get("real_name")
        student_id = result.get("student_id")

        db_user = None
        if student_id:
            db_user = (
                await db.execute(select(User).where(User.student_id == student_id))
            ).scalar_one_or_none()

        if db_user:
            if db_user.is_banned:
                session["status"] = "failed"
                session["error_message"] = "账号已被封禁"
                await _save_login_session(session_id, session)
                return {"status": "error", "message": "账号已被封禁"}

            jwt_token = create_jwt(sub=db_user.id, extra={"provider": "ustb_sso"})

            session["login_status"] = "success"
            session["access_token"] = jwt_token
            session["status"] = "success"
            await _save_login_session(session_id, session)

            return {
                "status": "success",
                "access_token": jwt_token,
            }
        else:
            # 存储到 Redis 的 pending_oauth
            from app.routers.oauth_login import store_pending_oauth
            oauth_token = secrets.token_urlsafe(32)
            await store_pending_oauth(oauth_token, {
                "provider": "ustb_sso",
                "created_at": time.time(),
                "expires_at": time.time() + 600,
                "real_name": real_name or "",
                "student_id": student_id or "",
            })

            session["login_status"] = "unregistered"
            session["oauth_token"] = oauth_token
            session["real_name"] = real_name
            session["student_id"] = student_id
            session["status"] = "success"
            await _save_login_session(session_id, session)

            return {
                "status": "unregistered",
                "oauth_token": oauth_token,
                "real_name": real_name,
                "student_id": student_id,
            }

    elif result.get("status") == "expired":
        await _delete_login_session(session_id)
        return result

    else:
        # error — 标记为 failed 防止无限重试
        if result.get("status") == "error":
            session["status"] = "failed"
            session["error_message"] = result.get("message", "认证失败")
            await _save_login_session(session_id, session)
        else:
            # waiting — 二维码尚未被扫描
            session["status"] = "waiting"
            await _save_login_session(session_id, session)

    return result
