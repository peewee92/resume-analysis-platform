from io import BytesIO
from types import SimpleNamespace

import httpx
import pytest

from app.storage import ResumeNotFoundError, SupabaseResumeStorage


def test_supabase_storage_upload_download_exists_and_delete(monkeypatch):
    calls = []

    def fake_request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        if method == "HEAD":
            return httpx.Response(200)
        if method == "GET":
            return httpx.Response(200, content=b"%PDF-1.4")
        return httpx.Response(200, json={"Key": "resumes/resume.pdf"})

    monkeypatch.setattr("app.storage.httpx.request", fake_request)
    storage = SupabaseResumeStorage(
        supabase_url="https://project.supabase.co",
        service_role_key="service-role",
        bucket="resumes",
    )

    uploaded_key = storage.save_upload(SimpleNamespace(file=BytesIO(b"%PDF-1.4")), "resumes/resume.pdf")
    assert uploaded_key == "resumes/resume.pdf"
    assert storage.exists("resumes/resume.pdf") is True
    assert storage.get_bytes("resumes/resume.pdf") == b"%PDF-1.4"
    with storage.temp_pdf_path("resumes/resume.pdf") as temp_path:
        assert temp_path.exists()
        assert temp_path.read_bytes() == b"%PDF-1.4"
    assert not temp_path.exists()
    storage.delete("resumes/resume.pdf")

    assert calls[0][0] == "POST"
    assert calls[0][1] == "https://project.supabase.co/storage/v1/object/resumes/resumes/resume.pdf"
    assert calls[0][2]["headers"]["Authorization"] == "Bearer service-role"
    assert calls[-1][0] == "DELETE"
    assert calls[-1][2]["json"] == {"prefixes": ["resumes/resume.pdf"]}


def test_supabase_storage_missing_object(monkeypatch):
    def fake_request(method, url, **kwargs):
        return httpx.Response(404, text="not found")

    monkeypatch.setattr("app.storage.httpx.request", fake_request)
    storage = SupabaseResumeStorage(
        supabase_url="https://project.supabase.co",
        service_role_key="service-role",
        bucket="resumes",
    )

    assert storage.exists("resumes/missing.pdf") is False
    with pytest.raises(ResumeNotFoundError):
        storage.get_bytes("resumes/missing.pdf")
