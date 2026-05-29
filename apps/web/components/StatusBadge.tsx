import type { CandidateStatus, ResumeStatus } from "@/types";

const candidateLabels: Record<CandidateStatus, string> = {
  pending: "待筛选",
  passed: "初筛通过",
  interviewing: "面试中",
  hired: "已录用",
  rejected: "已淘汰",
};

const resumeLabels: Record<ResumeStatus, string> = {
  uploaded: "已上传",
  parsing: "解析中",
  parsed: "已解析",
  extracting: "AI 提取中",
  completed: "已完成",
  failed: "失败",
};

export function StatusBadge({ value }: { value: CandidateStatus | ResumeStatus }) {
  const label = (candidateLabels as Record<string, string>)[value] || (resumeLabels as Record<string, string>)[value] || value;
  return <span className={`status status-${value}`}>{label}</span>;
}
