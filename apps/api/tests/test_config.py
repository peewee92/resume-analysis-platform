import pytest

from app.config import ROOT_DIR, Settings, normalize_database_url, normalize_sqlite_url


def test_normalize_relative_sqlite_url_from_env():
    url = normalize_sqlite_url("sqlite:///apps/api/resume_analysis.db")
    assert url == f"sqlite:///{ROOT_DIR / 'apps' / 'api' / 'resume_analysis.db'}"


def test_preserves_absolute_sqlite_url():
    assert normalize_sqlite_url("sqlite:////tmp/resume.db") == "sqlite:////tmp/resume.db"


def test_postgres_url_gets_connect_timeout():
    url = normalize_database_url("postgresql+psycopg://user:pass@host:5432/postgres?sslmode=require")

    assert url == "postgresql+psycopg://user:pass@host:5432/postgres?sslmode=require&connect_timeout=10"


def test_postgres_url_preserves_existing_connect_timeout():
    url = normalize_database_url("postgresql+psycopg://user:pass@host:5432/postgres?connect_timeout=3")

    assert url == "postgresql+psycopg://user:pass@host:5432/postgres?connect_timeout=3"


def test_allowed_origins_deduplicates_web_origin():
    settings = Settings(
        web_origin="http://localhost:3000",
        cors_origins="http://localhost:3000,http://127.0.0.1:3000,http://192.168.0.101:3000",
        openai_api_key=None,
    )

    assert settings.allowed_origins == [
        "http://127.0.0.1:3000",
        "http://192.168.0.101:3000",
        "http://localhost:3000",
    ]


def test_local_storage_does_not_require_supabase_credentials():
    settings = Settings(storage_backend="local", openai_api_key=None)

    assert settings.storage_backend == "local"
    assert settings.supabase_url is None
    assert settings.supabase_service_role_key is None


def test_supabase_storage_requires_credentials():
    with pytest.raises(ValueError, match="SUPABASE_URL"):
        Settings(storage_backend="supabase", openai_api_key=None)
