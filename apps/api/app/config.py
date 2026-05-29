from pathlib import Path
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_DIR = Path(__file__).resolve().parents[3]


def normalize_sqlite_url(database_url: str) -> str:
    prefix = "sqlite:///"
    if not database_url.startswith(prefix):
        return database_url

    raw_path = database_url.removeprefix(prefix)
    if raw_path in {"", ":memory:"} or raw_path.startswith("/"):
        return database_url

    absolute_path = (ROOT_DIR / raw_path).resolve()
    absolute_path.parent.mkdir(parents=True, exist_ok=True)
    return f"{prefix}{absolute_path}"


def normalize_database_url(database_url: str) -> str:
    database_url = normalize_sqlite_url(database_url)
    if not database_url.startswith(("postgresql://", "postgresql+")):
        return database_url

    parsed = urlsplit(database_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.setdefault("connect_timeout", "10")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))


class Settings(BaseSettings):
    app_name: str = "Resume Analysis Platform"
    api_base_url: str = "http://localhost:8000"
    web_origin: str = "http://localhost:3000"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    database_url: str = f"sqlite:///{ROOT_DIR / 'apps' / 'api' / 'resume_analysis.db'}"
    upload_dir: Path = ROOT_DIR / "apps" / "api" / "uploads"
    storage_backend: Literal["local", "supabase"] = "local"
    supabase_url: str | None = None
    supabase_service_role_key: str | None = None
    supabase_storage_bucket: str = "resumes"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    openai_base_url: str | None = None
    openai_proxy: str | None = None
    openai_trust_env: bool = False

    model_config = SettingsConfigDict(env_file=ROOT_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    @model_validator(mode="after")
    def normalize_local_paths(self) -> "Settings":
        self.database_url = normalize_database_url(self.database_url)
        if self.supabase_url:
            self.supabase_url = self.supabase_url.rstrip("/")
        if self.storage_backend == "supabase":
            missing = []
            if not self.supabase_url:
                missing.append("SUPABASE_URL")
            if not self.supabase_service_role_key:
                missing.append("SUPABASE_SERVICE_ROLE_KEY")
            if not self.supabase_storage_bucket:
                missing.append("SUPABASE_STORAGE_BUCKET")
            if missing:
                raise ValueError(f"{', '.join(missing)} must be set when STORAGE_BACKEND=supabase")
        return self

    @property
    def allowed_origins(self) -> list[str]:
        origins = [self.web_origin]
        origins.extend(origin.strip() for origin in self.cors_origins.split(",") if origin.strip())
        return sorted(set(origins))


settings = Settings()
if settings.storage_backend == "local":
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
