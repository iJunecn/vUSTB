"""邮件发送工具 — 硬编码 SMTP 配置（与 GitHub/爱发电同模式）。"""
import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import Header
from email.utils import formataddr, parseaddr

from app.config import settings


class EmailSender:
    """邮件发送服务，配置从 config.py 硬编码值读取。"""

    def _get_settings(self) -> dict:
        return {
            "host": settings.smtp_host,
            "port": settings.smtp_port,
            "user": settings.smtp_user,
            "password": settings.smtp_password,
            "ssl": settings.smtp_use_tls,
            "sender": settings.smtp_from,
            "enabled": settings.email_verify_enabled,
            "site_title": settings.site_name,
        }

    def _default_template(self) -> str:
        """像素北科风格邮件模板 — 蓝白现代风格，顶部 LOGO + 名称居中。"""
        return """
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{site_title}} 邮件验证</title>
  </head>
  <body style="margin:0; padding:0; background:#eef3f9; font-family:'Microsoft YaHei UI','PingFang SC','Helvetica Neue',sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f9; padding:32px 12px;">
      <tr>
        <td align="center">
          <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:20px; overflow:hidden; box-shadow:0 8px 32px rgba(30,64,110,0.10);">
            <!-- 顶部品牌区 -->
            <tr>
              <td style="background:linear-gradient(135deg,#1a56db,#3b82f6); padding:36px 32px 28px; text-align:center;">
                <div style="margin-bottom:10px;">
                  <span style="display:inline-block; width:48px; height:48px; line-height:48px; background:#ffffff; border-radius:12px; font-size:22px; font-weight:800; color:#1a56db; text-align:center; vertical-align:middle;">像</span>
                </div>
                <div style="font-size:22px; font-weight:700; color:#ffffff; letter-spacing:1.5px;">像素北科</div>
                <div style="font-size:13px; color:rgba(255,255,255,0.85); margin-top:6px;">vUSTB · 北京科技大学元宇宙体素工作坊</div>
              </td>
            </tr>
            <!-- 正文区 -->
            <tr>
              <td style="padding:32px 36px 12px; color:#1e293b;">
                <h2 style="margin:0 0 14px; font-size:20px; font-weight:600;">您好，</h2>
                <p style="margin:0 0 18px; font-size:14px; line-height:1.8; color:#475569;">
                  您正在进行 <strong style="color:#1a56db;">{{action_title}}</strong> 操作，请使用以下验证码完成验证：
                </p>
                <div style="background:#f0f5ff; border:2px solid #bfdbfe; border-radius:14px; padding:18px 24px; text-align:center;">
                  <span style="font-size:32px; letter-spacing:8px; color:#1a56db; font-weight:700; font-family:'Courier New',monospace;">{{code}}</span>
                </div>
                <p style="margin:18px 0 0; font-size:13px; color:#64748b;">验证码有效期约 {{ttl_minutes}} 分钟，请尽快完成验证。</p>
                <p style="margin:10px 0 0; font-size:12px; color:#94a3b8;">如果这不是您本人操作，请忽略此邮件。</p>
              </td>
            </tr>
            <!-- 底部 -->
            <tr>
              <td style="padding:18px 36px 28px; color:#94a3b8; font-size:12px; border-top:1px solid #e2e8f0;">
                此邮件由 像素北科 自动发送，请勿直接回复。
              </td>
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

    async def send_verification_code(self, db, to_email: str, code: str, type: str):
        s = self._get_settings()
        if not s["enabled"]:
            return False

        if not s["host"]:
            print("SMTP host not configured.")
            return False

        site_title = str(s["site_title"] or "像素北科")
        ttl_minutes = 10  # 验证码有效期 10 分钟

        if type == "register":
            action_title = "注册验证"
            subject = f"{site_title} 注册验证码"
        elif type == "reset":
            action_title = "密码重置"
            subject = f"{site_title} 密码重置验证码"
        else:
            return False

        template = self._default_template()
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
        sender_name = s["sender"] or site_title
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
