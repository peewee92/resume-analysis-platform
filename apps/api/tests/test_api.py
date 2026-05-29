from fastapi.testclient import TestClient
from io import BytesIO
from pathlib import Path
from reportlab.pdfgen import canvas
from sqlmodel import Session, select
from tempfile import NamedTemporaryFile
from uuid import uuid4

from app.config import settings
from app.database import engine, init_db
from app.main import app
from app.models import Candidate, Job, Score


client = TestClient(app)


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_rejects_non_pdf_upload():
    response = client.post("/api/resumes/upload", files=[("files", ("note.txt", b"hello", "text/plain"))])
    assert response.status_code == 400


def make_pdf() -> bytes:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer)
    pdf.drawString(72, 720, "Alice Chen")
    pdf.drawString(72, 700, "Email: alice@example.com")
    pdf.drawString(72, 680, "Skills: React TypeScript Python FastAPI")
    pdf.showPage()
    pdf.drawString(72, 720, "Project: Resume Intelligence Platform")
    pdf.save()
    return buffer.getvalue()


def test_upload_pdf_and_score_candidate():
    upload = client.post(
        "/api/resumes/upload",
        files=[("files", ("resume.pdf", make_pdf(), "application/pdf"))],
    )
    assert upload.status_code == 200
    candidate_id = upload.json()[0]["id"]

    patch = client.patch(
        f"/api/candidates/{candidate_id}",
        json={
            "name": "Alice Chen",
            "skills": ["React", "TypeScript", "Python", "FastAPI"],
            "education": [{"school": "Stanford", "major": "CS", "degree": "MS", "graduation_time": "2021"}],
            "work_experience": [{"company": "Acme", "title": "Engineer", "period": "2021-2024", "summary": "Built dashboards"}],
        },
    )
    assert patch.status_code == 200

    score = client.post(
        "/api/scores",
        json={
            "candidate_id": candidate_id,
            "job": {
                "title": "Full-stack Engineer",
                "description": "React TypeScript Python FastAPI",
                "required_skills": ["React", "TypeScript", "Python"],
                "bonus_skills": ["FastAPI"],
            },
        },
    )
    assert score.status_code == 200
    payload = score.json()
    assert 0 <= payload["overall"] <= 100
    assert {"skill_match", "experience_relevance", "education_fit", "summary"}.issubset(payload)


def test_candidates_list_includes_filtered_total_count_header():
    init_db()
    marker = f"Total Header Candidate {uuid4().hex}"
    with Session(engine) as session:
        session.add(
            Candidate(
                name=f"{marker} One",
                resume_filename="total-one.pdf",
                resume_path="/tmp/total-one.pdf",
            )
        )
        session.add(
            Candidate(
                name=f"{marker} Two",
                resume_filename="total-two.pdf",
                resume_path="/tmp/total-two.pdf",
            )
        )
        session.commit()

    response = client.get(f"/api/candidates?q={marker}&page_size=1")
    assert response.status_code == 200
    assert response.headers["x-total-count"] == "2"
    assert len(response.json()) == 1


