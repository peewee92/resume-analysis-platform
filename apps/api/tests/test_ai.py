from app.ai import _normalize_score_result, _score_needs_fallback, fallback_extract, fallback_score
from app.models import Candidate, JobCreate


def test_fallback_extract_structures_resume_sections():
    data = fallback_extract(
        """
Alice Chen
Email: alice@example.com
Phone: +1 415 555 0101
City: San Francisco
Skills: React TypeScript Python FastAPI PostgreSQL
Education: Stanford University, Computer Science, Master, 2021
Experience: Built AI dashboards and REST APIs for hiring teams.
Project: Resume Intelligence Platform
Role: Full-stack engineer
Highlights: SSE streaming, AI extraction, scoring charts
"""
    )

    assert data["name"] == "Alice Chen"
    assert data["email"] == "alice@example.com"
    assert data["city"] == "San Francisco"
    assert "React" in data["skills"]
    assert data["education"][0]["school"] == "Stanford University"
    assert data["education"][0]["degree"] == "Master"
    assert data["work_experience"][0]["summary"].startswith("Built AI dashboards")
    assert data["projects"][0]["name"] == "Resume Intelligence Platform"


def test_fallback_score_returns_required_dimensions():
    candidate = Candidate(
        name="Alice Chen",
        resume_filename="resume.pdf",
        resume_path="/tmp/resume.pdf",
        skills=["React", "TypeScript", "Python"],
        education=[{"school": "Stanford"}],
        work_experience=[{"summary": "Built dashboards"}],
    )
    job = JobCreate(
        title="Full-stack Engineer",
        description="React and Python",
        required_skills=["React", "Python"],
        bonus_skills=["TypeScript"],
    )

    score = fallback_score(candidate, job)

    assert 0 <= score["overall"] <= 100
    assert score["skill_match"] >= 75
    assert score["experience_relevance"] > 0
    assert score["education_fit"] > 0
    assert score["summary"]


def test_zero_ai_score_with_resume_evidence_uses_fallback_guard():
    candidate = Candidate(
        name="Frontend Engineer",
        resume_filename="resume.pdf",
        resume_path="/tmp/resume.pdf",
        skills=["React", "TypeScript", "Node.js"],
        education=[{"school": "Hunan University"}],
        work_experience=[{"summary": "Built trading systems with React and TypeScript"}],
    )
    job = JobCreate(
        title="Senior Full-stack Engineer",
        description="React TypeScript Python FastAPI",
        required_skills=["React", "TypeScript", "Python", "FastAPI"],
        bonus_skills=["Docker"],
    )
    fallback = fallback_score(candidate, job)
    ai_result = _normalize_score_result(
        {
            "overall": 0,
            "skill_match": 0,
            "experience_relevance": 0,
            "education_fit": 0,
            "summary": "No relevant skills.",
            "strengths": [],
            "gaps": ["No React or TypeScript."],
        }
    )

    assert fallback["overall"] >= 30
    assert _score_needs_fallback(ai_result, fallback)
