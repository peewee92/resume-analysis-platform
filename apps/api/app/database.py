import os
import stat
from pathlib import Path

from sqlalchemy.engine import make_url
from sqlmodel import Session, SQLModel, create_engine

from .config import settings


connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True)


def _sqlite_database_path() -> Path | None:
    url = make_url(settings.database_url)
    if not url.drivername.startswith("sqlite"):
        return None
    if not url.database or url.database == ":memory:":
        return None
    return Path(url.database)


def _make_user_writable(path: Path) -> None:
    if not path.exists():
        return
    if os.access(path, os.W_OK):
        return
    try:
        path.chmod(path.stat().st_mode | stat.S_IWUSR)
    except OSError as exc:
        raise RuntimeError(f"SQLite path is not writable: {path}") from exc


def ensure_sqlite_writable() -> None:
    database_path = _sqlite_database_path()
    if database_path is None:
        return

    database_path.parent.mkdir(parents=True, exist_ok=True)
    _make_user_writable(database_path.parent)
    _make_user_writable(database_path)
    _make_user_writable(database_path.with_name(f"{database_path.name}-wal"))
    _make_user_writable(database_path.with_name(f"{database_path.name}-shm"))

    if not os.access(database_path.parent, os.W_OK):
        raise RuntimeError(f"SQLite database directory is not writable: {database_path.parent}")
    if database_path.exists() and not os.access(database_path, os.W_OK):
        raise RuntimeError(f"SQLite database file is not writable: {database_path}")


def init_db() -> None:
    ensure_sqlite_writable()
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
