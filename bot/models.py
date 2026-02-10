from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional


@dataclass
class Transaction:
    """
    Represents a single document transmission event.

    Mirrors the roadmap schema:
    - ID
    - Telegram Name
    - Handle
    - Filename
    - Client Details
    - Timestamp
    - Delivery Status
    """

    id: str
    telegram_name: str
    telegram_handle: Optional[str]
    filename: str
    client_details: str
    timestamp: datetime
    delivery_status: str

    @classmethod
    def new(
        cls,
        id: str,
        telegram_name: str,
        telegram_handle: Optional[str],
        filename: str,
        client_details: str,
        delivery_status: str = "PENDING",
    ) -> "Transaction":
        return cls(
            id=id,
            telegram_name=telegram_name,
            telegram_handle=telegram_handle,
            filename=filename,
            client_details=client_details,
            timestamp=datetime.now(timezone.utc),
            delivery_status=delivery_status,
        )





