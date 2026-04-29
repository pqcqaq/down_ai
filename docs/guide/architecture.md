# Agent 架构

## 总体架构

```text
Frontend Workbench
  ├─ project selector
  ├─ report uploader
  ├─ progress console
  ├─ diff review
  └─ report viewer

Express API
  ├─ task controller
  ├─ workspace controller
  ├─ report controller
  ├─ progress controller
  └─ revision controller

Agent Orchestrator
  ├─ project audit agent
  ├─ report parse agent
  ├─ segment match agent
  ├─ style diagnosis agent
  ├─ revision agent
  ├─ validation agent
  └─ report agent

Tool Runtime
  ├─ BypassAIGC-Skill scripts
  ├─ file parser adapters
  ├─ PDF parser / OCR
  ├─ LaTeX / BibTeX parser
  ├─ fuzzy matcher
  ├─ git adapter
  ├─ LaTeX compiler adapter
  └─ file system adapter

Storage
  ├─ SQLite database
  ├─ artifact files
  ├─ generated reports
  └─ project backups
```

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vite、React、TypeScript、TanStack Query、Monaco Editor 或 CodeMirror |
| 后端 | Express、TypeScript、Zod、multer 或 busboy、pino |
| Agent | LangChain.js tools、Zod schema、structured output；复杂编排可升级 LangGraph |
| 模型 | DeepSeek 官方 OpenAI 兼容 API；通过自定义 DeepSeek ChatModel adapter 接入 |
| 文件解析 | `pdfjs-dist`、`pdf-parse`、`unified-latex`、`bibtex-parse-js`、`mammoth`、`remark`、`tesseract.js` 或系统 OCR |
| 差异展示 | `diff`、`diff2html` 或 Monaco diff |
| 数据库 | SQLite + Drizzle ORM，后续预留 PostgreSQL 适配 |
| 任务进度 | `tasks` 快照表 + `task_steps` 步骤表 + `task_events` 追加事件表 |
| 报告 | Markdown、HTML、JSON，可选 PDF 导出 |

## 数据持久化策略

任务状态不使用临时内存或单纯 JSON 文件保存。MVP 就接入数据库：

- `tasks` 保存任务当前状态和配置摘要。
- `task_steps` 保存每个阶段的状态、进度、错误和耗时。
- `task_events` 作为追加日志，记录每一次状态变化，供 SSE、恢复和审计使用。
- `tool_runs` 记录 Python 脚本、PDF 解析、LaTeX 编译等工具调用。
- `agent_runs` 记录模型调用的安全摘要、token 用量、结构化输出状态。
- `artifacts` 记录大文件产物路径和 hash，大文件本体仍在 `.down-ai/tasks/<taskId>/`。

所有状态切换必须在一个数据库事务中完成：更新任务快照、更新步骤、插入事件。这样前端刷新、服务重启或任务失败后，都可以从数据库恢复进度。

## 文件解析层

文件解析能力作为独立层，不写进 Agent prompt：

```text
File Parser Registry
  ├─ PdfTextParser
  ├─ PdfOcrParser
  ├─ LatexProjectParser
  ├─ BibtexParser
  ├─ MarkdownParser
  ├─ DocxParser
  ├─ ArchiveParser
  └─ LatexLogParser
```

每个 parser 都遵循统一接口：

```ts
type FileParser<TOptions = unknown> = {
  name: string;
  supports(input: ParserInput): Promise<boolean>;
  parse(input: ParserInput, options?: TOptions): Promise<ParsedDocument>;
};
```

设计要求：

- 优先使用成熟依赖，避免手写复杂格式解析。
- parser 只负责抽取结构化信息，不做改写决策。
- 原文件 hash、解析版本、依赖版本写入数据库，保证报告可复现。
- parser 失败时保留 warning，尽量降级到人工输入或纯文本模式。

## 可实施架构结论

最终实施时采用“确定性编排器 + 受控模型调用”的架构：

- 后端 `TaskOrchestrator` 决定步骤顺序、工具调用和文件写入。
- LangChain 主要用于工具 schema、结构化输出、可选 Agent 子流程和 trace。
- 模型只生成 `RevisionDecision` 这类结构化建议，不直接执行文件系统写操作。
- 写文件、回滚、编译、报告生成都由后端服务和 SkillRuntime 工具执行。

不建议第一版让 LLM 自主决定何时调用写文件工具。论文项目的风险点集中在文件覆盖、引用漂移和 claim drift，确定性编排更容易验证和恢复。

## Agent 分层

### 主控 Agent

职责：

- 理解任务配置。
- 选择工作流。
- 调用工具。
- 汇总状态。
- 发现风险时暂停并要求人工确认。

### 工具 Agent

工具 Agent 不自由发挥，只执行封装工具：

- 项目审计。
- PDF 解析。
- segment 匹配。
- lint。
- 应用 patch。
- 编译。

### 修订 Agent

修订 Agent 只处理 prose segment，并返回结构化结果。它不能：

- 直接写文件。
- 修改 protected token。
- 新增引用。
- 扩大结论。
- 删除必要披露。

### 验证 Agent

验证 Agent 复查：

- protected token drift。
- claim drift。
- 语言是否跑偏。
- 长度是否异常。
- 是否有 Markdown 代码围栏、助手残留、隐藏 Unicode。

## LangChain.js 设计

LangChain.js 官方文档支持用 `createAgent` 加 tools 数组组织工具调用，也支持传入模型实例。应用内计划对工具使用 LangChain/Zod 生态，但对 DeepSeek 模型调用做一层 adapter，避免 DeepSeek 专有字段被 OpenAI wrapper 吞掉。

只使用标准 OpenAI 字段时，可以用 `ChatOpenAI` 自定义 base URL：

```ts
import { ChatOpenAI } from "@langchain/openai";

const model = new ChatOpenAI({
  model: env.deepseekModel,
  apiKey: env.deepseekApiKey,
  temperature: 0,
  streamUsage: false,
  configuration: {
    baseURL: env.deepseekBaseUrl,
  },
});
```

但本项目默认需要 `thinking: { type: "disabled" }`，并且未来可能要处理 `reasoning_content`。因此推荐实现：

```ts
class DeepSeekChatModel extends BaseChatModel {
  // Internally uses the existing DeepSeek fetch client.
  // Always sends thinking.disabled for revision tasks.
  // Preserves tool_calls and ignores reasoning_content in user-facing output.
}
```

实施优先级：

1. 第一版用确定性 `TaskOrchestrator` + `DeepSeekChatClient.generateStructured()`。
2. 第二版把 `DeepSeekChatModel` 接入 LangChain `createAgent` 或 LangGraph。
3. 只有验证 DeepSeek tool calling 和 reasoning_content 处理稳定后，才允许 Agent 自主工具循环。

## 状态机

任务状态：

```text
created
  -> validating_input
  -> auditing_project
  -> parsing_report
  -> indexing_segments
  -> matching_findings
  -> diagnosing_style
  -> planning_revisions
  -> waiting_for_review
  -> applying_revisions
  -> validating_output
  -> compiling_latex
  -> generating_report
  -> completed
```

异常状态：

```text
failed
cancelled
paused_for_user
paused_for_risk
```

## 并发策略

第一版：

- 单任务串行执行。
- 每个 segment 顺序修订。
- 所有中间产物落盘。

第二版：

- 同文件 segment 保持顺序。
- 不同文件可并行诊断和改写。
- 验证阶段统一串行。

第三版：

- 引入队列。
- 多任务并发。
- Worker 隔离。
- LangGraph 或自定义 DAG 编排。
