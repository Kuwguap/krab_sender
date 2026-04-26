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
    cors_origins: tuple[str, ...]
    cors_origin_regex: str | None

    @classmethod
    def from_env(cls) -> "ApiConfig":
        # Baseline admin origins: always included so a partial CORS_ORIGINS in Render
        # cannot accidentally lock out the production Vercel dashboard.
        baseline = [
            "https://krab-sender.vercel.app",
            "https://krabsender.vercel.app",
            "http://127.0.0.1:8000",
            "http://localhost:8000",
        ]
        raw_origins = (os.getenv("CORS_ORIGINS") or "").strip()
        env_list = (
            [o.strip() for o in raw_origins.split(",") if o.strip()] if raw_origins else []
        )
        seen: set[str] = set()
        merged: list[str] = []
        for o in env_list + baseline:
            if o not in seen:
                seen.add(o)
                merged.append(o)
        origins = tuple(merged)
        raw_regex = (os.getenv("CORS_ORIGIN_REGEX") or "").strip() or None
        return cls(
            admin_password=os.getenv("ADMIN_PASSWORD", "AdminPassword123!"),
            cors_origins=origins,
            cors_origin_regex=raw_regex
            or r"^https://.*\.vercel\.app$",  # preview deployments, alternate project URLs
        )










