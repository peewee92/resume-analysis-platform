# Resume Analysis Platform

AI 简历分析平台，支持批量上传 PDF 简历、解析文本、AI 结构化提取、JD 匹配评分、候选人管理、图表可视化和候选人对比。

## 架构

- `apps/web`：Next.js + React + TypeScript 前端。
- `apps/api`：FastAPI 后端，提供 RESTful API、PDF 解析、SSE 流式事件和 AI 评分。
- 默认本地数据库为 SQLite，生产环境可通过 `DATABASE_URL` 切换到 Supabase PostgreSQL。
- 默认本地文件存储在 `apps/api/uploads`，生产环境可通过 `STORAGE_BACKEND=supabase` 切换到 Supabase Storage。

## 技术选型

- Next.js 适合快速交付可部署的 React 应用，并提供良好的 TypeScript 工程体验。
- FastAPI 适合 Python PDF 处理、AI 调用和 SSE 流式接口。
- SQLModel 兼具 Pydantic 类型和 SQLAlchemy 能力，便于面试项目快速建模。
- OpenAI API 用于结构化简历信息提取和岗位匹配评分；未配置 Key 时提供规则兜底，方便演示。
- Recharts 用于雷达图、柱状图和评分可视化。

## 本地启动完整流程

### 1. 准备环境

需要本机安装：

- Node.js 18 或更高版本。
- Python 3.11 或更高版本。

首次启动前执行：

```bash
cp .env.example .env
npm install
python3 -m venv .venv
source .venv/bin/activate
pip install -r apps/api/requirements.txt
```

如需真实 AI 能力，在 `.env` 中设置：

```bash
OPENAI_API_KEY=你的 key
OPENAI_MODEL=gpt-4o-mini
```

不配置 `OPENAI_API_KEY` 也可以跑通项目，系统会使用规则兜底完成简历信息提取和评分演示。

### 2. 一键启动前后端

在项目根目录执行：

```bash
npm run dev
```

启动后访问：

- 前端页面：`http://localhost:3000`
- 后端 API：`http://localhost:8000`
- 后端健康检查：`http://localhost:8000/api/health`

### 3. 分别启动前端和后端

如果你想分两个终端启动，按下面流程执行。

终端一，启动后端：

```bash
source .venv/bin/activate
cd apps/api
uvicorn app.main:app --reload --port 8000
```

如果你需要重启后端，先确认 8000 端口是否已有服务：

```bash
curl http://localhost:8000/api/health
```

如果返回 `{"status":"ok"}`，说明后端已经在运行。要重启它，优先回到正在运行 `uvicorn` 的终端，按 `Ctrl + C` 停止，然后重新执行：

```bash
uvicorn app.main:app --reload --port 8000
```

如果找不到原来的终端，或者启动时报 `Address already in use`，说明 8000 端口被旧进程占用。可以在项目根目录执行：

```bash
lsof -ti tcp:8000
```

如果输出了进程号，例如 `12345`，停止它：

```bash
kill 12345
```

也可以一行完成：

```bash
lsof -ti tcp:8000 | xargs kill
```

然后重新启动后端：

```bash
source .venv/bin/activate
cd apps/api
uvicorn app.main:app --reload --port 8000
```

终端二，启动前端：

```bash
npm --workspace apps/web run dev
```

前端会读取 `.env` 中的 `NEXT_PUBLIC_API_BASE_URL`，默认请求 `http://localhost:8000`。

### 4. 本地验证

```bash
npm run test
npm run lint
npm --workspace apps/web run build
```

### 5. 常见启动问题

如果页面上显示“无法连接后端服务”或浏览器控制台出现：

```text
GET http://localhost:8000/api/candidates?... net::ERR_CONNECTION_REFUSED
Failed to fetch
```

说明前端已经启动，但后端 FastAPI 没有在 `8000` 端口运行，或 `.env` 中的 `NEXT_PUBLIC_API_BASE_URL` 配错了。按下面顺序检查：

```bash
curl http://localhost:8000/api/health
```

如果没有返回 `{"status":"ok"}`，重新启动后端：

