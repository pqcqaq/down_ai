# 测试计划

## 结论

开发计划必须包含测试，并且包含真实调用大模型 API 的测试。测试分为默认可跑的离线测试和需要显式开启的 live API 测试两类：

- 默认测试：不访问网络，不消耗 API 额度，适合每次提交和 CI。
- Live API 测试：真实调用 DeepSeek API，验证模型接入、JSON 输出、`thinking.disabled`、错误处理和端到端改写质量，只在本地手动或夜间任务中运行。

## 测试分层

测试不单独拖成额外长期迭代，必须嵌入 2-3 次主迭代中：

- Iteration 1：完成 L0、L1、L2、DeepSeek mock 测试。
- Iteration 2：完成 L3、L4、L5 dry-run、写回和回滚测试。
- Iteration 3：完成 L6 live DeepSeek API 测试和真实验收测试。

| 层级 | 类型 | 是否默认运行 | 目标 |
| --- | --- | --- | --- |
| L0 | 类型检查、lint、格式检查 | 是 | 保证基础代码质量 |
| L1 | 单元测试 | 是 | 测 parser、matcher、DB service、validator |
| L2 | 本地集成测试 | 是 | 跑 SQLite、SkillRuntime、PDF fixture、LaTeX fixture |
| L3 | API/服务测试 | 是 | 用 Supertest 测 Express 路由和错误格式 |
| L4 | 前端组件测试 | 是 | 测任务页、进度页、diff 审核交互 |
| L5 | E2E 测试 | 可选 | 用 Playwright 跑完整 dry-run |
| L6 | Live LLM API 测试 | 否，需显式开启 | 真实调用 DeepSeek API |
| L7 | 人工验收测试 | 发布前 | 用真实 LaTeX 项目和报告 PDF 验收 |

## 推荐测试工具

| 场景 | 工具 |
| --- | --- |
| TypeScript 单元测试 | Vitest |
| Express API 测试 | Supertest |
| 前端组件测试 | Vitest + Testing Library |
| 浏览器端 E2E | Playwright |
| SQLite 测试库 | 临时 `.down-ai-test/*.sqlite` |
| HTTP mock | MSW 或 Undici MockAgent |
| Diff snapshot | Vitest snapshot |
| LaTeX fixture | `tests/fixtures/latex-projects/*` |
| PDF fixture | `tests/fixtures/reports/*` |

## 离线测试范围

### 数据库测试

必须覆盖：

- migration 能创建全部表和索引。
- `TaskProgressService` 事务写入：
  - 更新 `tasks`。
  - upsert `task_steps`。
  - append `task_events`。
- SSE 断线后能用 `after=sequence` 补齐事件。
- 任务失败后能从数据库恢复到最近稳定阶段。

### SkillRuntime 测试

必须覆盖：

- 能发现 `BYPASS_AIGC_SKILL_DIR`。
- 能调用 `latex_project_audit.py`。
- 能生成 revision packet。
- 能运行中文风格 lint。
- 能运行 `lint_revision_packet.py`。
- 能运行 `latex_segmenter.py check`。
- 命令失败时记录 stdout、stderr、exitCode、durationMs。

### Parser 测试

必须覆盖：

- 文本型 PDF 解析。
- 扫描版 PDF 进入 OCR fallback 或人工输入状态。
- `.tex` segment 抽取和 hash 稳定。
- `.bib` 解析。
- 编译日志错误提取。
- 解析结果写入 `parsed_documents` 和 `parsed_text_blocks`。

### Revision 测试

必须覆盖：

- Zod 校验 `RevisionDecision`。
- 改写结果不能漂移 `\cite`、`\ref`、`\label`、公式和环境。
- 长度变化超过阈值进入人工确认。
- 低置信度 finding match 不自动应用。
- apply journal 可回滚。

## Live LLM API 测试

### 运行原则

真实大模型 API 测试必须存在，但不能默认运行。

原因：

- 会消耗费用。
- 依赖网络和供应商状态。
- 输出有概率波动。
- 不应把真实论文内容发到测试 API。

触发条件：

```text
RUN_LIVE_LLM_TESTS=true
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-v4-pro
```

建议脚本：

```json
{
  "test": "vitest run",
  "test:integration": "vitest run tests/integration",
  "test:e2e": "playwright test",
  "test:live": "cross-env RUN_LIVE_LLM_TESTS=true vitest run tests/live"
}
```

### Live 测试用例

#### 1. DeepSeek smoke test

目标：确认 API key、base URL、模型名可用。

输入使用合成文本：

```text
请把这句话改得更清晰：本文设计了系统，并完成了实现。
```

断言：

- HTTP 成功。
- 返回非空 `content`。
- 不返回给用户 `reasoning_content`。
- 响应耗时记录到 `agent_runs`。

#### 2. JSON 结构化输出测试

目标：确认模型能按 schema 返回 `RevisionDecision`。

断言：

- 返回 JSON 可解析。
- 通过 Zod schema。
- `action` 只能是 `keep`、`revise`、`needs_review`。
- `revisedText` 不包含 Markdown 代码围栏。

#### 3. `thinking.disabled` 测试

目标：确认修订任务默认关闭思考内容。

断言：

- 请求体包含：

```json
{
  "thinking": {
    "type": "disabled"
  }
}
```

- 最终 API 响应转换后的用户结果不包含 `<think>`、`reasoning_content` 或“思考过程”。

#### 4. LaTeX protected token 测试

目标：真实模型改写时仍保留 LaTeX token。

输入：

```latex
本文基于已有方法完成系统设计，并通过实验验证其有效性 \cite{smith2024}。如图 \ref{fig:arch} 所示，系统包含三个模块。
```

断言：

- `\cite{smith2024}` 保留。
- `\ref{fig:arch}` 保留。
- 不新增引用 key。
- 不新增实验事实。

#### 5. 错误处理测试

目标：验证真实 API 错误不会破坏任务状态。

方式：

- 使用无效模型名或受控 mock 触发错误。

断言：

- `agent_runs.status=failed`。
- `task_events` 写入 `step_failed`。
- 任务进入可恢复状态。
- API key 不出现在日志中。

## Live 测试成本控制

必须限制：

- 使用合成短文本。
- 每次 live 测试最多 3 到 5 次模型请求。
- 设置 `max_tokens` 或等价输出限制。
- 设置超时和重试次数。
- 不在普通 PR CI 中运行。
- 日志只保存 prompt hash 和输入摘要，不保存完整敏感内容。

## CI 策略

默认 CI：

```text
npm run typecheck
npm test
npm run docs:build
```

可选 CI：

```text
npm run test:integration
npm run test:e2e
```

手动或夜间：

```text
npm run test:live
```

`test:live` 只有在环境变量齐全时才运行；否则应该输出 skip，而不是失败。

## 验收标准

MVP 进入可用状态前必须满足：

- 单元测试覆盖核心纯函数和 schema。
- 集成测试能跑通示例 LaTeX 项目的 audit、packet、lint、apply、check。
- 数据库测试能证明任务步骤和事件可恢复。
- API 测试覆盖任务创建、进度查询、事件续传、修订确认。
- 至少有一个真实 DeepSeek API smoke test。
- 至少有一个真实 DeepSeek 结构化改写测试。
- Live 测试默认关闭，且不会发送真实论文 fixture。

## 不做的测试承诺

- 不测试或承诺任何 AI 检测器分数。
- 不用真实用户论文作为自动化测试 fixture。
- 不把 live API 输出做严格逐字 snapshot。
- 不让 live 测试成为普通本地开发的硬依赖。
