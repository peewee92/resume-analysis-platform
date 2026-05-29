import asyncio
from io import BytesIO
import json
from datetime import datetime
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

from sqlalchemy import func
from fastapi import Depends, FastAPI, File, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, col, desc, or_, select

from .ai import extract_resume, score_candidate
from .config import settings
from .database import get_session, init_db
from .models import (
    Candidate,
    CandidateRead,
    CandidateStatus,
    CandidateUpdate,
    CompareRequest,
    Job,
    JobCreate,
    ResumeStatus,
    ResumeUploadResult,
    Score,
    ScoreCreate,
)
from .pdf_parser import clean_resume_text, extract_pdf_text
from .storage import LocalResumeStorage, ResumeNotFoundError, get_resume_storage


app = FastAPI(title=settings.app_name)
resume_storage = get_resume_storage()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}):\d{2,5}$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.exception_handler(OperationalError)
async def database_operational_error_handler(_, exc: OperationalError):
    return JSONResponse(
        status_code=503,
        content={
            "detail": (
                "Database is not writable or temporarily unavailable. "
                "Please stop the API server, make apps/api/resume_analysis.db and apps/api writable, then restart FastAPI."
            ),
            "error": str(exc.orig),
        },
    )


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def get_candidate_or_404(candidate_id: int, session: Session) -> Candidate:
    candidate = session.get(Candidate, candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return candidate


def _existing_pdf_path(path: Path) -> Path | None:
    if path.exists() and path.is_file() and path.suffix.lower() == ".pdf":
        return path.resolve()
    return None


def _uses_local_storage() -> bool:
    return isinstance(resume_storage, LocalResumeStorage)


def _resume_path_candidates(candidate: Candidate) -> list[Path]:
    stored_path = Path(candidate.resume_path)
    candidates = [stored_path]

    if stored_path.name:
        candidates.append(settings.upload_dir / stored_path.name)
    if candidate.resume_filename:
        candidates.append(settings.upload_dir / candidate.resume_filename)
        candidates.extend(sorted(settings.upload_dir.glob(f"*_{candidate.resume_filename}")))

    if not stored_path.is_absolute():
        candidates.append((settings.upload_dir / stored_path).resolve())

    unique: list[Path] = []
    seen: set[str] = set()
    for path in candidates:
        key = str(path)
        if key not in seen:
            unique.append(path)
            seen.add(key)
    return unique


def get_resume_key_or_404(candidate: Candidate, session: Session) -> str:
    if _uses_local_storage():
        for path in _resume_path_candidates(candidate):
            resolved = _existing_pdf_path(path)
            if resolved:
                if candidate.resume_path != str(resolved):
                    candidate.resume_path = str(resolved)
                    candidate.updated_at = datetime.utcnow()
                    session.add(candidate)
                    session.commit()
                    session.refresh(candidate)
                return str(resolved)
    else:
        if resume_storage.exists(candidate.resume_path):
            return candidate.resume_path

    raise HTTPException(
        status_code=404,
        detail=(
            "Resume PDF file cannot be found in the configured storage. "
            "Please re-upload this resume if the file was deleted."
        ),
    )


def _resume_delete_keys(candidate: Candidate) -> list[str]:
    if not _uses_local_storage():
        return [candidate.resume_path]
    return [
        str(path)
        for path in _resume_path_candidates(candidate)
        if _existing_pdf_path(path) and resume_storage.is_upload_file(path)
    ]


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/resumes/upload", response_model=list[ResumeUploadResult])
async def upload_resumes(files: list[UploadFile] = File(...), session: Session = Depends(get_session)):
    if len(files) > 20:
        raise HTTPException(status_code=400, detail="Upload at most 20 resumes at once")

    results: list[ResumeUploadResult] = []
    for file in files:
        if file.content_type != "application/pdf" and not file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail=f"{file.filename} is not a PDF")
        stored_name = f"resumes/{uuid4().hex}_{Path(file.filename).name}"
        resume_key = resume_storage.save_upload(file, stored_name)
        candidate = Candidate(
            name=Path(file.filename).stem.replace("_", " ").replace("-", " "),
            resume_filename=file.filename,
            resume_path=resume_key,
            resume_status=ResumeStatus.uploaded,
        )
        session.add(candidate)
        session.commit()
        session.refresh(candidate)
        results.append(ResumeUploadResult(id=candidate.id, filename=file.filename, status=candidate.resume_status))
    return results