def test_lan_origin_cors_preflight():
    response = client.options(
        "/api/candidates?sort=created_desc&page_size=24",
        headers={
            "Origin": "http://192.168.0.101:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://192.168.0.101:3000"

    get_response = client.get("/api/candidates", headers={"Origin": "http://192.168.0.101:3000"})
    assert get_response.status_code == 200
    assert get_response.headers["access-control-expose-headers"] == "X-Total-Count"


def test_missing_resume_preview_returns_404():
    init_db()
    with Session(engine) as session:
        candidate = Candidate(
            name="Missing File Candidate",
            resume_filename="missing.pdf",
            resume_path="/tmp/resume-analysis-platform-missing.pdf",
        )
        session.add(candidate)
        session.commit()
        session.refresh(candidate)
        candidate_id = candidate.id

    response = client.get(f"/api/resumes/{candidate_id}")
    assert response.status_code == 404
    assert "cannot be found" in response.json()["detail"].lower()


def test_resume_preview_recovers_file_from_upload_dir_by_stored_name():
    init_db()
    stored_pdf = settings.upload_dir / "legacy123_resume.pdf"
    stored_pdf.write_bytes(make_pdf())
    try:
        with Session(engine) as session:
            candidate = Candidate(
                name="Legacy Path Candidate",
                resume_filename="resume.pdf",
                resume_path="/old/project/apps/api/uploads/legacy123_resume.pdf",
            )
            session.add(candidate)
            session.commit()
            session.refresh(candidate)
            candidate_id = candidate.id

        response = client.get(f"/api/resumes/{candidate_id}")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"

        with Session(engine) as session:
            recovered = session.get(Candidate, candidate_id)
            assert recovered.resume_path == str(stored_pdf.resolve())
    finally:
        stored_pdf.unlink(missing_ok=True)


def test_resume_preview_recovers_uuid_file_from_original_filename():
    init_db()
    stored_pdf = settings.upload_dir / "uuid456_original-name.pdf"
    stored_pdf.write_bytes(make_pdf())
    try:
        with Session(engine) as session:
            candidate = Candidate(
                name="Original Filename Candidate",
                resume_filename="original-name.pdf",
                resume_path="/old/project/apps/api/uploads/missing-file.pdf",
            )
            session.add(candidate)
            session.commit()
            session.refresh(candidate)
            candidate_id = candidate.id

        response = client.head(f"/api/resumes/{candidate_id}")
        assert response.status_code == 200

        with Session(engine) as session:
            recovered = session.get(Candidate, candidate_id)
            assert recovered.resume_path == str(stored_pdf.resolve())
    finally:
        stored_pdf.unlink(missing_ok=True)


def test_delete_candidate_removes_scores_and_uploaded_pdf():
    init_db()
    stored_pdf = settings.upload_dir / "delete-me.pdf"
    stored_pdf.write_bytes(make_pdf())
    with Session(engine) as session:
        job = Job(title="Backend Engineer", description="Python", required_skills=["Python"], bonus_skills=[])
        candidate = Candidate(name="Delete Me", resume_filename="delete-me.pdf", resume_path=str(stored_pdf))
        session.add(job)
        session.add(candidate)
        session.commit()
        session.refresh(job)
        session.refresh(candidate)
        candidate_id = candidate.id
        session.add(
            Score(
                candidate_id=candidate_id,
                job_id=job.id,
                overall=70,
                skill_match=70,
                experience_relevance=70,
                education_fit=70,
                summary="Delete candidate score",
            )
        )
        session.commit()

    response = client.delete(f"/api/candidates/{candidate_id}")
    assert response.status_code == 204
    assert not stored_pdf.exists()

    with Session(engine) as session:
        assert session.get(Candidate, candidate_id) is None
        assert session.exec(select(Score).where(Score.candidate_id == candidate_id)).all() == []


def test_remote_storage_pdf_lifecycle(monkeypatch):
    class FakeRemoteStorage:
        def __init__(self):
            self.objects = {}
            self.deleted = []

        def save_upload(self, upload_file, stored_name):
            upload_file.file.seek(0)
            self.objects[stored_name] = upload_file.file.read()
            return stored_name

        def exists(self, key):
            return key in self.objects

        def get_bytes(self, key):
            return self.objects[key]

        def delete(self, key):
            self.deleted.append(key)
            self.objects.pop(key, None)

        def temp_pdf_path(self, key):
            temp = NamedTemporaryFile(delete=False, suffix=".pdf")
            temp.write(self.objects[key])
            temp.close()

            class TempPath:
                def __enter__(self):
                    return Path(temp.name)

                def __exit__(self, *_):
                    Path(temp.name).unlink(missing_ok=True)

            return TempPath()

    storage = FakeRemoteStorage()
    monkeypatch.setattr("app.main.resume_storage", storage)
    init_db()

    upload = client.post(
        "/api/resumes/upload",
        files=[("files", ("remote.pdf", make_pdf(), "application/pdf"))],
    )
    assert upload.status_code == 200
    candidate_id = upload.json()[0]["id"]
    stored_key = next(iter(storage.objects.keys()))
    assert stored_key.startswith("resumes/")

    preview = client.get(f"/api/resumes/{candidate_id}")
    assert preview.status_code == 200
    assert preview.content.startswith(b"%PDF")

    head = client.head(f"/api/resumes/{candidate_id}")
    assert head.status_code == 200

    delete = client.delete(f"/api/candidates/{candidate_id}")
    assert delete.status_code == 204
    assert storage.deleted == [stored_key]
    assert stored_key not in storage.objects


def test_compare_preserves_requested_order_and_returns_dimensions():
    init_db()
    with Session(engine) as session:
        job = Job(title="Frontend Engineer", description="React TypeScript", required_skills=["React"], bonus_skills=[])
        first = Candidate(name="First Candidate", resume_filename="first.pdf", resume_path="/tmp/first.pdf", skills=["React"])
        second = Candidate(name="Second Candidate", resume_filename="second.pdf", resume_path="/tmp/second.pdf", skills=["Vue"])
        session.add(job)
        session.add(first)
        session.add(second)
        session.commit()
        session.refresh(job)
        session.refresh(first)
        session.refresh(second)
        session.add(
            Score(
                candidate_id=first.id,
                job_id=job.id,
                overall=80,
                skill_match=90,
                experience_relevance=70,
                education_fit=65,
                summary="Strong React fit",
                strengths=["React"],
                gaps=[],
            )
        )
        session.add(
            Score(
                candidate_id=second.id,
                job_id=job.id,
                overall=60,
                skill_match=50,
                experience_relevance=68,
                education_fit=62,
                summary="Partial fit",
                strengths=["Frontend"],
                gaps=["React"],
            )
        )
        session.commit()
        first_id = first.id
        second_id = second.id

    response = client.post("/api/compare", json={"candidate_ids": [second_id, first_id]})
    assert response.status_code == 200
    candidates = response.json()["candidates"]
    assert [item["candidate"]["id"] for item in candidates] == [second_id, first_id]
    assert candidates[0]["score"]["overall"] == 60
    assert {"skill_match", "experience_relevance", "education_fit"}.issubset(candidates[0]["score"])
