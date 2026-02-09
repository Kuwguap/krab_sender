from datetime import datetime, timezone
from pathlib import Path
import os

from sqlalchemy import (
    Column,
    DateTime,
    Integer,
    String,
    create_engine,
    text,
)
from sqlalchemy.orm import declarative_base, sessionmaker


DB_PATH = Path(__file__).resolve().parent.parent / "krab_sender.db"

# Prefer DATABASE_URL (e.g. Supabase Postgres) if provided; otherwise fall back to local SQLite.
DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL:
    # If using plain "postgresql://" DSN (e.g. from Supabase), tell SQLAlchemy
    # to use the modern psycopg3 driver by default.
    if DATABASE_URL.startswith("postgresql://") and "+psycopg" not in DATABASE_URL:
        DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)

    engine = create_engine(DATABASE_URL)
else:
    engine = create_engine(
        f"sqlite:///{DB_PATH}",
        connect_args={"check_same_thread": False},
    )

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

Base = declarative_base()


class TransactionORM(Base):
    """
    Database representation of a Transmission event.

    Mirrors the logical Transaction model and the roadmap schema.
    """

    __tablename__ = "transactions"

    # Internal numeric primary key for convenience.
    pk = Column(Integer, primary_key=True, autoincrement=True)

    # Business identifier (UUID) from bot.models.Transaction.id
    id = Column(String, unique=True, nullable=False, index=True)

    telegram_name = Column(String, nullable=False)
    telegram_handle = Column(String, nullable=True)
    filename = Column(String, nullable=False)
    client_details = Column(String, nullable=False)

    # Stored in UTC, always timezone-aware on the Python side.
    timestamp_utc = Column(DateTime(timezone=True), nullable=False, index=True)

    delivery_status = Column(String, nullable=False, default="PENDING", index=True)


def init_db() -> None:
    """
    Initialize database and create tables if they don't exist.
    """
    Base.metadata.create_all(bind=engine)


