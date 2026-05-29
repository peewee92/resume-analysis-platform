import type { Candidate, JobPayload, Score, UploadResult } from "@/types";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

function toFriendlyError(error: unknown): Error {
  if (error instanceof TypeError && error.message === "Failed to fetch") {
    return new Error(`无法连接后端服务。请确认 FastAPI 已启动，并且 NEXT_PUBLIC_API_BASE_URL 指向 ${API_BASE_URL}`);
  }
  return error instanceof Error ? error : new Error("请求失败，请稍后重试");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Request failed: ${response.status}`);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  } catch (error) {
    throw toFriendlyError(error);
  }
}

export async function uploadResumes(files: File[]): Promise<UploadResult[]> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  try {
    const response = await fetch(`${API_BASE_URL}/api/resumes/upload`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.json();
  } catch (error) {
    throw toFriendlyError(error);
  }
}

export function listCandidates(params: URLSearchParams): Promise<Candidate[]> {
  return request<Candidate[]>(`/api/candidates?${params.toString()}`);
}

export async function listCandidatesPage(params: URLSearchParams): Promise<{ items: Candidate[]; total: number }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/candidates?${params.toString()}`);
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Request failed: ${response.status}`);
    }
    const items = (await response.json()) as Candidate[];
    return {
      items,
      total: Number(response.headers.get("X-Total-Count") || items.length),
    };
  } catch (error) {
    throw toFriendlyError(error);
  }
}

export function getCandidate(id: number): Promise<Candidate> {
  return request<Candidate>(`/api/candidates/${id}`);
}

export function updateCandidate(id: number, payload: Partial<Candidate>): Promise<Candidate> {
  return request<Candidate>(`/api/candidates/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteCandidate(id: number): Promise<void> {
  return request<void>(`/api/candidates/${id}`, {
    method: "DELETE",
  });
}

export function createScore(candidateId: number, job: JobPayload): Promise<Score> {
  return request<Score>("/api/scores", {
    method: "POST",
    body: JSON.stringify({ candidate_id: candidateId, job }),
  });
}

export function getScores(candidateId: number): Promise<Score[]> {
  return request<Score[]>(`/api/scores/${candidateId}`);
}

export function compareCandidates(candidateIds: number[]) {
  return request<{ candidates: { candidate: Candidate; score?: Score | null }[] }>("/api/compare", {
    method: "POST",
    body: JSON.stringify({ candidate_ids: candidateIds }),
  });
}
