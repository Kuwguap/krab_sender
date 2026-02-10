import asyncio
import logging
import os
import uuid
from enum import IntEnum, auto
from typing import List, Dict

import httpx
from telegram import Update, Document, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    ConversationHandler,
    CallbackQueryHandler,
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
    WAITING_FOR_RECIPIENT = auto()


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    /start command handler.
    """
    user = update.effective_user
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("📋 View Recent Transactions", callback_data="view_transactions")]
    ])
    await update.message.reply_text(
        "🦀 Welcome to Krab Sender!\n\n"
        "Send me a PDF document and I'll guide you through providing the client details.\n\n"
        "You can also view recent transactions using the button below.",
        reply_markup=keyboard,
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
    State 2: After client details, fetch recipients and show selection.
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

    # Store client details for later
    context.user_data["client_details"] = client_details_text

    # Fetch recipients from API
    application = context.application
    bot_config: BotConfig = application.bot_data["config"]  # type: ignore[assignment]

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{bot_config.api_base_url}/recipients")
            if response.status_code == 200:
                recipients: List[Dict] = response.json()
            else:
                recipients = []
    except Exception as e:
        logger.error("Failed to fetch recipients: %s", e)
        recipients = []

    if not recipients:
        await message.reply_text(
            "❌ No recipients configured. Please contact the admin to add recipients."
        )
        context.user_data.pop("pending_document", None)
        context.user_data.pop("client_details", None)
        return ConversationHandler.END

    # Build inline keyboard with recipient names
    keyboard_buttons = []
    for recipient in recipients:
        keyboard_buttons.append([
            InlineKeyboardButton(recipient["name"], callback_data=f"recipient_{recipient['id']}")
        ])

    keyboard = InlineKeyboardMarkup(keyboard_buttons)

    await message.reply_text(
        "✅ Client details received!\n\n"
        "Please select a recipient for this document:",
        reply_markup=keyboard,
    )

    return State.WAITING_FOR_RECIPIENT


async def handle_recipient_selection(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    State 3: User selected a recipient, send the email.
    """
    query = update.callback_query
    await query.answer()

    if not query.data or not query.data.startswith("recipient_"):
        await query.edit_message_text("❌ Invalid selection. Please try again.")
        return ConversationHandler.END

    recipient_id = query.data.replace("recipient_", "")
    pending_doc = context.user_data.get("pending_document")
    client_details_text = context.user_data.get("client_details")

    if not pending_doc or not client_details_text:
        await query.edit_message_text("❌ Session expired. Please start over.")
        context.user_data.pop("pending_document", None)
        context.user_data.pop("client_details", None)
        return ConversationHandler.END

    # Fetch recipient email from API
    application = context.application
    bot_config: BotConfig = application.bot_data["config"]  # type: ignore[assignment]

    recipient_email = None
    recipient_name = None

    try:
        async with httpx.AsyncClient() as client:
            # Fetch recipient email by ID
            response = await client.get(f"{bot_config.api_base_url}/recipients/{recipient_id}/email")
            if response.status_code == 200:
                recipient_data = response.json()
                recipient_email = recipient_data["email"]
                recipient_name = recipient_data["name"]
            else:
                logger.error("Failed to fetch recipient: HTTP %d", response.status_code)
    except Exception as e:
        logger.error("Failed to fetch recipient details: %s", e)

    if not recipient_email:
        await query.edit_message_text("❌ Recipient not found. Please try again.")
        context.user_data.pop("pending_document", None)
        context.user_data.pop("client_details", None)
        return ConversationHandler.END

    user = update.effective_user
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
        "Processing transaction %s for user %s (@%s) with file %s to recipient %s",
        tx.id,
        tx.telegram_name,
        tx.telegram_handle,
        tx.filename,
        recipient_name,
    )

    try:
        await email_provider.send_transaction_email(
            tx=tx,
            attachment_bytes=bytes(file_bytes),
            attachment_filename=pending_doc["file_name"],
            recipient_email=recipient_email,
        )

        # Mark as delivered and persist to DB.
        tx.delivery_status = "DELIVERED"
        save_transaction(tx)

        await query.edit_message_text(
            f"✅ Document sent to **{recipient_name}**!\n\n"
            "Your document and client details have been recorded.\n"
            "Keep up the good work👑🤖🦀!"
        )
    except Exception as e:
        logger.error("Failed to send email: %s", e)
        tx.delivery_status = "FAILED"
        save_transaction(tx)
        await query.edit_message_text(
            "❌ Failed to send email. Please try again or contact support."
        )

    # Clear the context for next transaction
    context.user_data.pop("pending_document", None)
    context.user_data.pop("client_details", None)

    return ConversationHandler.END


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Allow user to cancel the flow.
    """
    user = update.effective_user
    logger.info("User %s canceled the conversation.", user.full_name)
    await update.message.reply_text("❌ Operation cancelled. Send a new document to start again.")
    context.user_data.pop("pending_document", None)
    context.user_data.pop("client_details", None)
    return ConversationHandler.END


async def show_transactions(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    /transactions command: show recent transactions to anyone.
    """
    application = context.application
    bot_config: BotConfig = application.bot_data["config"]  # type: ignore[assignment]

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{bot_config.api_base_url}/transactions/public?limit=10")
            if response.status_code == 200:
                transactions: List[Dict] = response.json()
            else:
                transactions = []
    except Exception as e:
        logger.error("Failed to fetch transactions: %s", e)
        transactions = []

    if not transactions:
        await update.message.reply_text("📋 No transactions yet. Send a document to get started!")
        return

    from datetime import datetime
    from zoneinfo import ZoneInfo

    ny_tz = ZoneInfo("America/New_York")
    message_lines = ["📋 **Recent Transactions:**\n"]

    for tx in transactions[:10]:
        try:
            ts = datetime.fromisoformat(tx["timestamp_ny"].replace("Z", "+00:00"))
            ts_ny = ts.astimezone(ny_tz)
            time_str = ts_ny.strftime("%b %d, %Y %I:%M %p ET")
        except:
            time_str = tx.get("timestamp_ny", "Unknown time")

        status_emoji = "✅" if tx.get("delivery_status") == "DELIVERED" else "⏳"
        message_lines.append(
            f"{status_emoji} **{tx['filename']}**\n"
            f"   👤 {tx['telegram_name']} (@{tx.get('telegram_handle', 'unknown')})\n"
            f"   🕐 {time_str}\n"
        )

    await update.message.reply_text("\n".join(message_lines), parse_mode="Markdown")


