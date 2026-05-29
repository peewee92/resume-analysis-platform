from contextlib import contextmanager
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import BinaryIO, Iterator
from urllib.parse import quote

import httpx

from .config import settings


class ResumeStorageError(RuntimeError):
    pass


class ResumeNotFoundError(ResumeStorageError):
    pass


class LocalResumeStorage:
    def __init__(self, upload_dir: Path):
        self.upload_dir = upload_dir
        self.upload_dir.mkdir(parents=True, exist_ok=True)

    def save_upload(self, upload_file, stored_name: str) -> str:
        target = self.upload_dir / Path(stored_name).name
        with target.open("wb") as handle:
            _copy_file(upload_file.file, handle)
        return str(target)

    def exists(self, key: str) -> bool:
        path = Path(key)
        return path.exists() and path.is_file() and path.suffix.lower() == ".pdf"

    def get_bytes(self, key: str) -> bytes:
        if not self.exists(key):
            raise ResumeNotFoundError(f"Resume PDF not found: {key}")
        return Path(key).read_bytes()

    def delete(self, key: str) -> None:
        path = Path(key)
        if self.is_upload_file(path):
            path.unlink(missing_ok=True)

    @contextmanager
    def temp_pdf_path(self, key: str) -> Iterator[Path]:
        if not self.exists(key):
            raise ResumeNotFoundError(f"Resume PDF not found: {key}")
        yield Path(key)

    def is_upload_file(self, path: Path) -> bool:
        try:
            path.resolve().relative_to(self.upload_dir.resolve())
            return True
        except ValueError:
            return False


class SupabaseResumeStorage:
    def __init__(self, supabase_url: str, service_role_key: str, bucket: str):
        self.supabase_url = supabase_url.rstrip("/")
        self.service_role_key = service_role_key
        self.bucket = bucket

    def save_upload(self, upload_file, stored_name: str) -> str:
        upload_file.file.seek(0)
        response = httpx.request(
            "POST",
            self._object_url(stored_name),
            content=upload_file.file.read(),
            headers={
                **self._headers(),
                "Content-Type": "application/pdf",
                "x-upsert": "false",
            },
            timeout=60,
        )
        self._raise_for_storage_error(response, stored_name)
        return stored_name

    def exists(self, key: str) -> bool:
        response = httpx.request("HEAD", self._object_url(key), headers=self._headers(), timeout=30)
        if response.status_code == 404:
            return False
        self._raise_for_storage_error(response, key)
        return True

    def get_bytes(self, key: str) -> bytes:
        response = httpx.request("GET", self._object_url(key), headers=self._headers(), timeout=60)
        if response.status_code == 404:
            raise ResumeNotFoundError(f"Resume PDF not found: {key}")
        self._raise_for_storage_error(response, key)
        return response.content

    def delete(self, key: str) -> None:
        response = httpx.request(
            "DELETE",
            f"{self.supabase_url}/storage/v1/object/{self.bucket}",
            json={"prefixes": [key]},
            headers={**self._headers(), "Content-Type": "application/json"},
            timeout=30,
        )
        if response.status_code == 404:
            return
        self._raise_for_storage_error(response, key)

    @contextmanager
    def temp_pdf_path(self, key: str) -> Iterator[Path]:
        data = self.get_bytes(key)
        temp = NamedTemporaryFile(delete=False, suffix=".pdf")
        try:
            with temp:
                temp.write(data)
            yield Path(temp.name)
        finally:
            Path(temp.name).unlink(missing_ok=True)

    def _object_url(self, key: str) -> str:
        encoded_key = quote(key, safe="/")
        return f"{self.supabase_url}/storage/v1/object/{self.bucket}/{encoded_key}"

    def _headers(self) -> dict[str, str]:
        return {
            "apikey": self.service_role_key,
            "Authorization": f"Bearer {self.service_role_key}",
        }

    def _raise_for_storage_error(self, response: httpx.Response, key: str) -> None:
        if response.is_success:
            return
        raise ResumeStorageError(f"Supabase Storage request failed for {key}: {response.status_code} {response.text}")


def _copy_file(source: BinaryIO, target: BinaryIO) -> None:
    while chunk := source.read(1024 * 1024):
        target.write(chunk)


def get_resume_storage():
    if settings.storage_backend == "supabase":
        return SupabaseResumeStorage(
            supabase_url=settings.supabase_url or "",
            service_role_key=settings.supabase_service_role_key or "",
            bucket=settings.supabase_storage_bucket,
        )
    return LocalResumeStorage(settings.upload_dir)
