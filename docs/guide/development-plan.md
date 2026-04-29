# 开发计划

## 总体路线

系统按 3 次迭代交付，避免把工作拆成过多小阶段导致反复返工：

- Iteration 1：后端核心闭环。
- Iteration 2：前端工作台、写回和报告。
- Iteration 3：真实 API、复杂解析和稳定性收尾。

如果必须压缩到 2 次迭代，则将 Iteration 3 的 live API 测试、E2E、任务恢复和回滚验收合并进 Iteration 2，把 OCR 自动化、多格式高级解析、多 Agent 并行和桌面端封装放入 backlog。

功能完整性优先于依赖数量控制。凡是涉及 PDF、LaTeX、BibTeX、OCR、diff、压缩包、编译日志等专业解析能力，应优先采用成熟依赖或专门工具，再用统一 adapter 封装，而不是用脆弱的字符串处理硬拼。

可行性复核后，第一版架构明确为“确定性任务编排器 + 受控模型结构化输出”。不要把文件写入、编译、回滚交给模型自主工具循环。

## Iteration 0：文档与约束确认

目标：把功能边界、Agent 流程和技术选型写清楚，避免后续直接堆功能。

交付物：

- VitePress 文档子项目。
- 产品能力清单。
- Agent 工作流。
- 前后端接口草案。
- 数据结构和报告结构。
- 安全与合规边界。

完成标准：

- 文档能解释从“选择目录和 PDF”到“更新 LaTeX 并生成报告”的完整链路。
- 每个自动修改动作都有可审计记录。

## Iteration 1：后端核心闭环

目标：不依赖前端，先把后端 dry-run 跑通。完成数据库、SkillRuntime、ParserRegistry、DeepSeek 结构化输出和任务进度事件。

计划：

- 建立 SQLite + Drizzle schema 和 migration。
- 新增 `TaskProgressService`，记录 tasks、steps、events、tool runs、agent runs。
- 新增 `src/tools/latexProjectAudit.ts`，封装 `latex_project_audit.py`。
- 新增 `src/tools/buildRevisionPack.ts`，封装 `build_revision_pack.py`。
- 新增 `src/tools/chineseStyleLint.ts`，封装 `chinese_ai_style_lint.py`。
- 新增 `src/tools/renderRevisionPrompt.ts`，封装 `render_revision_prompt.py`。
- 新增 `src/tools/lintRevisionPacket.ts`，封装 `lint_revision_packet.py`。
- 新增 `src/tools/applySegmentRevisions.ts`，封装 `apply_segment_revisions.py`。
- 新增 `src/tools/latexProtectedCheck.ts`，封装 `latex_segmenter.py check`。
- 新增 ParserRegistry：
  - PDF 文本解析。
  - LaTeX segment 索引。
  - BibTeX 基础解析。
  - 编译日志基础解析。
- 使用 `pdfjs-dist` 提取文本、页码和文本 item 位置信息。
- 对简单文本型 PDF 可兼容 `pdf-parse` 做快速通道。
- 对扫描版 PDF 预留 OCR adapter，例如 `tesseract.js` 或系统 `tesseract`。
- 保留原始页码和段落坐标能力的扩展位。
- 建立 `ReportFinding` 结构：
  - `id`
  - `page`
  - `rawText`
  - `normalizedText`
  - `riskType`
  - `severity`
  - `confidence`
  - `source`
- 对无法可靠解析的 PDF 提供人工粘贴或手动标注入口。
- 审计主文件、章节文件、引用关系和编译入口。
- 抽取所有可编辑 prose segment。
- 为每个 segment 建立 fingerprint：
  - 原始文本 hash。
  - 规范化文本 hash。
  - 文件路径。
  - 起止行号。
  - 所在章节。
  - protected token 列表。
- 建立 PDF 报告命中内容与 segment 的 fuzzy match。
- 把工具层封装为 LangChain tools。
- 使用结构化输出定义每段改写结果。
- 把任务拆为：
  - Project Auditor。
  - Report Parser。
  - Segment Matcher。
  - Style Diagnoser。
  - Revision Planner。
  - Revision Writer。
  - Safety Validator。
  - Report Writer。
