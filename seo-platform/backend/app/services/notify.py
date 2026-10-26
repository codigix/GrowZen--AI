"""Email notifications over SMTP (optional: does nothing when SMTP is not configured)."""
import smtplib
from email.message import EmailMessage

from ..config import get_settings


def send_email(to: str, subject: str, body: str, attachments: list[tuple[str, bytes, str]] | None = None) -> bool:
    s = get_settings()
    if not (s.smtp_host and s.smtp_from and to):
        return False
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = s.smtp_from, to, subject
    msg.set_content(body)
    for name, data, mime in attachments or []:
        main, sub = mime.split("/", 1)
        msg.add_attachment(data, maintype=main, subtype=sub, filename=name)
    with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=30) as smtp:
        smtp.starttls()
        if s.smtp_user:
            smtp.login(s.smtp_user, s.smtp_password)
        smtp.send_message(msg)
    return True
