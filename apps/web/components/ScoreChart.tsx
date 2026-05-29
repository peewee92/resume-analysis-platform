"use client";

import { Bar, BarChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { Score } from "@/types";

export function ScoreChart({ score }: { score?: Score | null }) {
  if (!score) {
    return <div className="empty">暂无评分</div>;
  }
  const data = [
    { subject: "技能", value: score.skill_match },
    { subject: "经验", value: score.experience_relevance },
    { subject: "教育", value: score.education_fit },
    { subject: "综合", value: score.overall },
  ];
  return (
    <div className="chart-grid">
      <div className="ring" style={{ ["--score" as string]: `${score.overall * 3.6}deg` }}>
        <div className="ring-content">
          <strong>{score.overall}</strong>
          <span>综合匹配</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <RadarChart data={data}>
          <PolarGrid />
          <PolarAngleAxis dataKey="subject" />
          <PolarRadiusAxis angle={90} domain={[0, 100]} />
          <Radar dataKey="value" stroke="#2563eb" fill="#2563eb" fillOpacity={0.28} />
        </RadarChart>
      </ResponsiveContainer>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data}>
          <XAxis dataKey="subject" />
          <YAxis domain={[0, 100]} />
          <Bar dataKey="value" fill="#14b8a6" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
