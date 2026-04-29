# 里程碑

## 迭代策略

开发计划按 3 次迭代完成，不再拆成 6 到 8 个小阶段。目标是尽可能少的迭代次数下交付可用系统：

- Iteration 1：后端核心闭环可跑通。
- Iteration 2：前端工作台 + 安全写回 + 报告可用。
- Iteration 3：真实大模型测试、E2E、解析增强和稳定性收尾。

如果必须压缩到 2 次迭代，则把 Iteration 3 的必做项合并进 Iteration 2，把 OCR、多格式报告 adapter、桌面端封装等延期到 backlog。

## Iteration 1：后端核心闭环

目标：不依赖前端，先把“选择项目路径 + 报告输入 + 审计 + 匹配 + 模型生成建议 + 数据库记录”跑通。

范围：

- 数据库 schema 和迁移。
- `TaskProgressService`，记录任务、步骤、进度、事件。
- `SkillRuntime`，封装 `../BypassAIGC-Skill` 核心脚本：
  - `latex_project_audit.py`
  - `build_revision_pack.py`
  - `chinese_ai_style_lint.py`
  - `render_revision_prompt.py`
  - `lint_revision_packet.py`
  - `latex_segmenter.py check`
- `ParserRegistry`：
  - PDF 文本解析。
  - LaTeX segment 索引。
  - BibTeX 基础解析。
  - 编译日志基础解析。
- `DeepSeekChatClient.generateStructured()`：
  - 默认 `thinking.disabled`。
  - JSON output。
  - Zod 校验。
  - mock client 和 live client 分离。
- 后端 API：
  - workspace inspect/audit。
  - task create/start/status/steps/events。
  - report upload/parse。
  - revisions list/detail。
- 后端 dry-run：只生成修订建议，不写回 `.tex`。
- 测试：
  - 单元测试。
  - 数据库集成测试。
  - SkillRuntime 集成测试。
  - Parser fixture 测试。
  - DeepSeek mock 测试。

验收：

- 用命令或 API 创建任务后，能完成 LaTeX 审计、报告解析、segment 匹配和 revision draft 生成。
- 任务进度完整写入 SQLite。
- 服务重启后能读取任务状态和事件历史。
- 默认测试不依赖网络。
- 不写回用户项目文件。

## Iteration 2：前端工作台、写回和报告

目标：交付一个本地可用的完整产品闭环。用户可以在浏览器中创建任务、查看进度、审核改写、应用修改、回滚并下载报告。

范围：

- Vite + React 前端应用。
- 页面：
  - 项目选择。
  - 报告上传。
  - 扫描配置。
  - 任务进度。
  - 命中列表。
  - 原文/修订对照。
  - 统计报告。
- SSE 进度推送和断线补齐。
- 人工确认：
  - approve。
  - reject。
  - regenerate。
  - manual edit。
- 安全写回：
  - revision packet lint。
  - `apply_segment_revisions.py`。
  - protected token check。
  - apply journal。
  - rollback API。
- 报告生成：
  - Markdown。
  - HTML。
  - JSON。
- 可选编译验证：
  - 自动检测 `latexmk`。
  - 用户手动配置编译命令。
  - 编译日志解析。
- 测试：
  - Express API 测试。
  - 前端组件测试。
  - Playwright dry-run E2E。
  - 回滚测试。

验收：

- 用户无需命令行即可完成一次 dry-run。
- 用户能逐条审核并应用修改。
- 应用后 protected token check 通过。
- 回滚不会覆盖用户后续手动修改。
- 能下载统计报告。
- E2E dry-run 稳定通过。

## Iteration 3：真实 API、复杂解析和稳定性收尾

目标：把系统从“可用”提升为“可靠可验收”，重点补齐真实 DeepSeek API 测试、真实端到端验收、复杂文件解析和错误恢复。

范围：

- Live LLM 测试：
  - DeepSeek smoke test。
  - JSON 结构化输出测试。
  - `thinking.disabled` 测试。
  - LaTeX protected token 真实改写测试。
  - 错误处理测试。
- 真实项目验收：
  - 使用合成 LaTeX 项目。
  - 使用示例报告 PDF。
  - 跑完整 dry-run 和写回回滚。
- 解析增强：
  - OCR adapter。
  - DOCX 辅助报告解析。
  - Markdown 输入。
  - 压缩包上传。
  - 多报告格式 adapter。
- 稳定性：
  - 任务取消、暂停、恢复。
  - 失败重试。
  - 日志查看。
  - artifact 清理。
  - 性能和大文件限制。
- 质量：
  - Agent trace。
  - 结构化错误码。
  - 文档更新。

验收：

- `RUN_LIVE_LLM_TESTS=true` 时能真实调用 DeepSeek API 并完成 schema 校验。
- Live 测试只使用合成论文片段，不上传真实论文 fixture。
- 任务中断后可以恢复或安全失败。
- 扫描版 PDF 有明确 OCR 或人工输入降级路径。
- 常见失败都有错误码、日志和恢复建议。

## 2 次迭代压缩方案

如果要求严格 2 次迭代：

### Iteration A：后端 + 数据库 + Agent dry-run

合并 Iteration 1 全部内容，并加入最小 API 测试和 mock DeepSeek 测试。

### Iteration B：前端 + 写回 + 报告 + Live API 验收

合并 Iteration 2 全部内容，并从 Iteration 3 中纳入：

- DeepSeek live smoke test。
- DeepSeek live 结构化输出测试。
- Playwright dry-run E2E。
- 任务恢复。
- 回滚验证。

延期：

- OCR 自动化。
- DOCX/Markdown/压缩包高级解析。
- 多报告格式 adapter。
- 多 Agent 并行。
- 桌面端封装。
- 多用户和远程部署。

## Backlog

- OCR 深度优化。
- 多种报告格式 adapter。
- 向量匹配提高段落定位准确率。
- Monaco Editor LaTeX 语法高亮。
- Git diff 可视化。
- 多模型重试。
- 本地模型支持。
- 桌面端包装，例如 Tauri 或 Electron。
- 多用户权限系统。
- WebDAV 或 GitHub repo 导入。

## 推荐执行顺序

1. 直接执行 Iteration 1。
2. Iteration 1 验收通过后，不新增大范围架构调整，直接进入 Iteration 2。
3. Iteration 2 做到可用闭环后，再用 Iteration 3 补真实 API 验收和稳定性。
