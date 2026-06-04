from __future__ import annotations

from flask import Flask, abort, jsonify, redirect, render_template_string, request, url_for
from ustb_sso import prefabs

from .auth import AuthFlow
from .byyt import ByytUserInfo
from .config import Settings
from .db import KeyStore
from .templates import ADMIN_TEMPLATE, INDEX_TEMPLATE

DEFAULT_AUTH = dict(prefabs.BYYT_USTB_EDU_CN)


def _parse_user_form(data: dict[str, str]) -> ByytUserInfo:
    return ByytUserInfo(
        user_name=data.get("user_name", "").strip(),
        user_name_alt=data.get("user_name_alt", "").strip(),
        user_school=data.get("user_school", "").strip(),
        user_school_alt=data.get("user_school_alt", "").strip(),
        user_id=data.get("student_id", "").strip(),
    )


def create_app(settings: Settings | None = None, store: KeyStore | None = None, auth: AuthFlow | None = None) -> Flask:
    settings = settings or Settings.from_env()
    store = store or KeyStore(settings.database_path)
    auth = auth or AuthFlow()

    app = Flask(__name__)
    app.config.update(SETTINGS=settings, STORE=store, AUTH=auth)

    def snapshot(run_id: int | None = None) -> dict:
        current_user = auth.current_user(run_id or 0)
        claims = store.get_user_claims(current_user.user_id) if current_user else []
        claim_count = len(claims)
        remaining_count = max(0, settings.max_keys_per_user - claim_count) if current_user else 0
        return auth.snapshot(
            settings=settings,
            run_id=run_id,
            claimed_count=claim_count,
            remaining_count=remaining_count,
            claim_limit=settings.max_keys_per_user,
            claims=[claim.to_dict() for claim in claims],
            available_count=store.count_available_keys(),
        )

    def require_admin_code() -> str:
        code = request.values.get("code", "")
        if code != settings.admin_code:
            abort(403)
        return code

    def admin_redirect(message: str) -> str:
        return url_for("admin_index", code=settings.admin_code, flash=message)

    @app.get("/")
    def index() -> str:
        state = snapshot(0)
        return render_template_string(INDEX_TEMPLATE, state=state, defaults=DEFAULT_AUTH)

    @app.get("/api/status")
    def api_status():
        run_id = int(request.args.get("run_id") or 0)
        return jsonify(snapshot(run_id))

    @app.post("/api/auth/start")
    def api_auth_start():
        try:
            run_id = auth.start_auth(settings)
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 500
        return jsonify({"ok": True, "run_id": run_id, "state": snapshot(run_id)})

    @app.post("/api/auth/reset")
    def api_auth_reset():
        payload = request.get_json(silent=True) or {}
        run_id = int(payload.get("run_id") or request.args.get("run_id") or 0)
        auth.reset(run_id)
        return jsonify({"ok": True, "state": snapshot(0)})

    @app.post("/api/auth/claim")
    def api_auth_claim():
        payload = request.get_json(silent=True) or {}
        run_id = int(payload.get("run_id") or 0)
        current_user = auth.current_user(run_id)
        if not current_user:
            return jsonify({"ok": False, "error": "请先完成认证"}), 409

        result = store.claim_key_for_user(current_user, settings.max_keys_per_user)
        if result.status == "claimed" and result.record:
            auth.update(run_id, message="申领成功")
            return jsonify({
                "ok": True,
                "status": result.status,
                "message": f"申领成功：{result.record.key_value}",
                "record": result.record.to_dict(),
                "state": snapshot(run_id),
            })

        auth.update(run_id, message=result.message)
        status_code = 409 if result.status in {"limit_reached", "empty", "conflict"} else 400
        return jsonify({
            "ok": False,
            "status": result.status,
            "error": result.message,
            "state": snapshot(run_id),
        }), status_code

    @app.get("/admin")
    def admin_index():
        require_admin_code()
        filter_mode = request.args.get("filter", "all")
        keys = [key.to_dict() for key in store.list_keys()]
        if filter_mode == "bound":
            keys = [key for key in keys if key["bound_student_id"]]
        elif filter_mode == "unbound":
            keys = [key for key in keys if not key["bound_student_id"]]
        return render_template_string(
            ADMIN_TEMPLATE,
            keys=keys,
            available_count=store.count_available_keys(),
            admin_code=settings.admin_code,
            flash=request.args.get("flash", ""),
            current_filter=filter_mode,
        )

    @app.post("/admin/keys/import")
    def admin_import_keys():
        require_admin_code()
        raw = request.form.get("keys", "")
        added = store.add_keys(raw.splitlines())
        return redirect(admin_redirect(f"已导入 {added} 个 Key"))

    @app.post("/admin/keys/<int:key_id>/bind")
    def admin_bind_key(key_id: int):
        require_admin_code()
        user = _parse_user_form(request.form)
        if not user.user_name or not user.user_id:
            return redirect(admin_redirect("请填写至少姓名和学号"))
        try:
            store.bind_key(key_id, user)
        except KeyError:
            abort(404)
        return redirect(admin_redirect(f"已绑定 Key #{key_id}"))

    @app.post("/admin/keys/<int:key_id>/unbind")
    def admin_unbind_key(key_id: int):
        require_admin_code()
        try:
            store.unbind_key(key_id)
        except KeyError:
            abort(404)
        return redirect(admin_redirect(f"已解绑 Key #{key_id}"))

    @app.post("/admin/keys/<int:key_id>/delete")
    def admin_delete_key(key_id: int):
        require_admin_code()
        try:
            store.delete_key(key_id)
        except KeyError:
            abort(404)
        return redirect(admin_redirect(f"已删除 Key #{key_id}"))

    return app


def main() -> None:
    settings = Settings.from_env()
    app = create_app(settings=settings)
    app.run(host="0.0.0.0", port=settings.port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
