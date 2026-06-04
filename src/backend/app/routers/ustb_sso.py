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

# 会话超时
_SESSION_TIMEOUT = 180  # 3 分钟
_POLL_TIMEOUT = 180     # 二维码有效期 3 分钟
_HTTP_TIMEOUT = 10      # 单个 HTTP 请求超时（秒）

# ---------------------------------------------------------------------------
# 内存会话存储
# ---------------------------------------------------------------------------
_ustb_sso_sessions: dict[str, dict] = {}


def _cleanup_expired_sessions() -> None:
    """清理过期的 SSO 会话。"""
    now = time.time()
    expired = [k for k, v in _ustb_sso_sessions.items() if v.get("expires_at", 0) < now]
    for k in expired:
        client = _ustb_sso_sessions[k].get("httpx_client")
        if client:
            try:
                client.close()
            except Exception:
                pass
        del _ustb_sso_sessions[k]


# ---------------------------------------------------------------------------
# 同步 SSO 操作（在 asyncio.to_thread 中执行）
# ---------------------------------------------------------------------------


def _sso_init_sync() -> tuple[str, str, httpx.Client]:
    """同步执行 SSO 初始化流程，返回 (session_id, qr_url, httpx_client)。

    流程（与 USTB-SSO 库 QrAuthProcedure 一致）：
    1. GET authenticate → 获取 lck
    2. POST queryAuthMethods → 获取认证方法 + userName（学号）
    3. POST getMicroQr → 获取微信二维码参数
    4. GET qrpage → 获取 sid
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

    # Step 2: 查询认证方法（关键：响应中的 userName 就是学号！）
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

    # 提取 userName（这是学号）
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

    # 生成 session_id 并存储
    session_id = secrets.token_urlsafe(32)
    _ustb_sso_sessions[session_id] = {
        "user_id": None,  # 在 init endpoint 中设置
        "created_at": time.time(),
        "expires_at": time.time() + _SESSION_TIMEOUT,
        "httpx_client": client,
        "app_id": app_id,
        "return_url": return_url,
        "random_token": random_token,
        "sid": sid,
        "lck": lck,
        "user_name": user_name,  # 从 queryAuthMethods 获取的学号
        "status": "waiting",
    }

    qr_url = f"{_SIS_QR_IMG}?sid={sid}"
    return session_id, qr_url, client


def _sso_poll_sync(session: dict) -> dict:
    """同步执行 SSO 轮询。返回 { status, real_name?, student_id? }。"""
    client: httpx.Client = session["httpx_client"]
    sid = session["sid"]

    # 轮询扫码状态（与库 wait_for_pass_code 一致，单次 16 秒超时）
    try:
        rsp = client.get(_SIS_QR_STATE, params={"sid": sid}, timeout=16)
        data = rsp.json()
    except httpx.TimeoutException:
        # 单次轮询超时不视为错误，让前端下次重试
        return {"status": "waiting"}
    except Exception as e:
        logger.warning("SSO poll request failed: %s", e)
        return {"status": "waiting"}

    code = data.get("code")
    if code == 1:
        # 扫码成功 → 获取 pass_code 并完成认证
        pass_code = data.get("data", "")
        if not pass_code:
            return {"status": "error", "message": "Pass code is empty"}

        # 关键：立即标记 session 为 "completing" 状态
        # 防止并发的 poll 请求在认证完成期间看到已消费的 QR 码而误报 "expired"
        session["status"] = "completing"

        logger.info("SSO QR scanned, completing auth...")
        # 完成认证
        try:
            user_info = _sso_complete_auth_sync(session, pass_code)
            return {"status": "success", **user_info}
        except Exception as e:
            logger.error("SSO complete auth failed: %s", e)
            # 认证失败时重置状态，允许重新尝试
            session["status"] = "waiting"
            return {"status": "error", "message": str(e)}

    elif code in (3, 202):
        # 二维码过期
        return {"status": "expired"}

    elif code == 4:
        # 等待扫码
        return {"status": "waiting"}

    elif code in (101, 102):
        # 无效
        return {"status": "error", "message": f"API code {code}: {data.get('message', '')}"}

    return {"status": "waiting"}


def _sso_complete_auth_sync(session: dict, pass_code: str) -> dict:
    """完成 SSO 认证流程，获取用户姓名和学号。

    严格按照 USTB-SSO 库的 QrAuthProcedure.complete_auth 实现：
    1. 向 SIS 发送 auth_code + rand_token + appid + return_url 参数
    2. 访问 return_url（跟随重定向）
    3. 从响应中解析 actionType 和 locationValue（JS 变量）
    4. GET locationValue 完成认证
    5. 从最终页面提取用户信息

    返回 { real_name, student_id }。
    """
    client: httpx.Client = session["httpx_client"]
    app_id = session["app_id"]
    return_url = session["return_url"]
    random_token = session["random_token"]
    user_name_from_auth = session.get("user_name", "")

    # 1. 构建 SIS 认证参数（与库 complete_auth 一致）
    params = {
        "appid": app_id,
        "auth_code": pass_code,
        "rand_token": random_token,
    }

    # 解析 return_url 中的查询参数（与库一致）
    if return_url:
        query_params = parse_qs(urlparse(return_url).query)
        for key, value_list in query_params.items():
            if value_list:
                params[key] = value_list[0]

    if not return_url:
        raise RuntimeError("Return URL not available")

    # 2. 访问 return_url 完成中间认证步骤（与库 complete_auth 的 _get 一致）
    logger.debug("SSO complete: GET return_url with params")
    try:
        rsp = client.get(return_url, params=params, follow_redirects=True, timeout=_HTTP_TIMEOUT)
    except httpx.TimeoutException as e:
        raise RuntimeError("访问认证回调超时，请稍后重试") from e
    except Exception as e:
        raise RuntimeError(f"访问认证回调失败: {e}") from e

    text = rsp.text if hasattr(rsp, "text") else ""
    logger.debug("SSO complete: return_url response status=%d, length=%d", rsp.status_code, len(text))

    # 3. 从页面中解析 actionType 和 locationValue（与库的 _complete_auth 一致）
    action_type_match = re.search(r'var actionType\s*=\s*"([^"]+)"', text)
    location_value_match = re.search(r'var locationValue\s*=\s*"([^"]+)"', text)

    real_name = None
    student_id = None

    if action_type_match and location_value_match:
        action_type = unescape(unquote(action_type_match.group(1)))
        location_value = unescape(unquote(location_value_match.group(1)))
        logger.debug("SSO complete: actionType=%s, locationValue=%s...", action_type, location_value[:60])

        if action_type.upper() == "GET" and location_value:
            # 4. GET locationValue 完成认证
            try:
                final_rsp = client.get(location_value, follow_redirects=True, timeout=_HTTP_TIMEOUT)
                final_text = final_rsp.text if hasattr(final_rsp, "text") else ""
                logger.debug("SSO complete: locationValue response status=%d, length=%d", final_rsp.status_code, len(final_text))

                # 从最终页面提取用户信息
                real_name, student_id = _extract_user_info(final_text, client)
            except Exception as e:
                logger.warning("Failed to follow locationValue: %s", e)
    else:
        logger.warning("SSO complete: actionType/locationValue not found in response (HTML length=%d)", len(text))

    # 5. 如果上面没拿到姓名，尝试从认证响应页面本身提取
    if not real_name or not student_id:
        name2, sid2 = _extract_user_info(text, client)
        real_name = real_name or name2
        student_id = student_id or sid2

    # 6. 兜底：使用 queryAuthMethods 返回的 userName 作为学号
    if not student_id and user_name_from_auth:
        student_id = user_name_from_auth
        logger.debug("SSO complete: using userName from queryAuthMethods as student_id: %s", student_id)

    if real_name and student_id:
        return {"real_name": real_name, "student_id": student_id}

    # 7. 最后兜底：如果只拿到学号没拿到姓名，返回学号让绑定流程继续
    if student_id:
        return {"real_name": real_name or "", "student_id": student_id}

    raise RuntimeError(
        "无法从 USTB 统一认证获取用户信息。"
        "请确认微信扫码后已成功完成认证。"
    )


def _extract_user_info(text: str, client: httpx.Client) -> tuple[str | None, str | None]:
    """从认证完成页面的 HTML 中提取用户姓名和学号。

    尝试多种方式：
    1. 从 HTML 中的 JS 变量提取
    2. 从 JSON 数据提取
    3. 从微校园 API 获取
    4. 从 SSO 用户中心 API 获取
    """
    real_name = None
    student_id = None

    # 方法 1: 从 HTML 中的 JSON/JS 数据提取
    # 尝试匹配各种可能的字段名
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

    # 方法 2: 使用认证后的 session cookie 访问微校园用户信息 API
    if not real_name or not student_id:
        try:
            info_rsp = client.get(
                "https://xis.ustb.edu.cn/api/user/info",
                timeout=_HTTP_TIMEOUT,
                follow_redirects=True,
            )
            if info_rsp.status_code == 200:
                try:
                    info_data = info_rsp.json()
                    if isinstance(info_data, dict):
                        data = info_data.get("data", info_data)
                        if isinstance(data, dict):
                            real_name = real_name or data.get("name") or data.get("realName") or data.get("userName")
                            student_id = student_id or data.get("usercode") or data.get("studentId") or data.get("uid")
                            if real_name and student_id:
                                logger.debug("Extracted user info from xis API: real_name=%s, student_id=%s", real_name, student_id)
                                return real_name, student_id
                except Exception:
                    pass
        except Exception as e:
            logger.debug("xis.ustb.edu.cn user info request failed: %s", e)

    # 方法 3: 尝试从 SSO 个人信息页面获取
    if not real_name or not student_id:
        try:
            profile_rsp = client.get(
                "https://sso.ustb.edu.cn/idp/userCenter/getUserInfo",
                timeout=_HTTP_TIMEOUT,
            )
            if profile_rsp.status_code == 200:
                try:
                    profile_data = profile_rsp.json()
                    if isinstance(profile_data, dict):
                        data = profile_data.get("data", profile_data)
                        if isinstance(data, dict):
                            real_name = real_name or data.get("name") or data.get("realName")
                            student_id = student_id or data.get("usercode") or data.get("userName")
                            if real_name and student_id:
                                logger.debug("Extracted user info from SSO API: real_name=%s, student_id=%s", real_name, student_id)
                                return real_name, student_id
                except Exception:
                    pass
        except Exception as e:
            logger.debug("SSO user info request failed: %s", e)

    # 方法 4: 尝试从 chat.ustb.edu.cn 获取（因为 redirect_uri 是 chat 的）
    if not real_name or not student_id:
        try:
            chat_rsp = client.get(
                "http://chat.ustb.edu.cn/api/user/info",
                timeout=_HTTP_TIMEOUT,
                follow_redirects=True,
            )
            if chat_rsp.status_code == 200:
                try:
                    chat_data = chat_rsp.json()
                    if isinstance(chat_data, dict):
                        data = chat_data.get("data", chat_data)
                        if isinstance(data, dict):
                            real_name = real_name or data.get("name") or data.get("realName") or data.get("userName")
                            student_id = student_id or data.get("usercode") or data.get("studentId") or data.get("uid")
                except Exception:
                    pass
        except Exception as e:
            logger.debug("chat.ustb.edu.cn user info request failed: %s", e)

    if real_name or student_id:
        logger.debug("Extracted partial user info: real_name=%s, student_id=%s", real_name, student_id)
    else:
        logger.warning("Failed to extract user info from any source")

    return real_name, student_id


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------


@router.post("/init")
async def init_sso_session(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """初始化 USTB SSO 认证会话，返回二维码 URL。"""
    _cleanup_expired_sessions()

    try:
        session_id, qr_url, _ = await asyncio.to_thread(_sso_init_sync)
    except Exception as e:
        logger.error("SSO init failed: %s", e)
        raise HTTPException(status_code=500, detail=f"初始化认证失败: {str(e)}")

    # 关联用户
    session = _ustb_sso_sessions.get(session_id)
    if session:
        session["user_id"] = user.id

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
    session = _ustb_sso_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在或已过期")

    if session.get("user_id") != user.id:
        raise HTTPException(status_code=403, detail="无权访问此会话")

    if time.time() > session.get("expires_at", 0):
        client = session.get("httpx_client")
        if client:
            try:
                client.close()
            except Exception:
                pass
        del _ustb_sso_sessions[session_id]
        raise HTTPException(status_code=410, detail="二维码已过期，请重新获取")

    # 如果认证完成中（另一个 poll 已检测到扫码，正在完成认证），返回 waiting
    if session.get("status") == "completing":
        return {"status": "waiting", "message": "认证完成中..."}

    # 如果已经完成，直接返回缓存结果
    if session.get("status") == "success":
        return {
            "status": "success",
            "real_name": session.get("real_name"),
            "student_id": session.get("student_id"),
        }

    try:
        result = await asyncio.to_thread(_sso_poll_sync, session)
    except Exception as e:
        logger.error("SSO poll failed: %s", e)
        return {"status": "error", "message": str(e)}

    # 如果认证成功，更新用户信息
    if result.get("status") == "success":
        real_name = result.get("real_name")
        student_id = result.get("student_id")

        # 更新数据库
        db_user = (
            await db.execute(select(User).where(User.id == user.id))
        ).scalar_one_or_none()
        if db_user:
            if real_name:
                db_user.real_name = real_name
            if student_id:
                db_user.student_id = student_id
            await db.commit()

        # 缓存结果到会话
        session["status"] = "success"
        session["real_name"] = real_name
        session["student_id"] = student_id

        # 关闭 httpx 客户端
        client = session.get("httpx_client")
        if client:
            try:
                client.close()
            except Exception:
                pass

    elif result.get("status") == "expired":
        client = session.get("httpx_client")
        if client:
            try:
                client.close()
            except Exception:
                pass
        del _ustb_sso_sessions[session_id]

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

# Login-mode SSO sessions (separate from bind-mode sessions)
_ustb_sso_login_sessions: dict[str, dict] = {}


def _cleanup_expired_login_sessions() -> None:
    """清理过期的登录模式 SSO 会话。"""
    now = time.time()
    expired = [k for k, v in _ustb_sso_login_sessions.items() if v.get("expires_at", 0) < now]
    for k in expired:
        client = _ustb_sso_login_sessions[k].get("httpx_client")
        if client:
            try:
                client.close()
            except Exception:
                pass
        del _ustb_sso_login_sessions[k]


@router.post("/login/init")
async def login_sso_init():
    """初始化 USTB SSO 登录会话（无需登录），返回二维码 URL。"""
    _cleanup_expired_login_sessions()

    try:
        session_id, qr_url, _ = await asyncio.to_thread(_sso_init_sync)
    except Exception as e:
        logger.error("SSO login init failed: %s", e)
        raise HTTPException(status_code=500, detail=f"初始化认证失败: {str(e)}")

    # Move the session from _ustb_sso_sessions to _ustb_sso_login_sessions
    session = _ustb_sso_sessions.pop(session_id, None)
    if session:
        session["user_id"] = None  # Login mode — no user_id yet
        _ustb_sso_login_sessions[session_id] = session

    return {
        "session_id": session_id,
        "qr_url": qr_url,
    }


@router.get("/login/poll")
async def login_sso_poll(
    session_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """轮询 USTB SSO 登录扫码状态（无需登录）。

    返回：
    - {status: "waiting"} — 等待扫码
    - {status: "success", access_token: "jwt..."} — 登录成功（已绑定用户）
    - {status: "unregistered", oauth_token: "xxx", real_name: "...", student_id: "..."} — 未绑定用户
    - {status: "expired"} — 二维码过期
    - {status: "error", message: "..."} — 错误
    """
    session = _ustb_sso_login_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在或已过期")

    if time.time() > session.get("expires_at", 0):
        client = session.get("httpx_client")
        if client:
            try:
                client.close()
            except Exception:
                pass
        del _ustb_sso_login_sessions[session_id]
        raise HTTPException(status_code=410, detail="二维码已过期，请重新获取")

    # 如果认证完成中（另一个 poll 已检测到扫码，正在完成认证），返回 waiting
    if session.get("status") == "completing":
        return {"status": "waiting", "message": "认证完成中..."}

    # If already completed, return cached result
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

    try:
        result = await asyncio.to_thread(_sso_poll_sync, session)
    except Exception as e:
        logger.error("SSO login poll failed: %s", e)
        return {"status": "error", "message": str(e)}

    if result.get("status") == "success":
        real_name = result.get("real_name")
        student_id = result.get("student_id")

        # Try to find a user with this student_id
        db_user = None
        if student_id:
            db_user = (
                await db.execute(select(User).where(User.student_id == student_id))
            ).scalar_one_or_none()

        if db_user:
            # Found a bound user → issue JWT
            if db_user.is_banned:
                return {"status": "error", "message": "账号已被封禁"}

            jwt_token = create_jwt(sub=db_user.id, extra={"provider": "ustb_sso"})

            # Cache result
            session["login_status"] = "success"
            session["access_token"] = jwt_token

            # Close httpx client
            client = session.get("httpx_client")
            if client:
                try:
                    client.close()
                except Exception:
                    pass

            return {
                "status": "success",
                "access_token": jwt_token,
            }
        else:
            # No bound user found → store pending info
            from app.routers.oauth_login import _pending_oauth
            import secrets as _secrets

            oauth_token = _secrets.token_urlsafe(32)
            _pending_oauth[oauth_token] = {
                "provider": "ustb_sso",
                "created_at": time.time(),
                "expires_at": time.time() + 600,
                "real_name": real_name or "",
                "student_id": student_id or "",
            }

            # Cache result
            session["login_status"] = "unregistered"
            session["oauth_token"] = oauth_token
            session["real_name"] = real_name
            session["student_id"] = student_id

            # Close httpx client
            client = session.get("httpx_client")
            if client:
                try:
                    client.close()
                except Exception:
                    pass

            return {
                "status": "unregistered",
                "oauth_token": oauth_token,
                "real_name": real_name,
                "student_id": student_id,
            }

    elif result.get("status") == "expired":
        client = session.get("httpx_client")
        if client:
            try:
                client.close()
            except Exception:
                pass
        del _ustb_sso_login_sessions[session_id]

    return result
