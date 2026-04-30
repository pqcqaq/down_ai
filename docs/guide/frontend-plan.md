# 前端计划

## 目标

前端要做成一个本地论文修订工作台，而不是简单表单。用户应该能完整完成：

1. 选择 LaTeX 项目目录。
2. 选择或上传报告 PDF。
3. 配置修订策略。
4. 查看 Agent 任务进度。
5. 逐条审核命中段落。
6. 对比原文和修订。
7. 应用或回滚修改。
8. 查看和导出统计报告。

## 页面结构

### 1. 项目入口页

内容：

- 当前服务状态。
- 最近任务列表。
- 新建任务按钮。
- 快速入口：打开报告、打开项目、查看历史。

### 2. 项目选择页

能力：

- 输入本地 LaTeX 项目路径。
- 可选使用浏览器 File System Access API 选择目录。
- 显示后端审计结果：
  - `.tex` 文件数量。
  - 主文件候选。
  - `.bib` 文件。
  - 图片目录。
  - 编译配置。

风险：

- 普通网页不能任意读取本地目录。第一版可以让用户输入路径，由本地后端读取；部署到远程服务器时必须禁用本地路径模式。
- 当前实现已补充后端目录浏览接口 `GET /api/workspaces/browse`，前端可以在 `WORKSPACE_ROOT` 内直接浏览并选择目录，不再依赖用户手工复制完整路径。

### 3. 报告选择页

能力：

- 上传 PDF。
- 显示 PDF 页数、文本是否可解析、命中数量。
- 无法解析时提示手动粘贴报告文本。
- 支持后续扩展 OCR。

当前实现上传后会立即调用报告解析接口，并在输入栏展示报告文件名和 finding 数量。

### 4. 配置页

配置项：

- 修订范围：报告命中段落、指定文件、全文扫描。
- 修订语言：中文、英文、自动。
- 修订强度：轻度、中度、保守重写。
- 自动应用：关闭、低风险自动应用、全部需确认。
- 编译验证：不编译、自动检测命令、手动填写命令。
- 输出报告格式：Markdown、HTML、JSON。

### 5. 任务进度页

展示：

- 当前阶段。
- 子步骤列表。
- Agent 工具调用日志。
- stdout/stderr 折叠查看。
- 错误和重试按钮。
- 暂停、取消、继续。

进度事件通过 SSE 或 WebSocket 推送。

进度数据来源：

- 页面加载时读取 `GET /api/tasks/:taskId` 和 `GET /api/tasks/:taskId/steps`。
- 实时更新订阅 `GET /api/events/tasks/:taskId`。
- 断线重连后调用 `GET /api/tasks/:taskId/events?after=<lastSequence>` 补齐事件。
- 所有展示状态以数据库为准，SSE 事件只作为实时增量。

### 6. 命中列表页

表格列：

- 状态。
- 文件。
- 行号。
- 章节。
- 风险类型。
- 严重程度。
- 匹配置信度。
- 是否需要人工确认。
- protected token 状态。

筛选：

- 文件。
- 章节。
- 严重程度。
- 状态。
- 是否已应用。

### 7. Diff 审核页

布局：

```text
左侧：原始 LaTeX segment
右侧：修订 LaTeX segment
底部：问题原因、修改说明、风险标记、操作按钮
```

操作：

- 接受。
- 拒绝。
- 手动编辑。
- 重新生成。
- 标记为不处理。
- 批量确认无风险修订。
- 批量确认全部修订。
- 应用已确认修订。
- 按 apply journal 回滚。

编辑器：

- 第一版使用 textarea。
- 第二版引入 Monaco Editor 或 CodeMirror。
- 第三版提供 LaTeX 语法高亮和 protected token 高亮。

### 8. 报告页

展示：

- 总览指标。
- 问题类型分布。
- 文件分布。
- 风险项列表。
- 编译和校验结果。
- 下载按钮。

## 组件划分

```text
src/pages
  ├─ DashboardPage.tsx
  ├─ NewTaskPage.tsx
  ├─ TaskProgressPage.tsx
  ├─ FindingsPage.tsx
  ├─ DiffReviewPage.tsx
  └─ ReportPage.tsx

src/components
  ├─ ProjectPicker.tsx
  ├─ PdfUploader.tsx
  ├─ TaskTimeline.tsx
  ├─ FindingTable.tsx
  ├─ SegmentDiff.tsx
  ├─ RiskBadge.tsx
  ├─ AgentLogPanel.tsx
  └─ ReportSummary.tsx
```

## 状态管理

- 使用 TanStack Query 管理 API 请求。
- 使用 URL 参数保存当前任务和筛选条件。
- 长任务状态通过 SSE 或 WebSocket 更新。
- 人工审核状态本地即时更新，后端确认后落盘。
- 任务、步骤、事件、revision 状态都从数据库 API 读取，不从前端本地推断最终状态。

## 交互重点

- 不隐藏自动修改行为。
- 每条改写都能看到原文、原因和结果。
- 默认不自动覆盖用户文件。
- 高风险项必须人工确认。
- 所有错误都能展开看到命令和日志。

当前工作台已经形成单屏主流程：项目路径、报告上传、dry-run 启动、步骤进度、修订列表、批量确认、写回和回滚都可在前端直接操作。目录浏览、历史任务、任务设置、事件日志和修订 diff 编辑属于次级能力，必须放在 modal 中，避免主页面拥挤。

## 前端开发顺序

1. 搭 Vite + React 项目。
2. 做项目选择和 PDF 上传。
3. 做任务进度页。
4. 做命中列表。
5. 做 diff 审核。
6. 做报告页。
7. 增加 SSE/WebSocket。
8. 增加 Monaco/CodeMirror。