```bash
source .venv/bin/activate
cd apps/api
uvicorn app.main:app --reload --port 8000
```

如果启动时报：

```text
ERROR: [Errno 48] Address already in use
```

说明 `8000` 端口已有后端进程在运行。先停止旧进程：

```bash
lsof -ti tcp:8000 | xargs kill
```

再重新执行后端启动命令。

如果你改过端口，例如后端跑在 `8001`，需要同步修改 `.env`：

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8001
API_BASE_URL=http://localhost:8001
```

然后重启前端。

如果控制台出现：

```text
blocked by CORS policy
No 'Access-Control-Allow-Origin' header is present
```

通常是你打开了 Next.js 提示的局域网地址，例如 `http://192.168.0.101:3000`，但后端只允许了 `localhost`。项目默认已允许常见本机和局域网开发地址。如果你使用了其他前端地址，可以在 `.env` 中补充：

```bash
WEB_ORIGIN=http://localhost:3000
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://你的局域网IP:3000
```

修改后需要重启后端。

如果后端启动时报：

```text
sqlite3.OperationalError: unable to open database file
```

通常是 `DATABASE_URL` 指向了不存在的 SQLite 目录。项目已自动把 `.env` 中的 `sqlite:///apps/api/resume_analysis.db` 按项目根目录转成绝对路径。若你手动修改数据库地址，推荐使用绝对路径，例如：

```bash
DATABASE_URL=sqlite:////Users/你的用户名/Documents/New project/apps/api/resume_analysis.db
```

如果点击评分或“对比全部 JD”时后端出现：

```text
sqlite3.OperationalError: attempt to write a readonly database
```

说明 SQLite 数据库文件或 `apps/api` 目录当前不可写。先停止后端服务，然后执行：

```bash
chmod u+w apps/api apps/api/resume_analysis.db 2>/dev/null || true
```

再重新启动后端。项目启动时也会自动检查本地 SQLite 可写性，并尽量修复当前用户缺失的写权限。

如果候选人详情里的“简历预览”提示 PDF 文件不存在，通常是数据库里还有候选人记录，但本地 `apps/api/uploads` 下已经找不到原始 PDF。后端会先按数据库保存路径、上传目录里的存储文件名、原始文件名和 `UUID_原始文件名` 自动恢复路径；只有这些位置都找不到时，才需要重新上传该候选人的 PDF。

如果控制台出现 hydration mismatch，并且提示 `<html>` 多了类似 `className="trancy-zh-CN"` 的属性，通常是浏览器翻译/划词/安全类扩展在 React 加载前修改了页面。这不是项目功能错误。可以用无痕窗口、禁用相关扩展，或忽略这个开发环境提示。

## 主要功能

- PDF 简历拖拽上传和点击上传，支持批量文件。
- 后端解析多页 PDF，清洗文本并保存原文。
- SSE 实时返回解析和 AI 提取进度。
- 提取姓名、电话、邮箱、城市、教育、工作经历、技能、项目经历。
- 候选人列表支持表格 / 卡片视图、搜索、状态筛选、排序。
- 候选人详情支持 PDF 预览、状态流转、手动修正 AI 信息。
- JD 编辑器支持必备技能和加分技能。
- AI 或规则兜底评分输出综合分、技能分、经验分、教育分和评语。
- 雷达图、柱状图、环形评分展示。
- 支持 2-3 名候选人对比。
- 支持暗色 / 亮色主题、Skeleton 加载态和响应式布局。

## API 概览

- `POST /api/resumes/upload`：批量上传 PDF。
- `GET /api/resumes/{id}`：获取原始 PDF。
- `GET /api/candidates`：候选人列表，支持搜索、筛选、排序、分页。
- `GET /api/candidates/{id}`：候选人详情。
- `PATCH /api/candidates/{id}`：修正候选人信息或状态。
- `DELETE /api/candidates/{id}`：删除候选人，并清理对应评分记录和本地 PDF。
- `GET /api/candidates/{id}/extract/stream`：SSE 返回解析进度。
- `POST /api/jobs`：创建 JD。
- `POST /api/scores`：生成 JD 匹配评分。
- `GET /api/scores/{candidateId}`：获取评分结果。
- `POST /api/compare`：候选人对比。

