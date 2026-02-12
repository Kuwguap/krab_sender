"""
Email delivery abstraction.

In Phase 1 we implement a simple stub that logs the intended email payload.
In later phases this can be swapped for SendGrid, Mailgun, SES, etc.
"""

import logging
import time
from dataclasses import dataclass
from typing import Protocol, Optional

from email.message import EmailMessage
import smtplib

from .models import Transaction

logger = logging.getLogger(__name__)


class EmailProvider(Protocol):
    async def send_transaction_email(
        self,
        tx: Transaction,
        attachment_bytes: Optional[bytes],
        attachment_filename: Optional[str],
        recipient_email: Optional[str] = None,
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
        recipient_email: Optional[str] = None,
    ) -> None:
        subject = "CLIENT"
        body = (
            f"{tx.client_details}\n\n"
            f"Timestamp (UTC): {tx.timestamp.isoformat()}"
        )

        to_addr = recipient_email or self.to_address

        # For now we just log to stdout. Replace this with real email API calls later.
        print("=== Krab Sender Email Stub ===")
        print(f"From: {self.from_address}")
        print(f"To:   {to_addr}")
        print(f"Subj: {subject}")
        print("--- Body ---")
        print(body)
        print("=== End Email Stub ===")


@dataclass
class SmtpEmailProvider:
    """
    Simple SMTP provider suitable for Gmail, mail.com, and other SMTP servers.

    For Gmail:
      - host: smtp.gmail.com
      - port: 587 (STARTTLS) or 465 (SSL)
      - username: your full Gmail address
      - password: Google App Password (NOT your normal login password)
    
    For mail.com:
      - host: smtp.mail.com
      - port: 587 (STARTTLS) or 465 (SSL)
      - username: your full mail.com address
      - password: your regular account password (ensure SMTP is enabled in account settings)
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
        recipient_email: Optional[str] = None,
    ) -> None:
        subject = "CLIENT"
        body = (
            f"{tx.client_details}\n\n"
            f"Timestamp (UTC): {tx.timestamp.isoformat()}"
        )

        to_addr = recipient_email or self.to_address

        logger.info(f"Preparing email - Body length: {len(body)}, Client details length: {len(tx.client_details)}")
        logger.debug(f"Email body content: {body[:200]}...")  # Log first 200 chars

        # Verify body is not empty before creating message
        if not body or not body.strip():
            logger.error("❌ Email body is empty!")
            raise ValueError("Email body is empty - cannot send email without content")

        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = self.from_address
        msg["To"] = to_addr
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
        # Support both port 465 (SSL) and 587 (STARTTLS)
        # Increased timeout for large attachments and slow connections
        connection_timeout = 30  # Connection timeout
        send_timeout = 60  # Timeout for sending (especially with attachments)
        
        # Try sending with retry logic
        max_retries = 2
        last_error = None
        
        for attempt in range(max_retries):
            try:
                logger.info(f"Attempting SMTP connection (attempt {attempt + 1}/{max_retries}) to {self.host}:{self.port}")
                
                if self.port == 465:
                    # Use SSL for Port 465
                    server = smtplib.SMTP_SSL(self.host, self.port, timeout=connection_timeout)
                else:
                    # Use STARTTLS for Port 587
                    server = smtplib.SMTP(self.host, self.port, timeout=connection_timeout)
                    server.starttls()
                
                # Set timeout for send operations
                server.timeout = send_timeout
                
                with server:
                    server.login(self.username, self.password)
                    logger.info(f"Sending email to {to_addr} with body length: {len(body)}")
                    
                    # Send the message with explicit timeout handling
                    server.send_message(msg)
                    logger.info(f"✅ Email sent successfully to {to_addr}")
                    return  # Success, exit the retry loop
                    
            except (smtplib.SMTPServerDisconnected, ConnectionError, OSError) as e:
                last_error = e
                error_msg = str(e)
                logger.warning(f"SMTP connection error on attempt {attempt + 1}: {error_msg}")
                
                # If port 587 fails and we haven't tried 465 yet, suggest it
                if self.port == 587 and attempt == 0:
                    logger.info("Port 587 failed, but will retry. Consider using port 465 (SSL) if this persists.")
                
                if attempt < max_retries - 1:
                    wait_time = (attempt + 1) * 2  # Exponential backoff: 2s, 4s
                    logger.info(f"Retrying in {wait_time} seconds...")
                    time.sleep(wait_time)
                else:
                    # Last attempt failed
                    if self.port == 587:
                        logger.error(
                            f"❌ SMTP Server disconnected after {max_retries} attempts: {error_msg}. "
                            f"Port {self.port} may be blocked. Try using port 465 (SSL) instead."
                        )
                    else:
                        logger.error(f"❌ SMTP Server disconnected after {max_retries} attempts: {error_msg}")
                    raise
                    
            except smtplib.SMTPAuthenticationError as e:
                logger.error(f"❌ SMTP Authentication failed: {e}. Check your password/credentials.")
                raise
                
            except Exception as e:
                last_error = e
                logger.error(f"❌ Unexpected email error on attempt {attempt + 1}: {e}", exc_info=True)
                if attempt < max_retries - 1:
                    wait_time = (attempt + 1) * 2
                    logger.info(f"Retrying in {wait_time} seconds...")
                    time.sleep(wait_time)
                else:
                    raise
        
        # If we get here, all retries failed
        if last_error:
            raise last_error


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