async def handle_transactions_button(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Handle inline button callback for viewing transactions.
    """
    query = update.callback_query
    await query.answer()

    application = context.application
    bot_config: BotConfig = application.bot_data["config"]  # type: ignore[assignment]

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{bot_config.api_base_url}/transactions/public?limit=10")
            if response.status_code == 200:
                transactions: List[Dict] = response.json()
            else:
                transactions = []
    except Exception as e:
        logger.error("Failed to fetch transactions: %s", e)
        transactions = []

    if not transactions:
        await query.edit_message_text("📋 No transactions yet. Send a document to get started!")
        return

    from datetime import datetime
    from zoneinfo import ZoneInfo

    ny_tz = ZoneInfo("America/New_York")
    message_lines = ["📋 **Recent Transactions:**\n"]

    for tx in transactions[:10]:
        try:
            ts = datetime.fromisoformat(tx["timestamp_ny"].replace("Z", "+00:00"))
            ts_ny = ts.astimezone(ny_tz)
            time_str = ts_ny.strftime("%b %d, %Y %I:%M %p ET")
        except:
            time_str = tx.get("timestamp_ny", "Unknown time")

        status_emoji = "✅" if tx.get("delivery_status") == "DELIVERED" else "⏳"
        message_lines.append(
            f"{status_emoji} **{tx['filename']}**\n"
            f"   👤 {tx['telegram_name']} (@{tx.get('telegram_handle', 'unknown')})\n"
            f"   🕐 {time_str}\n"
        )

    await query.edit_message_text("\n".join(message_lines), parse_mode="Markdown")


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

    # Conversation for document → client details → recipient selection
    conv_handler = ConversationHandler(
        entry_points=[MessageHandler(filters.Document.ALL, handle_document)],
        states={
            State.WAITING_FOR_CLIENT_DETAILS: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, handle_client_details),
            ],
            State.WAITING_FOR_RECIPIENT: [
                CallbackQueryHandler(handle_recipient_selection, pattern="^recipient_"),
            ],
        },
        fallbacks=[CommandHandler("cancel", cancel)],
        allow_reentry=True,
    )

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("transactions", show_transactions))
    app.add_handler(CallbackQueryHandler(handle_transactions_button, pattern="^view_transactions$"))
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