## 常用命令

```bash
npm run dev                         # 同时启动前端和后端
npm run dev:web                     # 只启动前端
npm run dev:api                     # 只启动后端
npm run test                        # 后端测试
npm run lint                        # 前端 lint
npm --workspace apps/web run build  # 前端生产构建
```

## 测试用例文档

完整测试用例见 [docs/TEST_CASES.md](docs/TEST_CASES.md)，覆盖上传解析、AI 提取、JD 评分、候选人管理、前端工程质量和 API 验证。

当前实现的测试分析结果见 [docs/TEST_REPORT.md](docs/TEST_REPORT.md)。

## 部署

推荐方案是 Vercel 托管前端，Render 托管 FastAPI 后端，Supabase 托管 PostgreSQL 和 PDF 文件。Supabase 不直接托管当前 Python FastAPI 服务，它负责数据库和文件存储。

### 1. Supabase 准备

在 Supabase 项目 `rtiwncdpulgckgptymof` 中准备：

- Project URL：`https://rtiwncdpulgckgptymof.supabase.co`
- `service_role` key：只放在后端环境变量中，不要放到 Vercel 前端。
- Database Session Pooler 连接串，推荐使用 `postgresql+psycopg://` 驱动格式：

```bash
DATABASE_URL=postgresql+psycopg://postgres.rtiwncdpulgckgptymof:<DB_PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres?sslmode=require
```

在 Storage 中创建私有 bucket：

```text
resumes
```

推荐只允许 `application/pdf` 类型。项目会把 PDF 存成 `resumes/{uuid}_原始文件名`，并由 FastAPI 代理预览，不公开暴露简历文件地址。

### 2. Render 部署后端

创建 Render Web Service：

- Root Directory：`apps/api`
- Build Command：`pip install -r requirements.txt`
- Start Command：

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Render 后端环境变量：

```bash
DATABASE_URL=postgresql+psycopg://postgres.rtiwncdpulgckgptymof:<DB_PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres?sslmode=require
STORAGE_BACKEND=supabase
SUPABASE_URL=https://rtiwncdpulgckgptymof.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<你的 service_role key>
SUPABASE_STORAGE_BUCKET=resumes
WEB_ORIGIN=https://你的前端域名
CORS_ORIGINS=https://你的前端域名
OPENAI_API_KEY=<可选>
OPENAI_MODEL=gpt-4o-mini
```

部署后访问：

```text
https://你的-render-service.onrender.com/api/health
```

返回 `{"status":"ok"}` 说明后端已启动。首次启动会自动创建数据库表。

### 3. Vercel 部署前端

创建 Vercel Project：

- Root Directory：`apps/web`
- Framework Preset：Next.js
- Environment Variable：

```bash
NEXT_PUBLIC_API_BASE_URL=https://你的-render-service.onrender.com
```

Vercel 域名确定后，回到 Render，把 `WEB_ORIGIN` 和 `CORS_ORIGINS` 更新为最终 Vercel 域名，然后重新部署或重启后端。

### 4. 部署验收

按顺序检查：

```text
1. 打开 Vercel 页面，候选人列表可正常加载。
2. 上传 PDF 后候选人出现在列表中。
3. 点击候选人详情，可以预览 PDF。
4. 触发 AI 解析或评分流程可正常完成。
5. 重启 Render 后端后，刚才上传的 PDF 仍可预览。
```

如果第五步正常，说明 PDF 来自 Supabase Storage，不依赖 Render 本地磁盘。

## 关键决策

- 先保证无 OpenAI Key 也能完整演示，因此实现规则兜底提取和评分。
- AI 结果保存后允许前端手动修正，避免模型输出不稳定影响候选人管理流程。
- 使用 SSE 而不是轮询，让上传后的解析进度更直观。
- 候选人列表和详情放在同一工作台中，减少页面跳转，便于面试官快速验证核心能力。
