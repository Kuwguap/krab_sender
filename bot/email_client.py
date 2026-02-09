"""
Email delivery abstraction.

In Phase 1 we implement a simple stub that logs the intended email payload.
In later phases this can be swapped for SendGrid, Mailgun, SES, etc.
"""

from dataclasses import dataclass
from typing import Protocol, Optional

from email.message import EmailMessage
import smtplib

from .models import Transaction


class EmailProvider(Protocol):
    async def send_transaction_email(
        self,
        tx: Transaction,
        attachment_bytes: Optional[bytes],
        attachment_filename: Optional[str],
    ) -> None:
        ...


@dataclass
class StubEmailProvider:
    """
    Stub provider that prints the email content instead of sending it.

    This allows you to verify:
    - Subject and body formatting
    - Attachment filename
    - Captured metadata
    """

    from_address: str
    to_address: str

    async def send_transaction_email(
        self,
        tx: Transaction,
        attachment_bytes: Optional[bytes],
        attachment_filename: Optional[str],
    ) -> None:
        subject = "CLIENT"
        body = (
            f"{tx.client_details}\n\n"
            f"Sent by: {tx.telegram_name} (@{tx.telegram_handle or 'unknown'})\n"
            f"Source: Krab Sender by @johnnybravomadeit\n"
            f"Attachment: {tx.filename}\n"
            f"Timestamp (UTC): {tx.timestamp.isoformat()}"
        )

        # For now we just log to stdout. Replace this with real email API calls later.
        print("=== Krab Sender Email Stub ===")
        print(f"From: {self.from_address}")
        print(f"To:   {self.to_address}")
        print(f"Subj: {subject}")
        print("--- Body ---")
        print(body)
        print("=== End Email Stub ===")


@dataclass
class SmtpEmailProvider:
    """
    Simple SMTP provider suitable for Gmail.

    For Gmail:
      - host: smtp.gmail.com
      - port: 587 (STARTTLS)
      - username: your full Gmail address
      - password: Google App Password (NOT your normal login password)
    """

    host: str
    port: int
    username: str
    password: str
    from_address: str
    to_address: str

    async def send_transaction_email(
        self,
        tx: Transaction,
        attachment_bytes: Optional[bytes],
        attachment_filename: Optional[str],
    ) -> None:
        subject = "CLIENT"
        body = (
            f"{tx.client_details}\n\n"
            f"Sent by: {tx.telegram_name} (@{tx.telegram_handle or 'unknown'})\n"
            f"Source: Krab Sender by @johnnybravomadeit\n"
            f"Attachment: {tx.filename}\n"
            f"Timestamp (UTC): {tx.timestamp.isoformat()}"
        )

        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = self.from_address
        msg["To"] = self.to_address
        msg.set_content(body)

        if attachment_bytes is not None and attachment_filename:
            # Assume PDF or generic binary; clients will infer from filename.
            msg.add_attachment(
                attachment_bytes,
                maintype="application",
                subtype="octet-stream",
                filename=attachment_filename,
            )

        # Blocking SMTP call inside async: acceptable for low volume bot usage.
        with smtplib.SMTP(self.host, self.port) as server:
            server.starttls()
            server.login(self.username, self.password)
            server.send_message(msg)


def create_email_provider(
    provider_name: str,
    from_address: str,
    to_address: str,
    smtp_host: str,
    smtp_port: int,
    smtp_username: str,
    smtp_password: str,
) -> EmailProvider:
    """
    Factory for email providers.

    Today:
        - 'stub' → StubEmailProvider
        - 'gmail_smtp' → SmtpEmailProvider (using env-provided SMTP settings)
    Tomorrow:
        - 'sendgrid' → SendGridEmailProvider(...)
        - 'mailgun' → MailgunEmailProvider(...)
    """
    normalized = provider_name.lower().strip()
    if normalized in ("stub", "", "local"):
        return StubEmailProvider(from_address=from_address, to_address=to_address)

    if normalized in ("gmail_smtp", "smtp"):
        return SmtpEmailProvider(
            host=smtp_host,
            port=smtp_port,
            username=smtp_username,
            password=smtp_password,
            from_address=from_address,
            to_address=to_address,
        )

    # Fallback to stub for unknown providers to avoid crashes.
    return StubEmailProvider(from_address=from_address, to_address=to_address)


