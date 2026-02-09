import asyncio
import logging
import os
import uuid
from enum import IntEnum, auto

from telegram import Update, Document
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    ConversationHandler,
    filters,
)

from .config import BotConfig
from .email_client import create_email_provider
from .models import Transaction
from backend.db import init_db
from backend.repository import save_transaction


logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)


class State(IntEnum):
    WAITING_FOR_CLIENT_DETAILS = auto()


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    /start command handler.
    """
    user = update.effective_user
    await update.message.reply_text(
        "🦀 Welcome to Krab Sender!\n\n"
        "Send me a PDF document and I'll guide you through providing the client details."
    )
    logger.info("User %s (%s) started the bot", user.full_name, user.username)


async def handle_document(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Entry point: user sends a document.

    State 1 (from roadmap):
    - Receive File -> Log User/Filename/Time.
    - Prompt for 'Client Details'.
    """
    message = update.message
    user = update.effective_user
    document: Document = message.document

    file_name = document.file_name or "unnamed_file"

    # Store minimal context for next step
    context.user_data["pending_document"] = {
        "file_id": document.file_id,
        "file_name": file_name,
    }

    logger.info(
        "Received document from %s (@%s): %s",
        user.full_name,
        user.username,
        file_name,
    )

    await message.reply_text(
        "📄 Got your document.\n\n"
        "Please reply with the Client Details for this file.\n"
        "Use Format:\n"
        "  - Phone\n"
        "  - Name\n"
        "  - Delivery Address"
    )

    return State.WAITING_FOR_CLIENT_DETAILS


async def handle_client_details(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    State 2 (from roadmap):
    - Wait for text input (client details).
    - Construct Transaction.
    - Forward document & metadata to email (stub in Phase 1).
    """
    message = update.message
    user = update.effective_user

    pending_doc = context.user_data.get("pending_document")
    if not pending_doc:
        await message.reply_text(
            "I couldn't find an associated document. "
            "Please send the PDF again, then provide the client details."
        )
        return ConversationHandler.END

    client_details_text = (message.text or "").strip()
    if not client_details_text:
        await message.reply_text("Please provide some client details as text.")
        return State.WAITING_FOR_CLIENT_DETAILS

    tx = Transaction.new(
        id=str(uuid.uuid4()),
        telegram_name=user.full_name,
        telegram_handle=user.username,
        filename=pending_doc["file_name"],
        client_details=client_details_text,
    )

    # Download the file bytes from Telegram so we can attach it to the email.
    bot = context.bot
    telegram_file = await bot.get_file(pending_doc["file_id"])
    file_bytes = await telegram_file.download_as_bytearray()

    application = context.application
    bot_config: BotConfig = application.bot_data["config"]  # type: ignore[assignment]
    email_provider = create_email_provider(
        provider_name=bot_config.email_provider,
        from_address=bot_config.email_from_address,
        to_address=bot_config.email_to_address,
        smtp_host=bot_config.email_smtp_host,
        smtp_port=bot_config.email_smtp_port,
        smtp_username=bot_config.email_smtp_username,
        smtp_password=bot_config.email_smtp_password,
    )

    logger.info(
        "Processing transaction %s for user %s (@%s) with file %s",
        tx.id,
        tx.telegram_name,
        tx.telegram_handle,
        tx.filename,
    )

    await email_provider.send_transaction_email(
        tx=tx,
        attachment_bytes=bytes(file_bytes),
        attachment_filename=pending_doc["file_name"],
    )

    # Mark as delivered and persist to DB.
    tx.delivery_status = "DELIVERED"
    save_transaction(tx)

    await message.reply_text(
        "✅ Your document and client details have been recorded and queued for email delivery.\n"
        "Keep up the good work👑🤖🦀!"
    )

    # Clear the context for next transaction
    context.user_data.pop("pending_document", None)

    return ConversationHandler.END


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Allow user to cancel the flow.
    """
    user = update.effective_user
    logger.info("User %s canceled the conversation.", user.full_name)
    await update.message.reply_text("❌ Operation cancelled. Send a new document to start again.")
    context.user_data.pop("pending_document", None)
    return ConversationHandler.END


def build_application(config: BotConfig):
    """
    Build the telegram Application with all handlers attached.
    """
    app = (
        ApplicationBuilder()
        .token(config.telegram_bot_token)
        .concurrent_updates(True)
        .build()
    )

    # Make config accessible to handlers via application.bot_data
    app.bot_data["config"] = config

    # Conversation for document → client details
    conv_handler = ConversationHandler(
        entry_points=[MessageHandler(filters.Document.ALL, handle_document)],
        states={
            State.WAITING_FOR_CLIENT_DETAILS: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, handle_client_details),
            ]
        },
        fallbacks=[CommandHandler("cancel", cancel)],
        allow_reentry=True,
    )

    app.add_handler(CommandHandler("start", start))
    app.add_handler(conv_handler)

    return app


def main() -> None:
    """
    Entry point for local development:

        python -m bot.main

    Uses python-telegram-bot's built-in run_polling(), which handles
    initialization, polling, and graceful shutdown internally.
    """
    try:
        # Ensure DB is ready before starting the bot.
        init_db()

        config = BotConfig.from_env()
        app = build_application(config)

        logger.info("Starting Krab Sender bot...")
        app.run_polling()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Krab Sender bot stopped.")


if __name__ == "__main__":
    main()


