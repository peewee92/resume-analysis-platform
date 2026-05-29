"use client";

import { useEffect, useState } from "react";
import { FileText, Sparkles, UserRound, X } from "lucide-react";
import type { Candidate, CandidateStatus } from "@/types";
import { StatusBadge } from "@/components/StatusBadge";

export type ProfileModalTab = "profile" | "resume" | "ai";

type StatusOption = { value: CandidateStatus; label: string };

type CandidateProfileModalProps = {
  apiBaseUrl: string;
  candidate: Candidate | null;
  onChange: (candidate: Candidate) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
  onTabChange: (tab: ProfileModalTab) => void;
  open: boolean;
  statusOptions: StatusOption[];
  tab: ProfileModalTab;
};

const tabOptions: { value: ProfileModalTab; label: string }[] = [
  { value: "profile", label: "基本资料" },
  { value: "resume", label: "简历预览" },
  { value: "ai", label: "AI 提取结果" },
];

function formatRecordValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function FieldCards({ emptyText, items }: { emptyText: string; items: Record<string, unknown>[] }) {
  if (!items.length) {
    return <div className="modal-empty">{emptyText}</div>;
  }

  return (
    <div className="ai-card-list">
      {items.map((item, index) => (
        <article className="ai-card" key={index}>
          {Object.entries(item).map(([key, value]) => (
            <p key={key}>
              <span>{key}</span>
              {formatRecordValue(value)}
            </p>
          ))}
        </article>
      ))}
    </div>
  );
}

export function CandidateProfileModal({
  apiBaseUrl,
  candidate,
  onChange,
  onClose,
  onSave,
  onTabChange,
  open,
  statusOptions,
  tab,
}: CandidateProfileModalProps) {
  const [resumeError, setResumeError] = useState("");

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open || tab !== "resume" || !candidate) return;

    let cancelled = false;
    setResumeError("");
    fetch(`${apiBaseUrl}/api/resumes/${candidate.id}`, { method: "HEAD" })
      .then((response) => {
        if (!cancelled && !response.ok) {
          setResumeError("没有在保存路径或上传目录中找到原始 PDF。若文件已被删除，请重新上传该候选人的简历。");
        }
      })
      .catch(() => {
        if (!cancelled) setResumeError("无法连接后端服务，暂时不能加载 PDF 预览。");
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, candidate, open, tab]);

  if (!open || !candidate) return null;

  return (
    <div className="profile-modal-overlay" onClick={onClose} role="presentation">
      <section className="profile-modal" aria-modal="true" onClick={(event) => event.stopPropagation()} role="dialog">
        <header className="profile-modal-header">
          <div>
            <span className="eyebrow compact">Candidate Profile</span>
            <h2>{candidate.name}</h2>
            <p>{candidate.email || candidate.city || candidate.resume_filename}</p>
          </div>
          <div className="modal-status-group">
            <StatusBadge value={candidate.status} />
            <StatusBadge value={candidate.resume_status} />
            <button className="icon-button" onClick={onClose} aria-label="关闭候选人资料">
              <X size={18} />
            </button>
          </div>
        </header>

        <nav className="modal-tabs" aria-label="候选人资料标签">
          {tabOptions.map((option) => (
            <button className={tab === option.value ? "modal-tab active" : "modal-tab"} key={option.value} onClick={() => onTabChange(option.value)}>
              {option.value === "profile" && <UserRound size={16} />}
              {option.value === "resume" && <FileText size={16} />}
              {option.value === "ai" && <Sparkles size={16} />}
              {option.label}
            </button>
          ))}
        </nav>

        <div className="profile-modal-body">
          {tab === "profile" && (
            <div className="profile-form">
              <div className="detail-summary">
                <div>
                  <span>技能标签</span>
                  <strong>{candidate.skills.length}</strong>
                </div>
                <div>
                  <span>状态</span>
                  <strong>{statusOptions.find((option) => option.value === candidate.status)?.label}</strong>
                </div>
                <div>
                  <span>解析状态</span>
                  <strong>{candidate.resume_status}</strong>
                </div>
              </div>
              <div className="form-grid profile-form-grid">
                <label>姓名<input value={candidate.name} onChange={(event) => onChange({ ...candidate, name: event.target.value })} /></label>
                <label>邮箱<input value={candidate.email || ""} onChange={(event) => onChange({ ...candidate, email: event.target.value })} /></label>
                <label>电话<input value={candidate.phone || ""} onChange={(event) => onChange({ ...candidate, phone: event.target.value })} /></label>
                <label>城市<input value={candidate.city || ""} onChange={(event) => onChange({ ...candidate, city: event.target.value })} /></label>
                <label>
                  状态
                  <select value={candidate.status} onChange={(event) => onChange({ ...candidate, status: event.target.value as CandidateStatus })}>
                    {statusOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label>技能<input value={candidate.skills.join(", ")} onChange={(event) => onChange({ ...candidate, skills: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /></label>
              </div>
            </div>
          )}

          {tab === "resume" && (
            <div className="modal-resume-preview">
              <div className="modal-resume-tools">
                <span>{candidate.resume_filename}</span>
                <a className="secondary-link" href={`${apiBaseUrl}/api/resumes/${candidate.id}`} rel="noreferrer" target="_blank">新窗口打开</a>
              </div>
              {resumeError ? (
                <div className="modal-empty">{resumeError}</div>
              ) : (
                <iframe className="modal-resume-frame" title="PDF preview" src={`${apiBaseUrl}/api/resumes/${candidate.id}`} />
              )}
            </div>
          )}

          {tab === "ai" && (
            <div className="ai-result-grid">
              <section>
                <h3>技能标签</h3>
                <div className="modal-tag-list">
                  {candidate.skills.length ? candidate.skills.map((skill) => <span className="tag" key={skill}>{skill}</span>) : <span className="modal-muted">暂无技能标签</span>}
                </div>
              </section>
              <section>
                <h3>教育背景</h3>
                <FieldCards emptyText="暂无教育背景" items={candidate.education} />
              </section>
              <section>
                <h3>工作经历</h3>
                <FieldCards emptyText="暂无工作经历" items={candidate.work_experience} />
              </section>
              <section>
                <h3>项目经历</h3>
                <FieldCards emptyText="暂无项目经历" items={candidate.projects} />
              </section>
              <section className="ai-text-section">
                <h3>清洗后的简历文本</h3>
                <pre>{candidate.cleaned_text || "暂无文本"}</pre>
              </section>
            </div>
          )}
        </div>

        <footer className="profile-modal-footer">
          <button className="secondary-button" onClick={onClose}>关闭</button>
          <button className="primary-button" onClick={onSave}>保存修正</button>
        </footer>
      </section>
    </div>
  );
}
