"""邮件发送工具 — 硬编码 SMTP 配置（与 GitHub/爱发电同模式）。"""
import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import Header
from email.utils import formataddr, parseaddr

from app.config import settings


def _slot_label(slot_type: str) -> str:
    """将时段枚举值转为中文。"""
    return {"am": "上午", "pm": "下午"}.get(slot_type, slot_type)


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
                  <img src="https://www.ustb.world/img/logo.webp" alt="像素北科" width="48" height="48" style="display:inline-block; width:48px; height:48px; border-radius:12px; background:#ffffff; vertical-align:middle;" />
                </div>
                <div style="font-size:22px; font-weight:700; color:#ffffff; letter-spacing:1.5px;">像素北科</div>
                <div style="font-size:13px; color:rgba(255,255,255,0.85); margin-top:6px;">北京科技大学元宇宙体素工作坊</div>
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

    def _booking_notification_template(self) -> str:
        """打印预约待审批通知邮件模板 — 蓝白风格，与验证码邮件一致。"""
        return """
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{site_title}} 打印预约审批通知</title>
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
                  <img src="https://www.ustb.world/img/logo.webp" alt="像素北科" width="48" height="48" style="display:inline-block; width:48px; height:48px; border-radius:12px; background:#ffffff; vertical-align:middle;" />
                </div>
                <div style="font-size:22px; font-weight:700; color:#ffffff; letter-spacing:1.5px;">像素北科</div>
                <div style="font-size:13px; color:rgba(255,255,255,0.85); margin-top:6px;">北京科技大学元宇宙体素工作坊</div>
              </td>
            </tr>
            <!-- 正文区 -->
            <tr>
              <td style="padding:32px 36px 12px; color:#1e293b;">
                <h2 style="margin:0 0 14px; font-size:20px; font-weight:600;">新的打印预约待审批</h2>
                <p style="margin:0 0 18px; font-size:14px; line-height:1.8; color:#475569;">
                  以下用户提交了新的打印预约申请，请尽快审批：
                </p>
                <!-- 预约详情 -->
                <div style="background:#f0f5ff; border:2px solid #bfdbfe; border-radius:14px; padding:18px 24px; font-size:14px; line-height:2; color:#475569;">
                  <strong style="color:#1a56db;">预约用户</strong><br />
                  用户名：{{username}}<br />
                  真实姓名：{{real_name}}<br />
                  学号：{{student_id}}<br />
                  手机号：{{phone}}<br />
                  邮箱：{{email}}<br />
                  <strong style="color:#1a56db;">预约信息</strong><br />
                  日期：{{date}}<br />
                  时段：{{slot_label}}<br />
                  打印机：{{printer_name}}<br />
                  文件名：{{file_name}}<br />
                  用途：{{purpose}}<br />
                  重量：{{weight}} 克<br />
                  费用：{{cost}} 贝壳积分
                </div>
                <!-- 审批按钮 -->
                <div style="text-align:center; margin-top:24px;">
                  <a href="{{approval_url}}" target="_blank" style="display:inline-block; padding:12px 32px; background:linear-gradient(135deg,#1a56db,#3b82f6); color:#ffffff; font-size:16px; font-weight:600; border-radius:12px; text-decoration:none; letter-spacing:0.5px;">
                    前往审批
                  </a>
                </div>
                <p style="margin:18px 0 0; font-size:13px; color:#64748b;">点击上方按钮可直接跳转到管理面板审批页面。</p>
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

    async def send_booking_notification(self, db, to_email: str, booking_info: dict):
        """发送打印预约待审批通知邮件。"""
        s = self._get_settings()
        if not s["enabled"] or not s["host"]:
            return False

        site_title = str(s["site_title"] or "像素北科")

        # 构建审批链接
        public_url = s.get("public_url", "") or "https://www.ustb.world"
        approval_url = f"{public_url.rstrip('/')}/admin/print"

        template = self._booking_notification_template()
        body = self._render_template(
            template,
            {
                "site_title": site_title,
                "username": booking_info.get("username", "未知"),
                "real_name": booking_info.get("real_name", "未知"),
                "student_id": booking_info.get("student_id", "未知"),
                "phone": booking_info.get("phone", "未知"),
                "email": booking_info.get("email", "未知"),
                "date": booking_info.get("date", ""),
                "slot_label": _slot_label(booking_info.get("slot_type", "")),
                "printer_name": booking_info.get("printer_name", "未指定"),
                "file_name": booking_info.get("file_name", "未指定"),
                "purpose": booking_info.get("purpose", "未说明"),
                "weight": booking_info.get("weight", 0),
                "cost": booking_info.get("cost", 0),
                "approval_url": approval_url,
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
        message["Subject"] = Header(f"{site_title} — 新的打印预约待审批", "utf-8")
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
            print(f"Failed to send booking notification email: {e}")
            return False


email_sender = EmailSender()
