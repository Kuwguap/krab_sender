from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Iterable, List, Optional

from zoneinfo import ZoneInfo

from .db import SessionLocal, TransactionORM, RecipientORM
from bot.models import Transaction


NY_TZ = ZoneInfo("America/New_York")


@contextmanager
def get_session():
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def save_transaction(tx: Transaction) -> None:
    """
    Persist a Transaction from the bot into the database.
    """
    orm = TransactionORM(
        id=tx.id,
        telegram_name=tx.telegram_name,
        telegram_handle=tx.telegram_handle,
        filename=tx.filename,
        client_details=tx.client_details,
        timestamp_utc=tx.timestamp,
        delivery_status=tx.delivery_status,
    )
    with get_session() as session:
        session.add(orm)
        session.flush()  # Ensure the ORM is added before commit


def list_transactions(limit: int = 100, offset: int = 0) -> List[Transaction]:
    """
    Fetch a window of transactions ordered by most recent first.
    """
    with get_session() as session:
        rows: Iterable[TransactionORM] = (
            session.query(TransactionORM)
            .order_by(TransactionORM.timestamp_utc.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

        # Build Transaction objects while the session is still open to avoid
        # DetachedInstanceError when accessing attributes later.
        result = [
            Transaction(
                id=row.id,
                telegram_name=row.telegram_name,
                telegram_handle=row.telegram_handle,
                filename=row.filename,
                client_details=row.client_details,
                timestamp=row.timestamp_utc,
                delivery_status=row.delivery_status,
            )
            for row in rows
        ]

    return result


def get_latest_transaction() -> Optional[Transaction]:
    with get_session() as session:
        row: Optional[TransactionORM] = (
            session.query(TransactionORM)
            .order_by(TransactionORM.timestamp_utc.desc())
            .first()
        )
        if not row:
            return None

        tx = Transaction(
            id=row.id,
            telegram_name=row.telegram_name,
            telegram_handle=row.telegram_handle,
            filename=row.filename,
            client_details=row.client_details,
            timestamp=row.timestamp_utc,
            delivery_status=row.delivery_status,
        )

    return tx


def get_rolling_summary_ny(
    days: int = 7, reference_utc: Optional[datetime] = None
) -> dict:
    """
    Build a summary for the last `days` days in America/New_York time.

    - Window is [now_NY - days, now_NY].
    - Can be generated on demand at any time.
    - The Saturday 12 AM NJ cron will also call this, effectively
      generating the last 7 days as of that moment.
    """
    if reference_utc is None:
        reference_utc = datetime.now(timezone.utc)

    # Convert reference time into NJ (ET) timezone
    ref_ny = reference_utc.astimezone(NY_TZ)

    # Rolling window bounds in NY
    start_ny = (ref_ny - timedelta(days=days)).replace(microsecond=0)
    end_ny = ref_ny.replace(microsecond=0)

    # Convert back to UTC for querying
    start_utc = start_ny.astimezone(timezone.utc)
    end_utc = end_ny.astimezone(timezone.utc)

    with get_session() as session:
        rows: List[TransactionORM] = (
            session.query(TransactionORM)
            .filter(TransactionORM.timestamp_utc >= start_utc)
            .filter(TransactionORM.timestamp_utc <= end_utc)
            .order_by(TransactionORM.timestamp_utc.asc())
            .all()
        )

        # Compute aggregates and transform rows while session is open
        items = []
        delivered = pending = failed = 0
        for r in rows:
            status = (r.delivery_status or "").upper()
            if status == "DELIVERED":
                delivered += 1
            elif status == "PENDING":
                pending += 1
            else:
                failed += 1

            items.append(
                {
                    "id": r.id,
                    "telegram_name": r.telegram_name,
                    "telegram_handle": r.telegram_handle,
                    "filename": r.filename,
                    "timestamp_ny": r.timestamp_utc.astimezone(NY_TZ).isoformat(),
                    "delivery_status": r.delivery_status,
                }
            )

        total = len(rows)

    summary = {
        "period_start_ny": start_ny.isoformat(),
        "period_end_ny": end_ny.isoformat(),
        "total_transactions": total,
        "delivered": delivered,
        "pending": pending,
        "failed": failed,
        "items": items,
    }

    return summary


# Recipient management functions
def list_recipients() -> List[dict]:
    """
    Fetch all recipients ordered by name.
    """
    with get_session() as session:
        rows = session.query(RecipientORM).order_by(RecipientORM.name.asc()).all()
        return [
            {
                "id": row.id,
                "name": row.name,
                "email": row.email,
                "created_at_utc": row.created_at_utc.isoformat(),
            }
            for row in rows
        ]
def get_recipient_by_id(recipient_id: str) -> Optional[dict]:
    """
    Fetch a recipient by ID.
    """
    with get_session() as session:
        row = session.query(RecipientORM).filter(RecipientORM.id == recipient_id).first()
        if not row:
            return None
        return {
            "id": row.id,
            "name": row.name,
            "email": row.email,
            "created_at_utc": row.created_at_utc.isoformat(),
        }
def create_recipient(name: str, email: str) -> dict:
    """
    Create a new recipient.
    """
    import uuid
    recipient_id = str(uuid.uuid4())
    with get_session() as session:
        orm = RecipientORM(
            id=recipient_id,
            name=name,
            email=email,
            created_at_utc=datetime.now(timezone.utc),
        )
        session.add(orm)
        return {
            "id": orm.id,
            "name": orm.name,
            "email": orm.email,
            "created_at_utc": orm.created_at_utc.isoformat(),
        }
def delete_recipient(recipient_id: str) -> bool:
    """
    Delete a recipient by ID. Returns True if deleted, False if not found.
    """
    with get_session() as session:
        row = session.query(RecipientORM).filter(RecipientORM.id == recipient_id).first()
        if not row:
            return False
        session.delete(row)
        return True