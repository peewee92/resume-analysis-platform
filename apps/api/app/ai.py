import json
import re
from typing import Any

import httpx
from openai import AsyncOpenAI

from .config import settings
from .models import Candidate, JobCreate


EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_RE = re.compile(r"(?:\+?\d[\d\s().-]{7,}\d)")
SKILL_BANK = [
    "React",
    "Next.js",
    "TypeScript",
    "JavaScript",
    "Python",
    "FastAPI",
    "Flask",
    "Node.js",
    "Express",
    "PostgreSQL",
    "SQLite",
    "MongoDB",
    "Docker",
    "AWS",
    "OpenAI",
    "LLM",
    "TensorFlow",
    "PyTorch",
    "SQL",
    "Redis",
    "Kubernetes",
]


def _json_from_text(text: str) -> dict[str, Any]:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("AI response did not contain JSON")
    return json.loads(match.group(0))


def _field_after_label(text: str, labels: list[str]) -> str:
    label_pattern = "|".join(re.escape(label) for label in labels)
    match = re.search(rf"(?:{label_pattern})[:：]\s*(.+)", text, re.IGNORECASE)
    return match.group(1).strip() if match else ""


def _split_profile_line(value: str, expected: int) -> list[str]:
    parts = [part.strip() for part in re.split(r"[,，|/]", value) if part.strip()]
    return (parts + [""] * expected)[:expected]


def openai_client() -> AsyncOpenAI:
    client_kwargs: dict[str, Any] = {"api_key": settings.openai_api_key}
    if settings.openai_base_url:
        client_kwargs["base_url"] = settings.openai_base_url

    http_client = httpx.AsyncClient(
        proxy=settings.openai_proxy,
        trust_env=settings.openai_trust_env,
    )
    return AsyncOpenAI(**client_kwargs, http_client=http_client)


def fallback_extract(text: str) -> dict[str, Any]:
    email = EMAIL_RE.search(text)
    phone = PHONE_RE.search(text)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    likely_name = next((line for line in lines[:8] if 2 <= len(line) <= 50 and "@" not in line), "Unknown Candidate")
    skills = [skill for skill in SKILL_BANK if re.search(rf"\b{re.escape(skill)}\b", text, re.IGNORECASE)]
    city = None
    city_match = re.search(r"(?:City|Location|所在地|城市)[:：]\s*([A-Za-z\u4e00-\u9fa5 ]{2,30})", text, re.IGNORECASE)
    if city_match:
        city = city_match.group(1).strip()

    school, major, degree, graduation_time = _split_profile_line(_field_after_label(text, ["Education", "教育背景", "教育经历"]), 4)
    company, title, period = _split_profile_line(_field_after_label(text, ["Company", "公司"]), 3)
    experience_summary = _field_after_label(text, ["Experience", "Work Experience", "工作经历", "经历"]) or text[:420]
    project_name = _field_after_label(text, ["Project", "项目经历", "项目"])
    project_role = _field_after_label(text, ["Role", "个人职责", "职责"])
    project_highlights = _field_after_label(text, ["Highlights", "项目亮点", "亮点"])

    return {
        "name": likely_name,
        "phone": phone.group(0).strip() if phone else None,
        "email": email.group(0) if email else None,
        "city": city,
        "skills": skills[:16],
        "education": [{"school": school, "major": major, "degree": degree, "graduation_time": graduation_time}],
        "work_experience": [
            {
                "company": company,
                "title": title,
                "period": period,
                "summary": experience_summary,
            }
        ],
        "projects": [
            {
                "name": project_name,
                "tech_stack": skills[:8],
                "role": project_role,
                "highlights": project_highlights,
            }
        ]
        if project_name or project_role or project_highlights
        else [],
    }


async def extract_resume(text: str) -> dict[str, Any]:
    if not settings.openai_api_key:
        return fallback_extract(text)

    client = openai_client()
    prompt = f"""
Extract structured resume information as strict JSON with keys:
name, phone, email, city, education, work_experience, skills, projects.
education items: school, major, degree, graduation_time.
work_experience items: company, title, period, summary.
project items: name, tech_stack, role, highlights.
Return JSON only.

Resume:
{text[:16000]}
"""
    try:
        response = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
        )
        content = response.choices[0].message.content or "{}"
        data = _json_from_text(content)
        fallback = fallback_extract(text)
        return {**fallback, **data}
    except Exception:
        return fallback_extract(text)
    finally:
        await client.close()


def fallback_score(candidate: Candidate, job: JobCreate) -> dict[str, Any]:
    required = {skill.lower() for skill in job.required_skills}
    bonus = {skill.lower() for skill in job.bonus_skills}
    candidate_skills = {skill.lower() for skill in candidate.skills}
    required_hits = len(required & candidate_skills)
    bonus_hits = len(bonus & candidate_skills)
    skill_score = 55 if not required else round((required_hits / max(len(required), 1)) * 75 + min(bonus_hits * 8, 25))
    experience_score = 70 if candidate.work_experience else 45
    education_score = 72 if candidate.education else 50
    overall = round(skill_score * 0.5 + experience_score * 0.3 + education_score * 0.2)
    strengths = list(required & candidate_skills)[:5] or candidate.skills[:5]
    gaps = list(required - candidate_skills)[:5]
    return {
        "overall": max(0, min(100, overall)),
        "skill_match": max(0, min(100, skill_score)),
        "experience_relevance": experience_score,
        "education_fit": education_score,
        "summary": f"{candidate.name} matches {required_hits} required skills and {bonus_hits} bonus skills. Review highlighted gaps before interview.",
        "strengths": strengths,
        "gaps": gaps,
    }


def _normalize_score_result(result: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key in ["overall", "skill_match", "experience_relevance", "education_fit"]:
        try:
            value = int(result.get(key, 0))
        except (TypeError, ValueError):
            value = 0
        normalized[key] = max(0, min(100, value))

    normalized["summary"] = str(result.get("summary") or "").strip()
    normalized["strengths"] = result.get("strengths") if isinstance(result.get("strengths"), list) else []
    normalized["gaps"] = result.get("gaps") if isinstance(result.get("gaps"), list) else []
    return normalized


def _score_needs_fallback(ai_result: dict[str, Any], fallback_result: dict[str, Any]) -> bool:
    has_resume_evidence = fallback_result["skill_match"] >= 25 or fallback_result["experience_relevance"] >= 65
    ai_says_no_fit = ai_result["overall"] <= 5 and ai_result["skill_match"] <= 5 and ai_result["experience_relevance"] <= 5
    large_gap = fallback_result["overall"] - ai_result["overall"] >= 30
    return has_resume_evidence and ai_says_no_fit and large_gap


async def score_candidate(candidate: Candidate, job: JobCreate) -> dict[str, Any]:
    fallback_result = fallback_score(candidate, job)
    if not settings.openai_api_key:
        return fallback_result

    client = openai_client()
    prompt = f"""
Score this candidate against the job as strict JSON with keys:
overall, skill_match, experience_relevance, education_fit, summary, strengths, gaps.
Scores must be integers from 0 to 100.

Job:
{job.model_dump_json()}

Candidate:
{candidate.model_dump_json()}
"""
    try:
        response = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
        )
        ai_result = _normalize_score_result(_json_from_text(response.choices[0].message.content or "{}"))
        if _score_needs_fallback(ai_result, fallback_result):
            return fallback_result
        return ai_result
    except Exception:
        return fallback_result
    finally:
        await client.close()
