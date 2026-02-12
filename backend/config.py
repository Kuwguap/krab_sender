from dataclasses import dataclass
import os

from dotenv import load_dotenv


load_dotenv()


@dataclass(frozen=True)
class ApiConfig:
    """
    Configuration for the Admin API.

    Currently focuses on:
    - Admin password for protecting dashboard endpoints.
    """

    admin_password: str

    @classmethod
    def from_env(cls) -> "ApiConfig":
        return cls(
            admin_password=os.getenv("ADMIN_PASSWORD", "AdminPassword123!"),
        )






