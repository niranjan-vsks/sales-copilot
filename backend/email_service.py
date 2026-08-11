"""SMTP email service for transactional emails (OTP verification)."""
import os
import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)


def send_otp_email(to_email: str, otp: str, name: str) -> None:
    smtp_host = os.environ.get("SMTP_HOST", "")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER", "")
    smtp_password = os.environ.get("SMTP_PASSWORD", "")
    from_email = os.environ.get("SMTP_FROM_EMAIL", smtp_user)

    if not all([smtp_host, smtp_user, smtp_password]):
        raise ValueError("SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASSWORD")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Your Sales Copilot verification code"
    msg["From"] = f"Sales Copilot <{from_email}>"
    msg["To"] = to_email

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0f0f10;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#141416;border:1px solid #1f2022;">
        <tr><td style="padding:40px;">
          <div style="margin-bottom:28px;">
            <span style="display:inline-block;width:36px;height:36px;background:#FF4500;vertical-align:middle;margin-right:10px;"></span>
            <span style="font-size:20px;font-weight:700;color:#F2F3F5;vertical-align:middle;">Sales Copilot</span>
          </div>
          <p style="color:#9CA3AF;font-size:14px;margin:0 0 6px;">Hi {name},</p>
          <p style="color:#F2F3F5;font-size:16px;margin:0 0 28px;">Here is your verification code:</p>
          <div style="background:#0f0f10;border:1px solid #1f2022;padding:24px;text-align:center;margin-bottom:28px;">
            <span style="font-size:40px;font-weight:700;letter-spacing:12px;color:#FF4500;">{otp}</span>
          </div>
          <p style="color:#9CA3AF;font-size:13px;margin:0 0 8px;">
            This code expires in <strong style="color:#F2F3F5;">10 minutes</strong>.
          </p>
          <p style="color:#9CA3AF;font-size:13px;margin:0;">
            If you did not request this, ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()  # RFC 3207 requires a second EHLO after STARTTLS
        server.login(smtp_user, smtp_password)
        server.sendmail(from_email, to_email, msg.as_string())

    logger.info("OTP email sent to %s", to_email)
