"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChartOutlined,
  DeleteOutlined,
  FilePdfOutlined,
  MoonOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SunOutlined,
  ThunderboltOutlined,
  UploadOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  ConfigProvider,
  Descriptions,
  Drawer,
  Empty,
  Flex,
  Form,
  Input,
  List,
  Modal,
  Progress,
  Segmented,
  Select,
  Skeleton,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  theme as antdTheme,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import type { TableColumnsType } from "antd";
import { API_BASE_URL, compareCandidates, createScore, deleteCandidate, getCandidate, getScores, listCandidatesPage, updateCandidate, uploadResumes } from "@/lib/api";
import type { Candidate, CandidateStatus, JobPayload, ResumeStatus, Score, UploadResult } from "@/types";
import { ScoreChart } from "@/components/ScoreChart";

const { Dragger } = Upload;
const { Text, Title } = Typography;
const pageSize = 10;

const statusOptions: { value: CandidateStatus; label: string }[] = [
  { value: "pending", label: "待筛选" },
  { value: "passed", label: "初筛通过" },
  { value: "interviewing", label: "面试中" },
  { value: "hired", label: "已录用" },
  { value: "rejected", label: "已淘汰" },
];

const candidateStatusMeta: Record<CandidateStatus, { label: string; color: string }> = {
  pending: { label: "待筛选", color: "gold" },
  passed: { label: "初筛通过", color: "green" },
  interviewing: { label: "面试中", color: "blue" },
  hired: { label: "已录用", color: "cyan" },
  rejected: { label: "已淘汰", color: "red" },
};

const resumeStatusMeta: Record<ResumeStatus, { label: string; color: string }> = {
  uploaded: { label: "已上传", color: "gold" },
  parsing: { label: "解析中", color: "blue" },
  parsed: { label: "已解析", color: "geekblue" },
  extracting: { label: "AI 提取中", color: "purple" },
  completed: { label: "已完成", color: "green" },
  failed: { label: "失败", color: "red" },
};

const defaultJob: JobPayload = {
  title: "Senior Full-stack Engineer",
  description: "Build AI-enabled products with React, TypeScript, Python APIs, data visualization, and cloud deployment experience.",
  required_skills: ["React", "TypeScript", "Python", "FastAPI"],
  bonus_skills: ["OpenAI", "PostgreSQL", "Docker"],
};

const compareDimensions = [
  { key: "skill_match", label: "技能匹配" },
  { key: "experience_relevance", label: "经验相关" },
  { key: "education_fit", label: "教育契合" },
] as const;

type DrawerTab = "profile" | "resume" | "ai" | "score";
type UploadStreamItem = { id: number; filename: string; messages: string[]; fields: Record<string, unknown>; done?: boolean; error?: string };
type JobProfile = JobPayload & { id: string };
type JobScoreResult = { job: JobProfile; score: Score };
type ProfileFormValues = {
  name: string;
  email?: string;
  phone?: string;
  city?: string;
  status: CandidateStatus;
  skills?: string;
};

const initialJobs: JobProfile[] = [{ id: "jd-1", ...defaultJob }];

function StatusTag({ value }: { value: CandidateStatus | ResumeStatus }) {
  const meta = (candidateStatusMeta as Record<string, { label: string; color: string }>)[value] || (resumeStatusMeta as Record<string, { label: string; color: string }>)[value];
  return <Tag color={meta?.color || "default"}>{meta?.label || value}</Tag>;
}

function formatRecordValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function FieldList({ emptyText, items }: { emptyText: string; items: Record<string, unknown>[] }) {
  if (!items.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;

  return (
    <List
      dataSource={items}
      renderItem={(item) => (
        <List.Item>
          <Card size="small" className="full-width-card">
            <Descriptions size="small" column={1}>
              {Object.entries(item).map(([key, value]) => (
                <Descriptions.Item key={key} label={key}>
                  {formatRecordValue(value)}
                </Descriptions.Item>
              ))}
            </Descriptions>
          </Card>
        </List.Item>
      )}
    />
  );
}

export default function Home() {
  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");

  useEffect(() => {
    document.body.dataset.theme = themeMode;
  }, [themeMode]);

  return (
    <ConfigProvider
      theme={{
        algorithm: themeMode === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          borderRadius: 8,
          colorPrimary: "#2458d3",
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        },
      }}
    >
      <AntApp>
        <ResumeWorkbench onThemeChange={setThemeMode} themeMode={themeMode} />
      </AntApp>
    </ConfigProvider>
  );
}

