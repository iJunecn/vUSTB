"""USTB 统一验证登录绑定 — 微信扫码认证，获取姓名和学号。

不依赖 USTB-SSO 第三方库（需要 Python 3.12+），自行实现 SSO 二维码认证流程。

流程：
1. 前端调用 POST /api/ustb-sso/init → 后端初始化 SSO 会话，获取二维码 URL
2. 前端展示二维码，轮询 GET /api/ustb-sso/poll
3. 用户微信扫码后，后端完成认证，获取用户信息，写入 user.real_name / user.student_id
4. 前端轮询返回 success，刷新用户信息
5. POST /api/ustb-sso/unbind → 清空绑定的姓名和学号
"""
import asyncio
import logging
import re
import secrets
import time
from html import unescape
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models import User

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

# ---------------------------------------------------------------------------
# 内存会话存储（与 Microsoft OAuth 的 _oauth_states 模式一致）
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

    流程：
    1. GET authenticate → 获取 lck
    2. POST queryAuthMethods → 获取认证方法
    3. POST getMicroQr → 获取微信二维码参数
    4. GET qrpage → 获取 sid
    """
    client = httpx.Client(timeout=15, follow_redirects=False)

    # Step 1: 获取 lck
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
    if rsp.status_code // 100 != 3:
        raise RuntimeError(f"SSO auth entry returned HTTP {rsp.status_code}, expected 3xx")

    location = rsp.headers.get("Location", "")
    if not location:
        raise RuntimeError("Missing Location header in SSO auth entry response")

    qs = parse_qs(urlparse(location.replace("/#/", "/")).query)
    lck = qs.get("lck", [None])[0]
    if not lck:
        raise RuntimeError("Failed to extract lck from SSO auth entry")

    # Step 2: 查询认证方法
    rsp = client.post(
        _SSO_QUERY_AUTH_METHODS,
        json={"lck": lck, "entityId": _ENTITY_ID},
    )
    if rsp.status_code != 200:
        raise RuntimeError(f"Query auth methods failed with HTTP {rsp.status_code}")

    data = rsp.json()
    if data.get("code") != 200:
        raise RuntimeError(f"Query auth methods failed with code {data.get('code')}: {data.get('message', '')}")

    # Step 3: 获取微信二维码参数
    rsp = client.post(
        _SSO_QR_INFO,
        json={"entityId": _ENTITY_ID, "lck": lck},
    )
    data = rsp.json()
    if str(data.get("code")) != "200":
        raise RuntimeError(f"Get QR info failed with code {data.get('code')}: {data.get('message', '')}")

    try:
        app_id = data["data"]["appId"]
        return_url = data["data"]["returnUrl"]
        random_token = data["data"]["randomToken"]
    except KeyError as e:
        raise RuntimeError(f"Missing key in QR info response: {e}") from e

    # Step 4: 获取 sid
    rsp = client.get(
        _SIS_QR_PAGE,
        params={
            "appid": app_id,
            "return_url": return_url,
            "rand_token": random_token,
            "embed_flag": "1",
        },
    )
    if rsp.status_code != 200:
        raise RuntimeError(f"QR page request failed with HTTP {rsp.status_code}")

    match = re.search(r"sid\s?=\s?(\w{32})", rsp.text)
    if not match:
        raise RuntimeError("SID not found in QR page")
    sid = match.group(1)

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
        "status": "waiting",
    }

    qr_url = f"{_SIS_QR_IMG}?sid={sid}"
    return session_id, qr_url, client


def _sso_poll_sync(session: dict) -> dict:
    """同步执行 SSO 轮询。返回 { status, real_name?, student_id? }。"""
    client: httpx.Client = session["httpx_client"]
    sid = session["sid"]

    # 轮询扫码状态
    try:
        rsp = client.get(_SIS_QR_STATE, params={"sid": sid}, timeout=16)
        data = rsp.json()
    except Exception as e:
        logger.warning("SSO poll request failed: %s", e)
        return {"status": "waiting"}

    code = data.get("code")
    if code == 1:
        # 扫码成功 → 获取 pass_code 并完成认证
        pass_code = data.get("data", "")
        if not pass_code:
            return {"status": "error", "message": "Pass code is empty"}

        # 完成认证
        try:
            user_info = _sso_complete_auth_sync(session, pass_code)
            return {"status": "success", **user_info}
        except Exception as e:
            logger.error("SSO complete auth failed: %s", e)
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

    返回 { real_name, student_id }。
    """
    client: httpx.Client = session["httpx_client"]
    app_id = session["app_id"]
    return_url = session["return_url"]
    random_token = session["random_token"]

    # 向 SIS 发送认证码
    params = {
        "appid": app_id,
        "auth_code": pass_code,
        "rand_token": random_token,
    }

    # 解析 return_url 中的查询参数
    if return_url:
        query_params = parse_qs(urlparse(return_url).query)
        for key, value_list in query_params.items():
            if value_list:
                params[key] = value_list[0]

    if not return_url:
        raise RuntimeError("Return URL not available")

    # 访问 return_url 完成认证
    rsp = client.get(return_url, params=params, follow_redirects=True)

    # 尝试从最终响应中获取用户信息
    # 方法 1: 从 SSO 认证完成后的重定向页面解析
    user_info = _extract_user_info_from_response(rsp, client)
    return user_info


