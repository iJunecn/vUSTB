"""微软账户登录与 Minecraft 正版验证。"""
import aiohttp
import urllib.parse
from typing import Optional, Dict, Tuple


class MicrosoftAuthService:
    """微软账户认证服务（授权码模式）"""

    OAUTH_AUTHORITY = "https://login.microsoftonline.com/consumers"
    AUTHORIZE_ENDPOINT = f"{OAUTH_AUTHORITY}/oauth2/v2.0/authorize"
    TOKEN_ENDPOINT = f"{OAUTH_AUTHORITY}/oauth2/v2.0/token"

    XBL_AUTH_ENDPOINT = "https://user.auth.xboxlive.com/user/authenticate"
    XSTS_AUTH_ENDPOINT = "https://xsts.auth.xboxlive.com/xsts/authorize"

    MC_LOGIN_ENDPOINT = "https://api.minecraftservices.com/authentication/login_with_xbox"
    MC_PROFILE_ENDPOINT = "https://api.minecraftservices.com/minecraft/profile"
    MC_ENTITLEMENTS_ENDPOINT = "https://api.minecraftservices.com/entitlements/mcstore"

    SCOPE = "XboxLive.signin offline_access"

    def __init__(self, client_id: str, client_secret: str, redirect_uri: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri

    def get_authorization_url(self, state: str = None) -> str:
        params = {
            "client_id": self.client_id,
            "response_type": "code",
            "redirect_uri": self.redirect_uri,
            "scope": self.SCOPE,
        }
        if state:
            params["state"] = state
        query_string = urllib.parse.urlencode(params)
        return f"{self.AUTHORIZE_ENDPOINT}?{query_string}"

    async def exchange_code_for_token(self, code: str) -> Dict:
        async with aiohttp.ClientSession() as session:
            data = {
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "code": code,
                "redirect_uri": self.redirect_uri,
                "grant_type": "authorization_code",
            }
            async with session.post(
                self.TOKEN_ENDPOINT,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    raise Exception(f"Failed to exchange code for token: {error_text}")
                return await resp.json()

    async def authenticate_xbl(self, ms_access_token: str) -> Tuple[str, str]:
        async with aiohttp.ClientSession() as session:
            payload = {
                "Properties": {
                    "AuthMethod": "RPS",
                    "SiteName": "user.auth.xboxlive.com",
                    "RpsTicket": f"d={ms_access_token}",
                },
                "RelyingParty": "http://auth.xboxlive.com",
                "TokenType": "JWT",
            }
            async with session.post(
                self.XBL_AUTH_ENDPOINT,
                json=payload,
                headers={"Content-Type": "application/json", "Accept": "application/json"},
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    raise Exception(f"XBL authentication failed: {error_text}")
                result = await resp.json()
                xbl_token = result["Token"]
                user_hash = result["DisplayClaims"]["xui"][0]["uhs"]
                return xbl_token, user_hash

    async def authenticate_xsts(self, xbl_token: str) -> Tuple[str, str]:
        async with aiohttp.ClientSession() as session:
            payload = {
                "Properties": {"SandboxId": "RETAIL", "UserTokens": [xbl_token]},
                "RelyingParty": "rp://api.minecraftservices.com/",
                "TokenType": "JWT",
            }
            async with session.post(
                self.XSTS_AUTH_ENDPOINT,
                json=payload,
                headers={"Content-Type": "application/json"},
            ) as resp:
                if resp.status != 200:
                    result = await resp.json()
                    xerr = result.get("XErr")
                    error_messages = {
                        2148916233: "This Microsoft account doesn't have an Xbox account.",
                        2148916238: "This account is a child account and needs to be added to a family",
                        2148916235: "Xbox Live is not available in your country/region",
                    }
                    if xerr in error_messages:
                        raise Exception(error_messages[xerr])
                    error_text = await resp.text()
                    raise Exception(f"XSTS authentication failed: {error_text}")
                result = await resp.json()
                xsts_token = result["Token"]
                user_hash = result["DisplayClaims"]["xui"][0]["uhs"]
                return xsts_token, user_hash

    async def authenticate_minecraft(self, user_hash: str, xsts_token: str) -> str:
        async with aiohttp.ClientSession() as session:
            payload = {"identityToken": f"XBL3.0 x={user_hash};{xsts_token}"}
            async with session.post(
                self.MC_LOGIN_ENDPOINT,
                json=payload,
                headers={"Content-Type": "application/json"},
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    raise Exception(f"Minecraft authentication failed: {error_text}")
                result = await resp.json()
                return result["access_token"]

    async def check_game_ownership(self, mc_access_token: str) -> bool:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                self.MC_ENTITLEMENTS_ENDPOINT,
                headers={"Authorization": f"Bearer {mc_access_token}"},
            ) as resp:
                if resp.status == 200:
                    result = await resp.json()
                    return len(result.get("items", [])) > 0
                return False

    async def get_minecraft_profile(self, mc_access_token: str) -> Optional[Dict]:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                self.MC_PROFILE_ENDPOINT,
                headers={"Authorization": f"Bearer {mc_access_token}"},
            ) as resp:
                if resp.status == 404:
                    return None
                if resp.status != 200:
                    error_text = await resp.text()
                    raise Exception(f"Failed to get profile: {error_text}")
                return await resp.json()

    async def complete_auth_flow(self, ms_access_token: str) -> Dict:
        xbl_token, user_hash = await self.authenticate_xbl(ms_access_token)
        xsts_token, user_hash = await self.authenticate_xsts(xbl_token)
        mc_access_token = await self.authenticate_minecraft(user_hash, xsts_token)
        has_game = await self.check_game_ownership(mc_access_token)
        profile = await self.get_minecraft_profile(mc_access_token)
        return {
            "mc_access_token": mc_access_token,
            "profile": profile,
            "has_game": has_game,
        }


async def download_texture(url: str) -> bytes:
    """下载皮肤或披风纹理"""
    timeout = aiohttp.ClientTimeout(total=10)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(url) as resp:
            if resp.status == 200:
                return await resp.read()
            raise Exception(f"Failed to download texture from {url}")
