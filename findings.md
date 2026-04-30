# 发现记录

## 本地项目

- 当前项目是 TypeScript + Express 服务，已有 DeepSeek API 调用能力。
- 项目根目录已有 `API.md`、`README.md`、`package.json`、`src/`、`tsconfig.json`。
- 前一次任务中已初始化 Git 并推送到 `https://github.com/pqcqaq/down_ai.git`。

## `../BypassAIGC-Skill`

- 这是一个纯 Skill 项目，核心入口为 `SKILL.md`。
- 主要脚本：
  - `latex_project_audit.py`：审计 LaTeX 项目主文件、label、ref、cite、input/include。
  - `build_revision_pack.py`：生成可审阅的 JSON/Markdown 修订包。
  - `chinese_ai_style_lint.py`：扫描中文论文模板化、机械化、泛化表达。
  - `render_revision_prompt.py`：按 segment 渲染修订提示词。
  - `lint_revision_packet.py`：检查修订包 protected token 和危险表达。
  - `apply_segment_revisions.py`：将 approved revised_text 应用回 `.tex`。
  - `latex_segmenter.py`：抽取正文段和比较 protected token。
- 技能边界要求：不能承诺检测器分数下降，不能伪造人工写作、引用、数据或删除必要披露。

## 外部文档确认

- LangChain.js 官方文档推荐使用 `createAgent` 搭配 `tools` 数组，并用 Zod schema 定义工具输入；结构化输出可通过 `responseFormat` / `toolStrategy` 实现。
- VitePress 官方文档支持使用 `.vitepress/config.ts` 配置 nav、sidebar、local search、build/preview/dev 脚本。
- DeepSeek 官方 Chat Completion 文档确认 `thinking` 默认 enabled，可设置 disabled；支持 `response_format: json_object`、function tools、`tool_choice` 和响应中的 `reasoning_content`、`tool_calls`。
- DeepSeek Thinking Mode 文档提示 OpenAI SDK 中 `thinking` 需要走 `extra_body`，因此本项目不应盲目依赖通用 OpenAI wrapper 透传该字段。
- LangChain.js 官方文档确认 `createAgent` 可以传入模型实例，tools 可以用 `tool()` + Zod schema 定义。
- Drizzle 官方 SQLite 文档确认支持 `libsql` 和 `better-sqlite3`，并给出 `drizzle-orm/better-sqlite3` 初始化方式。
- PDF.js API 文档确认有 `getDocument` 和 `getTextContent` 相关能力，可用于文本型 PDF 解析。

## 关键设计影响

- Agent 不应直接“全文改写”，应先审计、分段、诊断、生成修订包、逐段修订、lint、应用、编译验证、生成报告。
- 报告必须包含原文位置、问题类型、修改摘要、token 保护结果、编译结果和人工复核项。
- 前端选择目录和 PDF 在浏览器环境中有权限边界，桌面应用或本地 companion 服务会比纯网页更适合做完整文件系统读写。
- 用户明确要求功能完善优先，可以为文件解析引入额外成熟依赖；规划已调整为 parser registry，不把 PDF/LaTeX/BibTeX/OCR 等复杂格式解析靠手写字符串处理完成。
- 可行性复核后，架构从“全自主 Agent”收敛为“确定性编排器 + 受控模型结构化输出 + 数据库进度事件 + 工具层写回”。
- 当前规划原先只零散提到测试，没有明确真实大模型 API 测试；已新增测试计划，要求默认离线测试和显式开启的 DeepSeek live API 测试并存。
- 用户要求尽可能少的迭代次数，开发计划已从 6+ 小里程碑收敛为 3 次主迭代，并提供 2 次迭代压缩方案。
- 真实 live dry-run 测试发现 `DeepSeekRevisionLlmClient` 需要使用当前任务数据库句柄记录 `agent_runs`，否则测试隔离数据库无法审计模型调用；已调整为从 `TaskOrchestrator` 传入 handle。
- 浏览器验证时发现本机 3000 端口已有旧后端实例，因此前端需要支持 `VITE_API_BASE_URL` 指向其他后端端口；已补充该能力，并用 3300/5174 独立验证前端流程。
- 用户反馈前端常驻目录树、历史和大段编辑区导致页面混乱；已将这些非基本流程能力迁移到 modal，只在主页面保留线性工作流。
- 真实 WiSh 项目验证发现 root candidate 可能是只有 `\input` 的 wrapper，直接生成 revision pack 会得到 0 个 segment；已改为根据 labels/refs/cites、chapters/body 路径等正文信号选择修订源文件。
- 真实 DeepSeek 响应可能把可选字段返回为 `null`，而不是省略字段；已在解析结构化输出前清理 `revisedText: null`。
- 用户指出“输入前多少条”不是合理主流程；应从报告 finding 出发，在整个 LaTeX 项目中用稳定前缀直接定位原段落，定位确定后再交给 AI 改写。
- 单 root 文件策略不足以覆盖多文件论文项目；后端需要遍历审计结果中的全部 `.tex` 文件并分别生成 revision packet，写回时也要按文件重新生成 apply packet。
