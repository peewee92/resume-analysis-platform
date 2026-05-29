export type CandidateStatus = "pending" | "passed" | "interviewing" | "hired" | "rejected";
export type ResumeStatus = "uploaded" | "parsing" | "parsed" | "extracting" | "completed" | "failed";

export type Candidate = {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  status: CandidateStatus;
  skills: string[];
  education: Record<string, unknown>[];
  work_experience: Record<string, unknown>[];
  projects: Record<string, unknown>[];
  raw_text: string;
  cleaned_text: string;
  resume_filename: string;
  resume_status: ResumeStatus;
  latest_score?: number | null;
  created_at: string;
  updated_at: string;
};

export type UploadResult = {
  id: number;
  filename: string;
  status: ResumeStatus;
};

export type JobPayload = {
  title: string;
  description: string;
  required_skills: string[];
  bonus_skills: string[];
};

export type Score = {
  id: number;
  candidate_id: number;
  job_id?: number | null;
  overall: number;
  skill_match: number;
  experience_relevance: number;
  education_fit: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  created_at: string;
};