function ResumeWorkbench({ onThemeChange, themeMode }: { onThemeChange: (value: "light" | "dark") => void; themeMode: "light" | "dark" }) {
  const { message, modal } = AntApp.useApp();
  const [profileForm] = Form.useForm<ProfileFormValues>();
  const [streams, setStreams] = useState<UploadStreamItem[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [scores, setScores] = useState<Score[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CandidateStatus | "">("");
  const [skillFilter, setSkillFilter] = useState("");
  const [sort, setSort] = useState("created_desc");
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("profile");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [comparison, setComparison] = useState<{ candidate: Candidate; score?: Score | null }[]>([]);
  const [jobs, setJobs] = useState<JobProfile[]>(initialJobs);
  const [activeJobId, setActiveJobId] = useState(initialJobs[0].id);
  const [jobResults, setJobResults] = useState<JobScoreResult[]>([]);
  const [scoringJobIds, setScoringJobIds] = useState<string[]>([]);
  const [resumeError, setResumeError] = useState("");

  const params = useMemo(() => {
    const search = new URLSearchParams({ sort, page: String(page), page_size: String(pageSize) });
    if (query) search.set("q", query);
    if (status) search.set("status", status);
    if (skillFilter) search.set("skill", skillFilter);
    return search;
  }, [page, query, skillFilter, sort, status]);

  const activeJob = jobs.find((item) => item.id === activeJobId) || jobs[0] || initialJobs[0];
  const activeJobResult = jobResults.find((item) => item.job.id === activeJob.id);
  const latestScore = scores[0];
  const displayedScore = activeJobResult?.score || latestScore;
  const completedCount = candidates.filter((candidate) => candidate.resume_status === "completed").length;
  const scoredCount = candidates.filter((candidate) => typeof candidate.latest_score === "number").length;
  const averageScore = scoredCount ? Math.round(candidates.reduce((total, candidate) => total + (candidate.latest_score ?? 0), 0) / scoredCount) : 0;

  const refreshCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listCandidatesPage(params);
      setCandidates(result.items);
      setTotalCount(result.total);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载候选人失败");
    } finally {
      setLoading(false);
    }
  }, [message, params]);

  const mergeCandidate = useCallback((candidate: Candidate) => {
    setCandidates((prev) => {
      const exists = prev.some((item) => item.id === candidate.id);
      return exists ? prev.map((item) => (item.id === candidate.id ? candidate : item)) : [candidate, ...prev].slice(0, pageSize);
    });
    setSelected((prev) => (prev?.id === candidate.id ? candidate : prev));
    setComparison((prev) => prev.map((item) => (item.candidate.id === candidate.id ? { ...item, candidate } : item)));
  }, []);

  useEffect(() => {
    refreshCandidates();
  }, [refreshCandidates]);

  useEffect(() => {
    setPage(1);
  }, [query, skillFilter, sort, status]);

  useEffect(() => {
    if (!selected) return;
    profileForm.setFieldsValue({
      name: selected.name,
      email: selected.email || "",
      phone: selected.phone || "",
      city: selected.city || "",
      status: selected.status,
      skills: selected.skills.join(", "),
    });
  }, [profileForm, selected]);

  useEffect(() => {
    if (!drawerOpen || drawerTab !== "resume" || !selected) return;

    let cancelled = false;
    setResumeError("");
    fetch(`${API_BASE_URL}/api/resumes/${selected.id}`, { method: "HEAD" })
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
  }, [drawerOpen, drawerTab, selected]);

  async function openCandidate(id: number, tab: DrawerTab = "profile") {
    setDrawerOpen(true);
    setDrawerTab(tab);
    try {
      const candidate = await getCandidate(id);
      setSelected(candidate);
      setScores(await getScores(id));
      setJobResults([]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载候选人详情失败");
    }
  }

  function handleFiles(files: FileList | File[]) {
    const incoming = Array.from(files);
    const pdfs = incoming.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (incoming.length !== pdfs.length) {
      message.error("仅支持上传 PDF 文件，请移除非 PDF 文件后重试");
      return;
    }
    if (!pdfs.length) {
      message.error("请选择 PDF 简历文件");
      return;
    }
    setUploadOpen(true);
    uploadAndExtract(pdfs);
  }

  async function uploadAndExtract(files: File[]) {
    try {
      const uploaded = await uploadResumes(files);
      setStreams((prev) => [...uploaded.map((item) => ({ id: item.id, filename: item.filename, messages: ["上传完成，等待解析"], fields: {} })), ...prev]);
      uploaded.forEach(startExtractionStream);
      await refreshCandidates();
      message.success(`已上传 ${uploaded.length} 份简历`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "上传失败");
    }
  }

  function startExtractionStream(item: UploadResult) {
    const source = new EventSource(`${API_BASE_URL}/api/candidates/${item.id}/extract/stream`);
    const pushMessage = (nextMessage: string) => {
      setStreams((prev) => prev.map((stream) => (stream.id === item.id ? { ...stream, messages: [...stream.messages, nextMessage] } : stream)));
    };

    source.addEventListener("status", (event) => pushMessage(JSON.parse((event as MessageEvent).data).message));
    source.addEventListener("parsed", (event) => pushMessage(`PDF 文本解析完成：${JSON.parse((event as MessageEvent).data).characters} 字符`));
    source.addEventListener("field", (event) => {
      const data = JSON.parse((event as MessageEvent).data);
      setStreams((prev) => prev.map((stream) => (stream.id === item.id ? { ...stream, fields: { ...stream.fields, [data.field]: data.value } } : stream)));
    });
    source.addEventListener("done", async (event) => {
      source.close();
      const data = JSON.parse((event as MessageEvent).data) as { candidate?: Candidate };
      if (data.candidate) mergeCandidate(data.candidate);
      setStreams((prev) => prev.map((stream) => (stream.id === item.id ? { ...stream, done: true, messages: [...stream.messages, "保存完成"] } : stream)));
      await refreshCandidates();
    });
    source.addEventListener("error", (event) => {
      source.close();
      const nextMessage = event instanceof MessageEvent && event.data ? JSON.parse(event.data).message : "解析失败或连接中断";
      setStreams((prev) => prev.map((stream) => (stream.id === item.id ? { ...stream, error: nextMessage } : stream)));
      refreshCandidates();
    });
  }

  async function saveCandidateEdits() {
    if (!selected) return;
    try {
      const values = await profileForm.validateFields();
      const updated = await updateCandidate(selected.id, {
        name: values.name,
        email: values.email || null,
        phone: values.phone || null,
        city: values.city || null,
        status: values.status,
        skills: (values.skills || "").split(",").map((item) => item.trim()).filter(Boolean),
      });
      mergeCandidate(updated);
      await refreshCandidates();
      message.success("候选人资料已保存");
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    }
  }

  function confirmDelete(candidate: Candidate) {
    modal.confirm({
      title: `删除候选人「${candidate.name}」？`,
      content: "这会同时删除该候选人的评分记录和本地 PDF 文件。",
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      async onOk() {
        await deleteCandidate(candidate.id);
        const shouldMoveToPreviousPage = candidates.length === 1 && page > 1;
        setCandidates((prev) => prev.filter((item) => item.id !== candidate.id));
        setTotalCount((prev) => Math.max(0, prev - 1));
        setCompareIds((prev) => prev.filter((id) => id !== candidate.id));
        setComparison((prev) => prev.filter((item) => item.candidate.id !== candidate.id));
        setStreams((prev) => prev.filter((stream) => stream.id !== candidate.id));
        if (selected?.id === candidate.id) {
          setSelected(null);
          setScores([]);
          setJobResults([]);
          setDrawerOpen(false);
        }
        if (shouldMoveToPreviousPage) {
          setPage((value) => Math.max(1, value - 1));
        } else {
          await refreshCandidates();
        }
        message.success("候选人已删除");
      },
    });
  }

  function updateActiveJob(patch: Partial<JobPayload>) {
    setJobs((prev) => prev.map((item) => (item.id === activeJob.id ? { ...item, ...patch } : item)));
  }

  function addJob() {
    const nextIndex = jobs.length + 1;
    const nextJob: JobProfile = {
      id: `jd-${Date.now()}`,
      title: `岗位方案 ${nextIndex}`,
      description: "",
      required_skills: [],
      bonus_skills: [],
    };
    setJobs((prev) => [...prev, nextJob].slice(0, 4));
    setActiveJobId(nextJob.id);
  }

  function removeJob(jobId: string) {
    if (jobs.length === 1) return;
    const nextJobs = jobs.filter((item) => item.id !== jobId);
    setJobs(nextJobs);
    setJobResults((prev) => prev.filter((item) => item.job.id !== jobId));
    if (activeJobId === jobId) setActiveJobId(nextJobs[0].id);
  }

  async function scoreJob(jobToScore: JobProfile) {
    if (!selected) return;
    setScoringJobIds((prev) => [...new Set([...prev, jobToScore.id])]);
    try {
      const score = await createScore(selected.id, {
        title: jobToScore.title,
        description: jobToScore.description,
        required_skills: jobToScore.required_skills,
        bonus_skills: jobToScore.bonus_skills,
      });
      setScores((prev) => [score, ...prev]);
      setJobResults((prev) => [{ job: jobToScore, score }, ...prev.filter((item) => item.job.id !== jobToScore.id)]);
      mergeCandidate({ ...selected, latest_score: score.overall });
      await refreshCandidates();
      message.success("评分完成");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "评分失败");
    } finally {
      setScoringJobIds((prev) => prev.filter((id) => id !== jobToScore.id));
    }
  }

  async function runAllJobScores() {
    for (const item of jobs) {
      await scoreJob(item);
    }
  }

  async function runCompare() {
    if (compareIds.length < 2) return;
    setCompareOpen(true);
    setCompareLoading(true);
    try {
      const result = await compareCandidates(compareIds);
      setComparison(result.candidates);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "候选人对比失败");
    } finally {
      setCompareLoading(false);
    }
  }

  const columns: TableColumnsType<Candidate> = [
    {
      title: "候选人",
      dataIndex: "name",
      width: 170,
      render: (_, candidate) => (
        <Space direction="vertical" size={0}>
          <Text strong>{candidate.name}</Text>
          <Text type="secondary" ellipsis className="table-subtext">{candidate.resume_filename}</Text>
        </Space>
      ),
    },
    {
      title: "联系方式 / 城市",
      width: 170,
      render: (_, candidate) => (
        <Space direction="vertical" size={0}>
          <Text ellipsis className="contact-cell">{candidate.email || candidate.phone || "-"}</Text>
          <Text type="secondary">{candidate.city || "未填写城市"}</Text>
        </Space>
      ),
    },
    {
      title: "技能标签",
      dataIndex: "skills",
      width: 330,
      render: (skills: string[]) => (
        <Flex gap={6} wrap="wrap" className="skill-tag-list">
          {skills.slice(0, 8).map((skill) => <Tag key={skill} color="cyan">{skill}</Tag>)}
          {skills.length > 8 && <Tag>+{skills.length - 8}</Tag>}
          {!skills.length && <Text type="secondary">暂无</Text>}
        </Flex>
      ),
    },
    {
      title: "最新评分",
      dataIndex: "latest_score",
      width: 110,
      align: "center",
      render: (score?: number | null) => score ?? "-",
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 120,
      render: (value: CandidateStatus) => <StatusTag value={value} />,
    },
    {
      title: "解析状态",
      dataIndex: "resume_status",
      width: 130,
      render: (value: ResumeStatus) => <StatusTag value={value} />,
    },
    {
      title: "上传时间",
      dataIndex: "created_at",
      width: 120,
      render: (value: string) => new Date(value).toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" }),
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 190,
      render: (_, candidate) => (
        <Space onClick={(event) => event.stopPropagation()}>
          <Tooltip title="资料">
            <Button icon={<UserOutlined />} onClick={() => openCandidate(candidate.id, "profile")} />
          </Tooltip>
          <Tooltip title="简历">
            <Button icon={<FilePdfOutlined />} onClick={() => openCandidate(candidate.id, "resume")} />
          </Tooltip>
          <Tooltip title="评分">
            <Button icon={<ThunderboltOutlined />} onClick={() => openCandidate(candidate.id, "score")} />
          </Tooltip>
          <Tooltip title="删除">
            <Button danger icon={<DeleteOutlined />} onClick={() => confirmDelete(candidate)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <main className="app-shell">
      <Flex align="center" justify="space-between" gap={16} wrap="wrap" className="page-header">
        <div className="page-title-block">
          <Title level={1}>简历分析与候选人评分平台</Title>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={refreshCandidates}>刷新</Button>
          <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>上传简历</Button>
          <Button icon={themeMode === "light" ? <MoonOutlined /> : <SunOutlined />} onClick={() => onThemeChange(themeMode === "light" ? "dark" : "light")} />
        </Space>
      </Flex>

      <div className="metric-grid">
        <Card><Statistic title="候选人总数" value={totalCount} /></Card>
        <Card><Statistic title="本页解析完成" value={completedCount} /></Card>
        <Card><Statistic title="本页已评分" value={scoredCount} /></Card>
        <Card><Statistic title="本页平均分" value={averageScore || "-"} /></Card>
      </div>

      <Card className="workbench-card">
        <Flex gap={10} wrap="wrap" className="table-toolbar" style={{ marginBottom: 24, paddingBottom: 4 }}>
          <Input prefix={<SearchOutlined />} allowClear placeholder="搜索姓名、技能、学校" value={query} onChange={(event) => setQuery(event.target.value)} />
          <Input allowClear placeholder="技能筛选，如 React" value={skillFilter} onChange={(event) => setSkillFilter(event.target.value)} />
          <Select
            value={status}
            onChange={setStatus}
            options={[{ value: "", label: "全部状态" }, ...statusOptions]}
          />
          <Select
            value={sort}
            onChange={setSort}
            options={[
              { value: "created_desc", label: "上传时间" },
              { value: "score_desc", label: "评分从高到低" },
              { value: "score_asc", label: "评分从低到高" },
              { value: "name_asc", label: "姓名 A-Z" },
            ]}
          />
          <Button icon={<BarChartOutlined />} disabled={compareIds.length < 2} onClick={runCompare}>对比 {compareIds.length || ""}</Button>
        </Flex>

        <Table<Candidate>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={candidates}
          pagination={false}
          scroll={{ x: 1360 }}
          rowSelection={{
            selectedRowKeys: compareIds,
            onChange: (keys) => {
              if (keys.length > 3) {
                message.warning("最多选择 3 名候选人进行对比");
                return;
              }
              setCompareIds(keys.map(Number));
            },
          }}
          onRow={(candidate) => ({
            onClick: () => openCandidate(candidate.id, "profile"),
          })}
          locale={{ emptyText: <Empty description="暂无候选人，请先上传 PDF 简历" /> }}
        />

        <Flex align="center" justify="flex-end" gap={10} className="table-footer">
          <Text type="secondary">共 {totalCount} 条</Text>
          <Button disabled={page === 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</Button>
          <Text type="secondary">第 {page} 页</Text>
          <Button disabled={loading || page * pageSize >= totalCount} onClick={() => setPage((value) => value + 1)}>下一页</Button>
        </Flex>
      </Card>

      <UploadModal open={uploadOpen} streams={streams} onClose={() => setUploadOpen(false)} onFiles={handleFiles} />

      <CandidateDrawer
        activeJob={activeJob}
        activeJobId={activeJobId}
        candidate={selected}
        displayedScore={displayedScore}
        drawerTab={drawerTab}
        form={profileForm}
        jobResults={jobResults}
        jobs={jobs}
        onActiveJobChange={setActiveJobId}
        onAddJob={addJob}
        onClose={() => setDrawerOpen(false)}
        onDrawerTabChange={setDrawerTab}
        onRemoveJob={removeJob}
        onRunAllScores={runAllJobScores}
        onRunScore={() => scoreJob(activeJob)}
        onSave={saveCandidateEdits}
        onUpdateActiveJob={updateActiveJob}
        open={drawerOpen}
        resumeError={resumeError}
        scoringJobIds={scoringJobIds}
      />

      <CompareDrawer comparison={comparison} loading={compareLoading} open={compareOpen} selectedCount={compareIds.length} onClose={() => setCompareOpen(false)} />
    </main>
  );
}

function UploadModal({ onClose, onFiles, open, streams }: { onClose: () => void; onFiles: (files: File[]) => void; open: boolean; streams: UploadStreamItem[] }) {
  return (
    <Modal title="上传并解析 PDF 简历" open={open} onCancel={onClose} footer={<Button onClick={onClose}>关闭</Button>} width={760}>
      <Dragger
        accept="application/pdf"
        multiple
        showUploadList={false}
        beforeUpload={(file, fileList) => {
          if (file.uid === fileList[fileList.length - 1]?.uid) onFiles(fileList);
          return Upload.LIST_IGNORE;
        }}
      >
        <p className="ant-upload-drag-icon"><UploadOutlined /></p>
        <p className="ant-upload-text">拖拽 PDF 到这里，或点击选择文件</p>
        <p className="ant-upload-hint">支持批量上传，上传后会在下方显示解析进度。</p>
      </Dragger>

      <div className="upload-stream-list">
        {streams.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="上传后会显示 SSE 解析进度" />
        ) : (
          streams.map((stream) => (
            <Card size="small" key={stream.id} title={stream.filename} extra={stream.done ? <Tag color="green">已完成</Tag> : stream.error ? <Tag color="red">失败</Tag> : <Tag color="blue">处理中</Tag>}>
              {!stream.done && !stream.error && <Progress percent={70} status="active" showInfo={false} />}
              <List size="small" dataSource={stream.messages} renderItem={(item) => <List.Item>{item}</List.Item>} />
              {Object.entries(stream.fields).map(([field, value]) => (
                <Text code key={field} className="stream-field">{field}: {JSON.stringify(value).slice(0, 160)}</Text>
              ))}
              {stream.error && <Alert type="error" message={stream.error} showIcon />}
            </Card>
          ))
        )}
      </div>
    </Modal>
  );
}

function CandidateDrawer({
  activeJob,
  activeJobId,
  candidate,
  displayedScore,
  drawerTab,
  form,
  jobResults,
  jobs,
  onActiveJobChange,
  onAddJob,
  onClose,
  onDrawerTabChange,
  onRemoveJob,
  onRunAllScores,
  onRunScore,
  onSave,
  onUpdateActiveJob,
  open,
  resumeError,
  scoringJobIds,
}: {
  activeJob: JobProfile;
  activeJobId: string;
  candidate: Candidate | null;
  displayedScore?: Score | null;
  drawerTab: DrawerTab;
  form: ReturnType<typeof Form.useForm<ProfileFormValues>>[0];
  jobResults: JobScoreResult[];
  jobs: JobProfile[];
  onActiveJobChange: (id: string) => void;
  onAddJob: () => void;
  onClose: () => void;
  onDrawerTabChange: (tab: DrawerTab) => void;
  onRemoveJob: (id: string) => void;
  onRunAllScores: () => void;
  onRunScore: () => void;
  onSave: () => void;
  onUpdateActiveJob: (patch: Partial<JobPayload>) => void;
  open: boolean;
  resumeError: string;
  scoringJobIds: string[];
}) {
  return (
    <Drawer
      title={candidate ? candidate.name : "候选人详情"}
      open={open}
      onClose={onClose}
      size={860}
      footer={(
        <Flex justify="flex-end" gap={8}>
          <Button onClick={onClose}>关闭</Button>
          {drawerTab === "profile" && <Button type="primary" onClick={onSave}>保存修正</Button>}
        </Flex>
      )}
    >
      {!candidate ? (
        <Spin />
      ) : (
        <Tabs
          activeKey={drawerTab}
          onChange={(key) => onDrawerTabChange(key as DrawerTab)}
          items={[
            {
              key: "profile",
              label: "基本资料",
              children: <ProfileTab candidate={candidate} form={form} />,
            },
            {
              key: "resume",
              label: "简历预览",
              children: <ResumeTab candidate={candidate} resumeError={resumeError} />,
            },
            {
              key: "ai",
              label: "AI 提取结果",
              children: <AiTab candidate={candidate} />,
            },
            {
              key: "score",
              label: "JD 评分",
              children: (
                <ScoreTab
                  activeJob={activeJob}
                  activeJobId={activeJobId}
                  displayedScore={displayedScore}
                  jobResults={jobResults}
                  jobs={jobs}
                  onActiveJobChange={onActiveJobChange}
                  onAddJob={onAddJob}
                  onRemoveJob={onRemoveJob}
                  onRunAllScores={onRunAllScores}
                  onRunScore={onRunScore}
                  onUpdateActiveJob={onUpdateActiveJob}
                  scoringJobIds={scoringJobIds}
                />
              ),
            },
          ]}
        />
      )}
    </Drawer>
  );
}

function ProfileTab({ candidate, form }: { candidate: Candidate; form: ReturnType<typeof Form.useForm<ProfileFormValues>>[0] }) {
  return (
    <Space direction="vertical" size={16} className="drawer-panel">
      <Descriptions bordered size="small" column={3}>
        <Descriptions.Item label="技能标签">{candidate.skills.length}</Descriptions.Item>
        <Descriptions.Item label="候选人状态"><StatusTag value={candidate.status} /></Descriptions.Item>
        <Descriptions.Item label="解析状态"><StatusTag value={candidate.resume_status} /></Descriptions.Item>
      </Descriptions>

      <Form form={form} layout="vertical" className="profile-form">
        <Form.Item name="name" label="姓名" rules={[{ required: true, message: "请输入姓名" }]}>
          <Input />
        </Form.Item>
        <Form.Item name="email" label="邮箱">
          <Input />
        </Form.Item>
        <Form.Item name="phone" label="电话">
          <Input />
        </Form.Item>
        <Form.Item name="city" label="城市">
          <Input />
        </Form.Item>
        <Form.Item name="status" label="状态">
          <Select options={statusOptions} />
        </Form.Item>
        <Form.Item name="skills" label="技能">
          <Input placeholder="用英文逗号分隔，如 React, TypeScript, Python" />
        </Form.Item>
      </Form>
    </Space>
  );
}

function ResumeTab({ candidate, resumeError }: { candidate: Candidate; resumeError: string }) {
  return (
    <Space direction="vertical" size={12} className="drawer-panel">
      <Flex justify="space-between" align="center" gap={12}>
        <Text ellipsis>{candidate.resume_filename}</Text>
        <Button href={`${API_BASE_URL}/api/resumes/${candidate.id}`} target="_blank" icon={<FilePdfOutlined />}>新窗口打开</Button>
      </Flex>
      {resumeError ? <Alert type="warning" showIcon message={resumeError} /> : <iframe className="resume-frame" title="PDF preview" src={`${API_BASE_URL}/api/resumes/${candidate.id}`} />}
    </Space>
  );
}

function AiTab({ candidate }: { candidate: Candidate }) {
  return (
    <Space direction="vertical" size={16} className="drawer-panel">
      <Card size="small" title="技能标签">
        <Flex gap={6} wrap="wrap">
          {candidate.skills.length ? candidate.skills.map((skill) => <Tag key={skill} color="cyan">{skill}</Tag>) : <Text type="secondary">暂无技能标签</Text>}
        </Flex>
      </Card>
      <Card size="small" title="教育背景"><FieldList emptyText="暂无教育背景" items={candidate.education} /></Card>
      <Card size="small" title="工作经历"><FieldList emptyText="暂无工作经历" items={candidate.work_experience} /></Card>
      <Card size="small" title="项目经历"><FieldList emptyText="暂无项目经历" items={candidate.projects} /></Card>
      <Card size="small" title="清洗后的简历文本">
        <pre className="cleaned-text">{candidate.cleaned_text || "暂无文本"}</pre>
      </Card>
    </Space>
  );
}

function ScoreTab({
  activeJob,
  activeJobId,
  displayedScore,
  jobResults,
  jobs,
  onActiveJobChange,
  onAddJob,
  onRemoveJob,
  onRunAllScores,
  onRunScore,
  onUpdateActiveJob,
  scoringJobIds,
}: {
  activeJob: JobProfile;
  activeJobId: string;
  displayedScore?: Score | null;
  jobResults: JobScoreResult[];
  jobs: JobProfile[];
  onActiveJobChange: (id: string) => void;
  onAddJob: () => void;
  onRemoveJob: (id: string) => void;
  onRunAllScores: () => void;
  onRunScore: () => void;
  onUpdateActiveJob: (patch: Partial<JobPayload>) => void;
  scoringJobIds: string[];
}) {
  return (
    <Space direction="vertical" size={16} className="drawer-panel">
      <Flex gap={8} wrap="wrap" align="center">
        <Segmented
          value={activeJobId}
          onChange={(value) => onActiveJobChange(String(value))}
          options={jobs.map((job, index) => ({ label: job.title || `JD ${index + 1}`, value: job.id }))}
        />
        <Button disabled={jobs.length >= 4} icon={<PlusOutlined />} onClick={onAddJob}>新增 JD</Button>
        <Button danger disabled={jobs.length === 1} icon={<DeleteOutlined />} onClick={() => onRemoveJob(activeJob.id)}>删除当前 JD</Button>
      </Flex>

      <div className="jd-editor-grid">
        <Input value={activeJob.title} onChange={(event: ChangeEvent<HTMLInputElement>) => onUpdateActiveJob({ title: event.target.value })} placeholder="岗位名称" />
        <Input value={activeJob.required_skills.join(", ")} onChange={(event: ChangeEvent<HTMLInputElement>) => onUpdateActiveJob({ required_skills: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="必备技能" />
        <Input value={activeJob.bonus_skills.join(", ")} onChange={(event: ChangeEvent<HTMLInputElement>) => onUpdateActiveJob({ bonus_skills: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="加分技能" />
        <Input.TextArea value={activeJob.description} onChange={(event) => onUpdateActiveJob({ description: event.target.value })} placeholder="岗位描述" />
      </div>

      <Space wrap>
        <Button type="primary" icon={<ThunderboltOutlined />} loading={scoringJobIds.includes(activeJob.id)} onClick={onRunScore}>
          {displayedScore ? "重新评分" : "开始评分"}
        </Button>
        <Button disabled={scoringJobIds.length > 0} onClick={onRunAllScores}>对比全部 JD</Button>
      </Space>

      {displayedScore ? (
        <>
          <div className="score-dimensions">
            {compareDimensions.map((dimension) => (
              <Card size="small" key={dimension.key}>
                <Statistic title={dimension.label} value={displayedScore[dimension.key]} />
                <Progress percent={displayedScore[dimension.key]} showInfo={false} />
              </Card>
            ))}
          </div>
          <ScoreChart score={displayedScore} />
          <Alert type="info" showIcon message={displayedScore.summary} />
        </>
      ) : (
        <Empty description="还没有生成岗位匹配评分" />
      )}

      {jobResults.length > 0 && (
        <div className="job-result-grid">
          {jobResults.map((item) => (
            <Card size="small" hoverable key={item.job.id} onClick={() => onActiveJobChange(item.job.id)}>
              <Text type="secondary">{item.job.title}</Text>
              <Statistic value={item.score.overall} />
              <Text type="secondary">技能 {item.score.skill_match} / 经验 {item.score.experience_relevance} / 教育 {item.score.education_fit}</Text>
            </Card>
          ))}
        </div>
      )}
    </Space>
  );
}

function CompareSkeletonCards({ count }: { count: number }) {
  return (
    <div className="compare-grid compare-grid-stable">
      {Array.from({ length: Math.max(2, count) }).map((_, index) => (
        <Card className="compare-skeleton-card" key={index}>
          <Skeleton active avatar paragraph={{ rows: 1 }} title={{ width: "54%" }} />
          <Skeleton.Button active block size="large" />
          <Skeleton active paragraph={{ rows: 5 }} title={false} />
          <Skeleton active paragraph={{ rows: 2 }} title={false} />
        </Card>
      ))}
    </div>
  );
}

function CompareDrawer({
  comparison,
  loading,
  onClose,
  open,
  selectedCount,
}: {
  comparison: { candidate: Candidate; score?: Score | null }[];
  loading: boolean;
  onClose: () => void;
  open: boolean;
  selectedCount: number;
}) {
  return (
    <Drawer
      className="compare-drawer"
      title="候选人对比"
      open={open}
      onClose={onClose}
      width="min(1080px, 100vw)"
      footer={(
        <Flex justify="flex-end">
          <Button onClick={onClose}>关闭</Button>
        </Flex>
      )}
    >
      <div className="compare-drawer-shell">
        <Flex align="center" justify="space-between" className="compare-drawer-status">
          <Text type="secondary">{loading ? "正在生成候选人对比" : `已选择 ${comparison.length || selectedCount} 名候选人`}</Text>
          {loading && <Tag color="blue">分析中</Tag>}
        </Flex>
      {loading ? (
        <CompareSkeletonCards count={selectedCount} />
      ) : comparison.length ? (
        <div className="compare-grid compare-grid-stable">
          {comparison.map(({ candidate, score }) => (
            <Card key={candidate.id} title={candidate.name} extra={<StatusTag value={candidate.status} />}>
              <Statistic title="综合匹配" value={score?.overall ?? candidate.latest_score ?? "-"} />
              {score ? (
                <Space direction="vertical" size={10} className="drawer-panel">
                  {compareDimensions.map((dimension) => (
                    <div key={dimension.key}>
                      <Flex justify="space-between"><Text>{dimension.label}</Text><Text strong>{score[dimension.key]}</Text></Flex>
                      <Progress percent={score[dimension.key]} showInfo={false} />
                    </div>
                  ))}
                  <Text>{score.summary}</Text>
                  <Descriptions size="small" column={1}>
                    <Descriptions.Item label="优势">{score.strengths.slice(0, 3).join(", ") || "暂无明确优势"}</Descriptions.Item>
                    <Descriptions.Item label="风险">{score.gaps.slice(0, 3).join(", ") || "暂无明显缺口"}</Descriptions.Item>
                  </Descriptions>
                </Space>
              ) : (
                <Alert type="warning" showIcon message="暂无评分。请先选择候选人并完成 JD 匹配评分。" />
              )}
              <Flex gap={6} wrap="wrap" className="compare-tags">
                {candidate.skills.slice(0, 8).map((skill) => <Tag color="cyan" key={skill}>{skill}</Tag>)}
              </Flex>
            </Card>
          ))}
        </div>
      ) : (
        <div className="compare-empty-state">
          <Empty description="请选择 2-3 名候选人进行对比" />
        </div>
      )}
      </div>
    </Drawer>
  );
}
