"""邮件发送工具 — 从 vSkin 搬运，适配 SQLAlchemy + SiteSetting 表。"""
import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import Header
from email.utils import formataddr, parseaddr

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SiteSetting


class EmailSender:
    """邮件发送服务，配置从数据库 SiteSetting 表读取。"""

    async def _get_settings(self, db: AsyncSession):
        rows = (await db.execute(select(SiteSetting))).scalars().all()
        s = {r.key: r.value for r in rows}
        return {
            "host": s.get("smtp_host", ""),
            "port": int(s.get("smtp_port", "465")),
            "user": s.get("smtp_user", ""),
            "password": s.get("smtp_password", ""),
            "ssl": s.get("smtp_ssl", "true") == "true",
            "sender": s.get("smtp_sender", ""),
            "enabled": s.get("email_verify_enabled", "false") == "true",
            "site_title": s.get("site_title", s.get("site_name", "皮肤站")),
            "email_template_html": s.get("email_template_html", ""),
            "email_verify_ttl": int(s.get("email_verify_ttl", "300")),
        }

    def _default_template(self) -> str:
        return """
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{site_title}} 邮件验证</title>
  </head>
  <body style="margin:0; padding:0; background:#f4f7fb; font-family:'Microsoft YaHei UI','PingFang SC',sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb; padding:24px 12px;">
      <tr>
        <td align="center">
          <table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 10px 30px rgba(35,64,95,0.12);">
            <tr>
              <td style="background:linear-gradient(135deg,#2f78ba,#4f9ad8); padding:24px 32px; color:#ffffff;">
                <div style="font-size:18px; font-weight:700; letter-spacing:0.5px;">{{site_title}}</div>
                <div style="font-size:14px; opacity:0.9; margin-top:6px;">{{action_title}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 8px; color:#1f2a36;">
                <h2 style="margin:0 0 12px; font-size:22px;">您好，</h2>
                <p style="margin:0 0 16px; font-size:14px; line-height:1.7; color:#4a5a6a;">
                  您正在进行 <strong>{{action_title}}</strong> 操作，请使用以下验证码完成验证：
                </p>
                <div style="background:#f1f6fc; border:1px solid #d7e4f2; border-radius:12px; padding:16px; text-align:center;">
                  <span style="font-size:28px; letter-spacing:6px; color:#2f78ba; font-weight:700;">{{code}}</span>
                </div>
                <p style="margin:16px 0 0; font-size:13px; color:#6a7b8c;">验证码有效期约 {{ttl_minutes}} 分钟，请尽快完成验证。</p>
                <p style="margin:10px 0 0; font-size:12px; color:#9aa7b4;">如果这不是您本人操作，请忽略此邮件。</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 28px; color:#9aa7b4; font-size:12px;">此邮件由 {{site_title}} 自动发送，请勿直接回复。</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
""".strip()

    def _render_template(self, template: str, values: dict) -> str:
        html = template
        for key, value in values.items():
            html = html.replace("{{" + key + "}}", str(value))
        return html

    async def send_verification_code(self, db: AsyncSession, to_email: str, code: str, type: str):
        s = await self._get_settings(db)
        if not s["enabled"]:
            return False

        if not s["host"]:
            print("SMTP host not configured.")
            return False

        site_title = str(s["site_title"] or "皮肤站")
        ttl_minutes = max(1, round(s["email_verify_ttl"] / 60))

        if type == "register":
            action_title = "注册验证"
            subject = f"{site_title} 注册验证码"
        elif type == "reset":
            action_title = "密码重置"
            subject = f"{site_title} 密码重置验证码"
        else:
            return False

        template = s["email_template_html"] or self._default_template()
        body = self._render_template(
            template,
            {
                "site_title": site_title,
                "code": code,
                "type": type,
                "action_title": action_title,
                "ttl_minutes": ttl_minutes,
            },
        )

        message = MIMEMultipart()
        sender_name, sender_addr = parseaddr(s["sender"])
        if not sender_addr and s["user"]:
            sender_addr = s["user"]

        if sender_name:
            message["From"] = formataddr((Header(sender_name, "utf-8").encode(), sender_addr))
        else:
            message["From"] = sender_addr

        message["To"] = to_email
        message["Subject"] = Header(subject, "utf-8")
        message.attach(MIMEText(body, "html", "utf-8"))

        try:
            await aiosmtplib.send(
                message,
                hostname=s["host"],
                port=s["port"],
                username=s["user"],
                password=s["password"],
                use_tls=s["ssl"],
            )
            return True
        except Exception as e:
            print(f"Failed to send email: {e}")
            return False


email_sender = EmailSender()
