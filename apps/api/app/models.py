from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class CandidateStatus(str, Enum):
    pending = "pending"
    passed = "passed"
    interviewing = "interviewing"
    hired = "hired"
    rejected = "rejected"


class ResumeStatus(str, Enum):
    uploaded = "uploaded"
    parsing = "parsing"
    parsed = "parsed"
    extracting = "extracting"
    completed = "completed"
    failed = "failed"


class CandidateBase(SQLModel):
    name: str = "Unknown Candidate"
    phone: str | None = None
    email: str | None = None
    city: str | None = None
    status: CandidateStatus = CandidateStatus.pending
    skills: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    education: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    work_experience: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    projects: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    raw_text: str = ""
    cleaned_text: str = ""


class Candidate(CandidateBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    resume_filename: str
    resume_path: str
    resume_status: ResumeStatus = ResumeStatus.uploaded
    latest_score: int | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CandidateRead(CandidateBase):
    id: int
    resume_filename: str
    resume_status: ResumeStatus
    latest_score: int | None
    created_at: datetime
    updated_at: datetime


class CandidateUpdate(SQLModel):
    name: str | None = None
    phone: str | None = None
    email: str | None = None
    city: str | None = None
    status: CandidateStatus | None = None
    skills: list[str] | None = None
    education: list[dict[str, Any]] | None = None
    work_experience: list[dict[str, Any]] | None = None
    projects: list[dict[str, Any]] | None = None


class ResumeUploadResult(SQLModel):
    id: int
    filename: str
    status: ResumeStatus


class JobCreate(SQLModel):
    title: str
    description: str
    required_skills: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    bonus_skills: list[str] = Field(default_factory=list, sa_column=Column(JSON))


class Job(JobCreate, table=True):
    id: int | None = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ScoreCreate(SQLModel):
    candidate_id: int
    job_id: int | None = None
    job: JobCreate | None = None


class Score(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    candidate_id: int = Field(foreign_key="candidate.id")
    job_id: int | None = Field(default=None, foreign_key="job.id")
    overall: int
    skill_match: int
    experience_relevance: int
    education_fit: int
    summary: str
    strengths: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    gaps: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CompareRequest(SQLModel):
    candidate_ids: list[int]
    job_id: int | None = None
