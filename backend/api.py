from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.staticfiles import StaticFiles
from zoneinfo import ZoneInfo

from .config import ApiConfig
from .db import init_db
from .repository import get_latest_transaction, list_transactions, get_rolling_summary_ny


NY_TZ = ZoneInfo("America/New_York")

app = FastAPI(title="Krab Sender Admin API")


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


# Serve a simple static admin dashboard at /admin
app.mount("/admin", StaticFiles(directory="admin", html=True), name="admin")

