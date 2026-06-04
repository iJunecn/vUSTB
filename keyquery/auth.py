from __future__ import annotations

from dataclasses import dataclass
import base64
import threading
from typing import Any

from ustb_sso import HttpxSession, QrAuthProcedure

from .byyt import ByytUserInfo, fetch_user_info
from .config import Settings


@dataclass(slots=True)
class AuthState:
    run_id: int
    status: str
    message: str
    error: str = ""
    qr_data_url: str = ""
    user: ByytUserInfo | None = None


class AuthFlow:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._next_run_id = 0
        self._states: dict[int, AuthState] = {}

    def begin(self) -> int:
        with self._lock:
            self._next_run_id += 1
            run_id = self._next_run_id
            self._states[run_id] = AuthState(
                run_id=run_id,
                status="starting",
                message="正在生成二维码",
            )
            return run_id

    def reset(self, run_id: int | None = None) -> None:
        with self._lock:
            if run_id is None or run_id <= 0:
                return
            self._states.pop(run_id, None)

    def update(self, run_id: int, **changes: Any) -> None:
        with self._lock:
            state = self._states.get(run_id)
            if not state:
                return
            for key, value in changes.items():
                setattr(state, key, value)

    def snapshot(
        self,
        settings: Settings,
        run_id: int | None = None,
        claimed_count: int = 0,
        remaining_count: int = 0,
        claim_limit: int | None = None,
        claims: list[dict[str, Any]] | None = None,
        available_count: int = 0,
    ) -> dict[str, Any]:
        with self._lock:
            state = self._states.get(run_id or 0)
            claim_limit_value = claim_limit if claim_limit is not None else settings.max_keys_per_user
            if not state:
                return {
                    "run_id": 0,
                    "status": "idle",
                    "message": "等待扫码认证",
                    "error": "",
                    "qr_data_url": "",
                    "user": None,
                    "claims": [],
                    "claim_count": 0,
                    "claim_limit": claim_limit_value,
                    "remaining_count": 0,
                    "available_count": available_count,
                    "can_claim": False,
                }

            can_claim = bool(state.user) and remaining_count > 0 and available_count > 0
            return {
                "run_id": state.run_id,
                "status": state.status,
                "message": state.message,
                "error": state.error,
                "qr_data_url": state.qr_data_url,
                "user": state.user.to_dict() if state.user else None,
                "claims": claims or [],
                "claim_count": claimed_count,
                "claim_limit": claim_limit_value,
                "remaining_count": remaining_count,
                "available_count": available_count,
                "can_claim": can_claim,
            }

    def current_user(self, run_id: int) -> ByytUserInfo | None:
        with self._lock:
            state = self._states.get(run_id)
            return state.user if state else None

    def is_active(self, run_id: int) -> bool:
        with self._lock:
            state = self._states.get(run_id)
            return bool(state and state.status in {"starting", "waiting_scan", "authenticating"})

    def start_auth(self, settings: Settings) -> int:
        run_id = self.begin()
        session = HttpxSession()
        auth = QrAuthProcedure(
            entity_id=settings.byyt_entity_id,
            redirect_uri=settings.byyt_redirect_uri,
            state=settings.byyt_state,
            session=session,
        )

        try:
            auth.open_auth()
            auth.use_wechat_auth().use_qr_code()
            qr_image = auth.get_qr_image()
            qr_data_url = "data:image/png;base64," + base64.b64encode(qr_image).decode("ascii")
            self.update(run_id, status="waiting_scan", message="二维码已生成，请扫码确认", qr_data_url=qr_data_url)
        except Exception as exc:
            self.update(run_id, status="error", message="二维码生成失败", error=str(exc))
            raise

        thread = threading.Thread(target=self._complete_auth, args=(run_id, session, auth), daemon=True)
        thread.start()
        return run_id

    def _complete_auth(self, run_id: int, session: HttpxSession, auth: QrAuthProcedure) -> None:
        try:
            pass_code = auth.wait_for_pass_code()
            auth.complete_auth(pass_code)
            self.update(run_id, status="authenticating", message="认证成功，正在获取个人信息")
            user = fetch_user_info(session.client)
            self.update(run_id, status="ready", message="认证成功", error="", user=user)
        except Exception as exc:
            self.update(run_id, status="error", message="认证失败", error=str(exc))
