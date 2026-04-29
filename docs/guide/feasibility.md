# 可行性复核

## 结论

当前架构可以正确实现，但第一版必须采用保守落地方式：

- 使用后端状态机驱动任务，不让 LLM 自主控制整个流程。
- 模型只生成结构化修订建议。
- 所有文件解析、文件写入、lint、编译和回滚都由确定性代码执行。
- 数据库记录每一步状态，artifact 文件保存大产物。
- 高风险修改进入人工确认。

这样能把最大风险从“模型行为不可控”降到“单个工具或 parser 失败可恢复”。

## 已核对的关键技术点

### DeepSeek API

DeepSeek 官方 `/chat/completions` 支持：

- `deepseek-v4-flash`、`deepseek-v4-pro` 模型。
- `thinking` 开关，取值 `enabled` 或 `disabled`。
- `reasoning_effort`。
- `response_format: { "type": "json_object" }`。
- `tools` 和 `tool_choice`，工具类型为 function，最多 128 个。
- 响应中存在 `reasoning_content` 和 `tool_calls`。

可行性判断：可实现。  
实施决策：修订任务默认发送 `thinking.disabled`，避免生成深度思考内容；结构化改写优先用 JSON output + Zod 校验；工具调用只在受控步骤使用。

### LangChain.js

LangChain.js 支持：

- `createAgent`。
- 使用 `tool()` 和 Zod 定义工具 schema。
- 传入模型实例，而不是只能使用字符串模型名。
- `ChatOpenAI` 支持自定义 `configuration.baseURL`，可接入 OpenAI-compatible API。

可行性判断：可实现，但不能完全依赖通用 OpenAI wrapper 处理 DeepSeek 专有字段。  
实施决策：第一版不做全自主 Agent 循环，采用 `TaskOrchestrator + DeepSeekChatClient + Zod structured output`；后续实现 `DeepSeekChatModel extends BaseChatModel` 后再接入 `createAgent` 或 LangGraph。

### SQLite + Drizzle ORM

Drizzle 官方支持 SQLite，并支持 `better-sqlite3`。官方示例包含：

- `npm i drizzle-orm better-sqlite3`
- `npm i -D drizzle-kit @types/better-sqlite3`
- `import { drizzle } from "drizzle-orm/better-sqlite3"`
- 传入已有 `better-sqlite3` client。

可行性判断：可实现。  
实施决策：MVP 使用 SQLite + Drizzle + `better-sqlite3`；开启 WAL；所有任务状态更新使用事务；并发任务先限制为单 worker，后续多 worker 或远程部署切 PostgreSQL。

### PDF 解析

PDF.js 官方 API 支持：

- `getDocument(src)` 加载 PDF。
- `PDFPageProxy.getTextContent()` 获取页面文本内容。
- 文本项包含 `str`、`dir`、`transform`、`width`、`height` 等位置相关字段。

可行性判断：文本型 PDF 可实现；扫描版 PDF 需要 OCR。  
实施决策：第一层使用 `pdfjs-dist` 提取文本和坐标；失败时降级到 `pdf-parse` 简化文本；扫描版 PDF 接入 OCR adapter，例如 `tesseract.js` 或系统 `tesseract`。

### LaTeX 改写

`../BypassAIGC-Skill` 已提供：

- 项目审计。
- revision packet 生成。
- 中文模板化表达 lint。
- 分段提示词渲染。
- revision packet lint。
- segment 写回。
- protected token 检查。

可行性判断：核心 LaTeX 安全写回可实现。  
实施决策：第一版以 Skill 脚本为权威工具，不直接用 AST 重写 LaTeX；`unified-latex` 只作为增强解析和校验工具，不作为写回主路径。

## 架构修正

原始设想中“使用 LangChain 等框架编写 Agent”容易被理解成完全自主 Agent。复核后改为：

```text
TaskOrchestrator
  -> SkillRuntime
  -> ParserRegistry
  -> DeepSeekChatClient
  -> DatabaseProgressService
  -> RevisionValidator
  -> ReportGenerator
```

