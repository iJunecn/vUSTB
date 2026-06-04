from __future__ import annotations

from dataclasses import dataclass

import httpx


@dataclass(slots=True)
class ByytUserInfo:
    user_name: str
    user_name_alt: str
    user_school: str
    user_school_alt: str
    user_id: str

    def to_dict(self) -> dict[str, str]:
        return {
            "user_name": self.user_name,
            "user_name_alt": self.user_name_alt,
            "user_school": self.user_school,
            "user_school_alt": self.user_school_alt,
            "user_id": self.user_id,
        }


def fetch_user_info(client: httpx.Client) -> ByytUserInfo:
    response = client.post("https://byyt.ustb.edu.cn/user/me")
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("BYYT 用户信息返回格式异常")

    user_info = ByytUserInfo(
        user_name=str(payload.get("xm", "")).strip(),
        user_name_alt=str(payload.get("xm_en", "") or "").strip(),
        user_school=str(payload.get("bmmc", "") or "").strip(),
        user_school_alt=str(payload.get("bmmc_en", "") or "").strip(),
        user_id=str(payload.get("yhdm", "")).strip(),
    )
    if not user_info.user_name or not user_info.user_id:
        raise ValueError("BYYT 用户信息缺少学号或姓名")
    return user_info