def _extract_user_info_from_response(rsp: httpx.Response, client: httpx.Client) -> dict:
    """从 SSO 认证完成后的响应中提取用户信息。

    尝试多种方式获取姓名和学号：
    1. 从 SSO authnEngine 页面解析 JS 变量
    2. 从微校园 API 获取
    3. 从 authMethods 响应中的 user_name 字段获取
    """
    text = rsp.text if hasattr(rsp, "text") else ""

    # 方法 1: 从认证完成页面的 JS 变量中提取
    # SSO 认证完成后，页面可能包含用户信息
    # 尝试从 queryAuthMethods 获取 user_name
    real_name = None
    student_id = None

    # 方法 2: 使用认证后的 session cookie 访问微校园用户信息 API
    # 先尝试 xis.ustb.edu.cn
    try:
        info_rsp = client.get(
            "https://xis.ustb.edu.cn/api/user/info",
            timeout=10,
            follow_redirects=True,
        )
        if info_rsp.status_code == 200:
            try:
                info_data = info_rsp.json()
                # 微校园 API 返回格式
                if isinstance(info_data, dict):
                    data = info_data.get("data", info_data)
                    if isinstance(data, dict):
                        real_name = data.get("name") or data.get("realName") or data.get("userName")
                        student_id = data.get("usercode") or data.get("studentId") or data.get("uid")
                        if real_name and student_id:
                            return {"real_name": real_name, "student_id": student_id}
            except Exception:
                pass
    except Exception as e:
        logger.debug("xis.ustb.edu.cn user info request failed: %s", e)

    # 方法 3: 尝试从 SSO 个人信息页面获取
    try:
        profile_rsp = client.get(
            "https://sso.ustb.edu.cn/idp/userCenter/getUserInfo",
            timeout=10,
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
                            return {"real_name": real_name, "student_id": student_id}
            except Exception:
                pass
    except Exception as e:
        logger.debug("SSO user info request failed: %s", e)

    # 方法 4: 从认证完成页面的 HTML 中解析
    # 有些 SSO 回调页面会在 HTML 中嵌入用户信息
    if not real_name or not student_id:
        # 尝试从页面中的 JSON 数据提取
        name_match = re.search(r'"(?:name|realName|userName)"\s*:\s*"([^"]+)"', text)
        id_match = re.search(r'"(?:usercode|studentId|uid|userName)"\s*:\s*"(\d+)"', text)
        if name_match:
            real_name = real_name or unescape(name_match.group(1))
        if id_match:
            student_id = student_id or id_match.group(1)

    if real_name and student_id:
        return {"real_name": real_name, "student_id": student_id}

    # 如果所有方法都失败，返回错误
    raise RuntimeError(
        "无法从 USTB 统一认证获取用户信息。"
        "请确认微信扫码后已成功完成认证。"
    )


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
        # 清理过期会话
        client = session.get("httpx_client")
        if client:
            try:
                client.close()
            except Exception:
                pass
        del _ustb_sso_sessions[session_id]
        raise HTTPException(status_code=410, detail="二维码已过期，请重新获取")

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
        # 清理过期会话
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