- 实现后端 dry-run：生成 revision draft，不写回用户项目。

关键要求：

- 所有工具输入输出使用 Zod schema。
- 工具执行必须记录 stdout、stderr、exitCode、耗时。
- 工具失败不能直接中断全任务，应进入可恢复状态。
- 脚本路径默认从环境变量读取，例如 `BYPASS_AIGC_SKILL_DIR=../BypassAIGC-Skill`。
- Iteration 1 的验收测试必须覆盖数据库、SkillRuntime、ParserRegistry 和 mock DeepSeek。

## Iteration 2：前端工作台、写回和报告

目标：交付完整本地产品闭环。用户可以在页面中创建任务、查看进度、审核改写、应用写回、回滚并下载报告。

计划：

- 采用 Vite + React。
- 页面包括：
  - 项目选择页。
  - 报告上传页。
  - 扫描配置页。
  - 任务进度页。
  - 命中列表页。
  - 原文/修订对照页。
  - 报告页。
- 如果浏览器目录权限不足，提供本地路径输入和后端目录白名单配置。
- 接入 SSE 进度推送和断线事件补齐。
- 实现 approve、reject、regenerate、manual edit。
- 修改前创建工作副本或 Git 临时分支。
- 每个 segment 生成 patch。
- 应用前运行 packet lint。
- 应用后运行 protected token check。
- 可选运行 `latexmk` 或项目自定义构建命令。
- 所有文件修改写入 `RevisionJournal`。
- 输出 Markdown、HTML、JSON 三种报告。
- 报告包含：
  - 总览指标。
  - 风险类型分布。
  - 文件和章节分布。
  - 每条命中的原文、原因、改写、验证结果。
  - protected token drift 检查。
  - 编译检查。
  - 人工复核建议。
- Iteration 2 的验收测试必须覆盖 API、前端组件、Playwright dry-run、写回和回滚。

## Iteration 3：真实 API、复杂解析和稳定性收尾

目标：补齐真实 DeepSeek API 验收、复杂文件解析、任务恢复和稳定性。

计划：

- 增加任务取消、重试、恢复。
- 增加日志查看和错误诊断。
- 增加 dry-run 模式。
- 增加样例 LaTeX 项目测试。
- 增加单元测试、集成测试和端到端测试。
- 增加真实 DeepSeek API 测试，但默认关闭，需通过 `RUN_LIVE_LLM_TESTS=true` 和 `DEEPSEEK_API_KEY` 显式开启。
- 引入 LangSmith 或本地 trace 日志评估 Agent 行为。
- 增强文件解析能力：
  - OCR adapter。
  - DOCX 辅助报告解析。
  - Markdown 输入。
  - 压缩包上传。
  - 多报告格式 adapter。

测试分层详见 [测试计划](./testing-plan.md)。MVP 验收必须至少包含一次真实 DeepSeek smoke test 和一次真实结构化改写测试，且测试内容只能使用合成论文片段。

## 2 次迭代压缩方案

如果要求严格 2 次迭代：

- Iteration A：合并 Iteration 1，完成后端、数据库、SkillRuntime、ParserRegistry、mock DeepSeek 和 dry-run。
- Iteration B：合并 Iteration 2，并从 Iteration 3 纳入 live DeepSeek smoke test、live 结构化输出测试、Playwright E2E、任务恢复和回滚验收。

延期到 backlog：

- OCR 自动化。
- DOCX/Markdown/压缩包高级解析。
- 多报告格式 adapter。
- 多 Agent 并行。
- 桌面端封装。

## 优先级

| 优先级 | 内容 |
| --- | --- |
| P0 | Iteration 1 全部内容 |
| P1 | Iteration 2 全部内容 |
| P2 | Iteration 3 中的 live API、E2E、任务恢复、回滚验证 |
| P3 | OCR 自动化、多格式高级解析、多 Agent 并行、桌面端、多用户 |