LangChain 的位置：

- 工具 schema。
- 结构化输出。
- 可选子 Agent。
- 后续 LangGraph DAG 编排。

LangChain 不负责：

- 直接写 LaTeX 文件。
- 决定是否覆盖用户项目。
- 跳过 lint 或人工确认。
- 持有唯一任务状态。

## MVP 技术闭环

第一版可以按以下闭环实现：

1. Express 创建任务，写入 SQLite。
2. `SkillRuntime` 审计 LaTeX 项目。
3. `ParserRegistry` 解析 PDF。
4. `SkillRuntime` 生成 revision packet。
5. 后端匹配 PDF finding 和 LaTeX segment。
6. DeepSeek 以 JSON output 返回 `RevisionDecision`。
7. Zod 校验结构。
8. 写入 `revisions`。
9. 人工确认。
10. `lint_revision_packet.py` 校验。
11. `apply_segment_revisions.py` 写回。
12. `latex_segmenter.py check` 验证。
13. 可选 `latexmk` 编译。
14. 数据库和 artifact 生成统计报告。

这个闭环不依赖未验证的模型自主工具能力，因此可实施性高。

## 主要风险与处理

| 风险 | 等级 | 处理 |
| --- | --- | --- |
| PDF 报告格式差异大 | 高 | parser adapter + 人工粘贴/标注兜底 |
| 扫描版 PDF 无文本 | 中 | OCR adapter，失败后人工输入 |
| DeepSeek 专有字段与 LangChain wrapper 不完全兼容 | 中 | 自定义 DeepSeek client/model adapter |
| LaTeX 复杂宏导致 segment 抽取遗漏 | 中 | Skill 脚本保守抽取 + 人工复核 |
| 模型改写改变结论强度 | 高 | claim risk 检查 + 高风险人工确认 |
| SQLite 多任务写入锁 | 中 | 单 worker + WAL + 事务；多用户切 PostgreSQL |
| Windows native 依赖安装问题 | 中 | 优先锁定 Node 版本；`better-sqlite3` 失败时切 `@libsql/client` 本地 file 模式 |
| 浏览器目录写回权限 | 高 | MVP 使用 localhost 后端路径白名单；纯远程部署禁用本地写回 |

## 实现顺序建议

必须先做：

1. 数据库 schema 和迁移。
2. `TaskProgressService`。
3. `SkillRuntime`。
4. `ParserRegistry`。
5. `DeepSeekChatClient.generateStructured()`。
6. revision packet lint/apply/check 闭环。
7. 测试基础设施：Vitest、Supertest、fixture、SQLite 测试库、live API 测试开关。

后做：

1. LangChain `createAgent` 自主工具循环。
2. 多 Agent 并行。
3. LangGraph DAG。
4. OCR 自动化。
5. 桌面端封装。

## 测试可行性

测试计划可实现，且必须包含真实大模型 API 测试。实现上分两类：

- 默认测试使用 mock DeepSeek client，保证本地和 CI 稳定。
- Live 测试真实调用 DeepSeek API，通过 `RUN_LIVE_LLM_TESTS=true` 显式开启。

Live 测试只使用合成 LaTeX 片段，不使用真实论文内容；断言结构、token 保护和错误处理，不对模型输出做逐字匹配。

## 参考文档

- DeepSeek Create Chat Completion：https://api-docs.deepseek.com/api/create-chat-completion
- DeepSeek Tool Calls：https://api-docs.deepseek.com/guides/tool_calls
- DeepSeek Thinking Mode：https://api-docs.deepseek.com/guides/thinking_mode
- LangChain.js ChatOpenAI：https://docs.langchain.com/oss/javascript/integrations/chat/openai/
- LangChain.js Agents：https://docs.langchain.com/oss/javascript/langchain/agents
- LangChain.js Tools：https://docs.langchain.com/oss/javascript/langchain/tools
- Drizzle SQLite：https://orm.drizzle.team/docs/get-started-sqlite
- PDF.js API：https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html
