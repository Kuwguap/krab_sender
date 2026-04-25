from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from .config import ApiConfig
from .db import init_db
from .repository import (
    get_latest_transaction,
    list_transactions,
    get_rolling_summary_ny,
    list_recipients,
    get_recipient_by_id,
    create_recipient,
    delete_recipient,
)


NY_TZ = ZoneInfo("America/New_York")

app = FastAPI(title="Krab Sender Admin API")

# CORS so the Vercel admin frontend can call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://krab-sender.vercel.app",  # your Vercel admin URL
        "https://krabsender.vercel.app",   # if using this alias
        "http://127.0.0.1:8000",           # local dev
        "http://localhost:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_api_config() -> ApiConfig:
    # Cached via FastAPI dependency system; cheap to construct.
    return ApiConfig.from_env()


def require_admin(
    x_admin_password: str = Header(..., alias="X-Admin-Password"),
    config: ApiConfig = Depends(get_api_config),
) -> None:
    """
    Simple header-based auth for admin endpoints.

    The frontend will send X-Admin-Password, which must match ADMIN_PASSWORD
    from the environment.
    """
    if x_admin_password != config.admin_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin credentials",
        )


@app.on_event("startup")
def on_startup():
    # Ensure database is ready before serving any requests.
    init_db()


@app.get("/health")
def health():
    """
    Basic health-check endpoint for the Admin Dashboard.
    """
    return {"status": "ok", "service": "krab-sender-api"}


# Public endpoint: anyone can view recent transactions
@app.get("/transactions/public")
def transactions_public(limit: int = 10, offset: int = 0):
    """
    Public endpoint to view recent transactions (no auth required).
    Used by the Telegram bot's /transactions command.

    Supports simple pagination via limit & offset.
    """
    items = list_transactions(limit=limit, offset=offset)
    result = []
    for tx in items:
        ts_ny = tx.timestamp.astimezone(NY_TZ)
        result.append(
            {
                "id": tx.id,
                "telegram_name": tx.telegram_name,
                "telegram_handle": tx.telegram_handle,
                "filename": tx.filename,
                "recipient_name": tx.recipient_name,
                "recipient_email": tx.recipient_email,
                "issuer_group": tx.issuer_group,
                "timestamp_ny": ts_ny.isoformat(),
                "delivery_status": tx.delivery_status,
            }
        )
    return result


# Public endpoint: bot needs to fetch recipients
@app.get("/recipients")
def recipients_public():
    """
    Public endpoint to fetch all recipients (for bot inline keyboard).
    Returns only name and id (no email exposed).
    """
    recipients = list_recipients()
    return [
        {
            "id": r["id"],
            "name": r["name"],
        }
        for r in recipients
    ]


@app.get("/recipients/{recipient_id}/email")
def recipient_email_public(recipient_id: str):
    """
    Public endpoint to get recipient email by ID (for bot to send emails).
    Returns only the email address for the given recipient ID.
    """
    recipient = get_recipient_by_id(recipient_id)
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")
    return {
        "id": recipient["id"],
        "name": recipient["name"],
        "email": recipient["email"],
    }


@app.get("/transactions/latest", dependencies=[Depends(require_admin)])
def transactions_latest():
    """
    Returns the latest processed transaction, if any.
    """
    tx = get_latest_transaction()
    if not tx:
        return None

    ts_ny = tx.timestamp.astimezone(NY_TZ)
    return {
        "id": tx.id,
        "telegram_name": tx.telegram_name,
        "telegram_handle": tx.telegram_handle,
        "filename": tx.filename,
        "client_details": tx.client_details,
        "recipient_name": tx.recipient_name,
        "recipient_email": tx.recipient_email,
        "issuer_group": tx.issuer_group,
        "timestamp_ny": ts_ny.isoformat(),
        "delivery_status": tx.delivery_status,
    }


@app.get("/transactions", dependencies=[Depends(require_admin)])
def transactions(limit: int = 100, offset: int = 0):
    """
    Paginated list of transactions for the dashboard data table.
    """
    items = list_transactions(limit=limit, offset=offset)
    result = []
    for tx in items:
        ts_ny = tx.timestamp.astimezone(NY_TZ)
        result.append(
            {
                "id": tx.id,
                "telegram_name": tx.telegram_name,
                "telegram_handle": tx.telegram_handle,
                "filename": tx.filename,
                "client_details": tx.client_details,
                "recipient_name": tx.recipient_name,
                "recipient_email": tx.recipient_email,
                "issuer_group": tx.issuer_group,
                "timestamp_ny": ts_ny.isoformat(),
                "delivery_status": tx.delivery_status,
            }
        )

    return result


@app.get("/summaries/weekly/previous", dependencies=[Depends(require_admin)])
def weekly_previous_summary():
    """
    Returns a rolling 7‑day summary in America/New_York time.
    This is what the Saturday 12 AM NJ-time cron job will generate,
    and can also be triggered manually at any time.
    """
    return get_rolling_summary_ny(days=7)


@app.get("/summaries/rolling", dependencies=[Depends(require_admin)])
def rolling_summary(window: str = "1m"):
    """
    Returns rolling summaries for multiple windows:
    1m, 3m, 6m, 1y, all
    """
    mapping = {
        "1m": 30,
        "3m": 90,
        "6m": 180,
        "1y": 365,
        "all": None,
    }
    key = (window or "1m").lower()
    if key not in mapping:
        raise HTTPException(status_code=400, detail="Invalid window. Use: 1m, 3m, 6m, 1y, all")
    return get_rolling_summary_ny(days=mapping[key])


# Explicit OPTIONS handlers so browser CORS preflight succeeds from Vercel
@app.options("/transactions")
def options_transactions():
    # CORSMiddleware will add the appropriate CORS headers.
    return {}


@app.options("/transactions/latest")
def options_transactions_latest():
    return {}

@app.options("/summaries/weekly/previous")
def options_weekly_previous_summary():
    return {}


@app.options("/summaries/rolling")
def options_rolling_summary():
    return {}


# Recipient management endpoints (admin only)
class RecipientCreate(BaseModel):
    name: str
    email: str


@app.get("/recipients/all", dependencies=[Depends(require_admin)])
def recipients_all():
    """
    Admin endpoint: list all recipients with full details.
    """
    return list_recipients()


@app.post("/recipients", dependencies=[Depends(require_admin)])
def recipients_create(recipient: RecipientCreate):
    """
    Admin endpoint: create a new recipient.
    """
    return create_recipient(name=recipient.name, email=recipient.email)


@app.delete("/recipients/{recipient_id}", dependencies=[Depends(require_admin)])
def recipients_delete(recipient_id: str):
    """
    Admin endpoint: delete a recipient by ID.
    """
    deleted = delete_recipient(recipient_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Recipient not found")
    return {"success": True}


@app.options("/recipients")
def options_recipients():
    return {}


@app.options("/recipients/all")
def options_recipients_all():
    return {}


@app.options("/transactions/public")
def options_transactions_public():
    return {}


# Serve a simple static admin dashboard at /admin
app.mount("/admin", StaticFiles(directory="admin", html=True), name="admin")