@app.get("/api/resumes/{candidate_id}")
def get_resume_file(candidate_id: int, session: Session = Depends(get_session)):
    candidate = get_candidate_or_404(candidate_id, session)
    resume_key = get_resume_key_or_404(candidate, session)
    try:
        data = resume_storage.get_bytes(resume_key)
    except ResumeNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return StreamingResponse(
        BytesIO(data),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(candidate.resume_filename)}"},
    )


@app.head("/api/resumes/{candidate_id}")
def head_resume_file(candidate_id: int, session: Session = Depends(get_session)):
    candidate = get_candidate_or_404(candidate_id, session)
    get_resume_key_or_404(candidate, session)
    return Response(status_code=200, media_type="application/pdf")


@app.get("/api/candidates", response_model=list[CandidateRead])
def list_candidates(
    response: Response,
    q: str | None = None,
    status: CandidateStatus | None = None,
    skill: str | None = None,
    sort: str = Query(default="created_desc", pattern="^(created_desc|score_desc|score_asc|name_asc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=50),
    session: Session = Depends(get_session),
):
    statement = select(Candidate)
    count_statement = select(func.count()).select_from(Candidate)
    if q:
        like = f"%{q}%"
        condition = or_(col(Candidate.name).like(like), col(Candidate.email).like(like), col(Candidate.cleaned_text).like(like))
        statement = statement.where(condition)
        count_statement = count_statement.where(condition)
    if status:
        statement = statement.where(Candidate.status == status)
        count_statement = count_statement.where(Candidate.status == status)
    if skill:
        condition = col(Candidate.cleaned_text).like(f"%{skill}%")
        statement = statement.where(condition)
        count_statement = count_statement.where(condition)
    response.headers["X-Total-Count"] = str(session.exec(count_statement).one())
    if sort == "score_desc":
        statement = statement.order_by(desc(Candidate.latest_score))
    elif sort == "score_asc":
        statement = statement.order_by(Candidate.latest_score)
    elif sort == "name_asc":
        statement = statement.order_by(Candidate.name)
    else:
        statement = statement.order_by(desc(Candidate.created_at))
    statement = statement.offset((page - 1) * page_size).limit(page_size)
    return session.exec(statement).all()


@app.get("/api/candidates/{candidate_id}", response_model=CandidateRead)
def get_candidate(candidate_id: int, session: Session = Depends(get_session)):
    return get_candidate_or_404(candidate_id, session)


@app.patch("/api/candidates/{candidate_id}", response_model=CandidateRead)
def update_candidate(candidate_id: int, payload: CandidateUpdate, session: Session = Depends(get_session)):
    candidate = get_candidate_or_404(candidate_id, session)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(candidate, key, value)
    candidate.updated_at = datetime.utcnow()
    session.add(candidate)
    session.commit()
    session.refresh(candidate)
    return candidate


@app.delete("/api/candidates/{candidate_id}", status_code=204)
def delete_candidate(candidate_id: int, session: Session = Depends(get_session)):
    candidate = get_candidate_or_404(candidate_id, session)
    resume_keys = _resume_delete_keys(candidate)

    for score in session.exec(select(Score).where(Score.candidate_id == candidate_id)).all():
        session.delete(score)
    session.delete(candidate)
    session.commit()

    for key in resume_keys:
        resume_storage.delete(key)

    return Response(status_code=204)


@app.get("/api/candidates/{candidate_id}/extract/stream")
async def extract_stream(candidate_id: int, session: Session = Depends(get_session)):
    candidate = get_candidate_or_404(candidate_id, session)

    async def generate():
        try:
            candidate.resume_status = ResumeStatus.parsing
            session.add(candidate)
            session.commit()
            yield sse("status", {"step": "parsing", "message": "Reading PDF text"})
            await asyncio.sleep(0.2)

            resume_key = get_resume_key_or_404(candidate, session)
            with resume_storage.temp_pdf_path(resume_key) as resume_path:
                raw_text = extract_pdf_text(resume_path)
            cleaned_text = clean_resume_text(raw_text)
            candidate.raw_text = raw_text
            candidate.cleaned_text = cleaned_text
            candidate.resume_status = ResumeStatus.parsed
            session.add(candidate)
            session.commit()
            yield sse("parsed", {"characters": len(cleaned_text), "preview": cleaned_text[:600]})

            candidate.resume_status = ResumeStatus.extracting
            session.add(candidate)
            session.commit()
            yield sse("status", {"step": "extracting", "message": "Extracting structured information"})

            data = await extract_resume(cleaned_text)
            for field in ["name", "phone", "email", "city", "education", "work_experience", "skills", "projects"]:
                yield sse("field", {"field": field, "value": data.get(field)})
                await asyncio.sleep(0.12)

            candidate.name = data.get("name") or candidate.name
            candidate.phone = data.get("phone")
            candidate.email = data.get("email")
            candidate.city = data.get("city")
            candidate.skills = data.get("skills") or []
            candidate.education = data.get("education") or []
            candidate.work_experience = data.get("work_experience") or []
            candidate.projects = data.get("projects") or []
            candidate.resume_status = ResumeStatus.completed
            candidate.updated_at = datetime.utcnow()
            session.add(candidate)
            session.commit()
            session.refresh(candidate)
            yield sse("done", {"candidate": CandidateRead.model_validate(candidate).model_dump(mode="json")})
        except Exception as exc:
            candidate.resume_status = ResumeStatus.failed
            session.add(candidate)
            session.commit()
            yield sse("error", {"message": str(exc)})

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/api/jobs", response_model=Job)
def create_job(payload: JobCreate, session: Session = Depends(get_session)):
    job = Job.model_validate(payload)
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


@app.post("/api/scores", response_model=Score)
async def create_score(payload: ScoreCreate, session: Session = Depends(get_session)):
    candidate = get_candidate_or_404(payload.candidate_id, session)
    job: Job | None = None
    if payload.job_id:
        job = session.get(Job, payload.job_id)
    if not job and payload.job:
        job = Job.model_validate(payload.job)
        session.add(job)
        session.commit()
        session.refresh(job)
    if not job:
        raise HTTPException(status_code=400, detail="A job_id or inline job is required")

    result = await score_candidate(candidate, JobCreate.model_validate(job))
    score = Score(candidate_id=candidate.id, job_id=job.id, **result)
    session.add(score)
    candidate.latest_score = score.overall
    candidate.updated_at = datetime.utcnow()
    session.add(candidate)
    session.commit()
    session.refresh(score)
    return score


@app.get("/api/scores/{candidate_id}", response_model=list[Score])
def get_scores(candidate_id: int, session: Session = Depends(get_session)):
    return session.exec(select(Score).where(Score.candidate_id == candidate_id).order_by(desc(Score.created_at))).all()


@app.post("/api/compare")
def compare_candidates(payload: CompareRequest, session: Session = Depends(get_session)):
    ids = payload.candidate_ids[:3]
    candidates = session.exec(select(Candidate).where(col(Candidate.id).in_(ids))).all()
    scores = session.exec(select(Score).where(col(Score.candidate_id).in_(ids)).order_by(desc(Score.created_at))).all()
    latest: dict[int, Score] = {}
    for score in scores:
        latest.setdefault(score.candidate_id, score)
    ordered_candidates = sorted(candidates, key=lambda candidate: ids.index(candidate.id) if candidate.id in ids else len(ids))
    return {
        "candidates": [
            {
                "candidate": CandidateRead.model_validate(candidate).model_dump(mode="json"),
                "score": latest.get(candidate.id).model_dump(mode="json") if latest.get(candidate.id) else None,
            }
            for candidate in ordered_candidates
        ]
    }
