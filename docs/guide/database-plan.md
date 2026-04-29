# 数据库设计

## 目标

系统必须把所有任务、步骤、进度、工具调用、Agent 调用、修订记录和报告索引写入数据库。数据库是任务恢复、前端进度展示、统计报告和审计日志的事实来源。

大文件不直接塞进数据库。PDF、revision packet、diff、HTML 报告、日志全文等产物放在 `.down-ai/tasks/<taskId>/`，数据库保存路径、hash、类型和关联关系。

## 技术选择

MVP 推荐：

- SQLite：适合本地单用户论文工作台，部署简单。
- Drizzle ORM：TypeScript 类型友好，迁移轻，后续可扩展到 PostgreSQL。
- `better-sqlite3`：本地同步访问稳定，适合任务状态频繁写入。

后续多人或远程部署：

- PostgreSQL。
- 队列表使用 Redis、BullMQ 或数据库队列。
- artifact 文件迁移到对象存储。

## 目录约定

```text
.down-ai/
  down-ai.sqlite
  migrations/
  tasks/
    task_001/
      uploads/
      artifacts/
      reports/
      logs/
```

## 核心表

### `tasks`

保存任务快照。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text pk | 任务 ID |
| `project_dir` | text | LaTeX 项目目录 |
| `report_file_id` | text nullable | 报告文件 ID |
| `state` | text | 当前状态 |
| `current_step` | text nullable | 当前步骤 key |
| `progress_current` | integer | 当前进度 |
| `progress_total` | integer | 总进度 |
| `options_json` | text | 任务配置 JSON |
| `summary_json` | text nullable | 汇总统计 JSON |
| `error_code` | text nullable | 最后错误码 |
| `error_message` | text nullable | 最后错误信息 |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |
| `started_at` | datetime nullable | 启动时间 |
| `finished_at` | datetime nullable | 完成时间 |

### `task_steps`

保存任务每个阶段的进度。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text pk | 步骤记录 ID |
| `task_id` | text | 任务 ID |
| `step_key` | text | 步骤 key，如 `audit_project` |
| `title` | text | 展示名称 |
| `status` | text | `pending`、`running`、`completed`、`failed`、`skipped` |
| `progress_current` | integer | 步骤当前进度 |
| `progress_total` | integer | 步骤总进度 |
| `started_at` | datetime nullable | 开始时间 |
| `finished_at` | datetime nullable | 结束时间 |
| `duration_ms` | integer nullable | 耗时 |
| `error_code` | text nullable | 错误码 |
| `error_message` | text nullable | 错误信息 |

约束：

- `(task_id, step_key)` 唯一。
- 每次步骤状态变化都写入 `task_events`。

### `task_events`

追加式事件日志，用于前端进度、审计和恢复。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text pk | 事件 ID |
| `task_id` | text | 任务 ID |
| `sequence` | integer | 任务内递增序号 |
| `type` | text | 事件类型 |
| `step_key` | text nullable | 关联步骤 |
| `message` | text | 展示信息 |
| `payload_json` | text nullable | 事件详情 |
| `created_at` | datetime | 事件时间 |

事件类型示例：

- `task_created`
- `task_started`
- `step_started`
- `step_progress`
- `step_completed`
- `step_failed`
- `agent_message`
- `tool_started`
- `tool_completed`
- `revision_created`
- `revision_applied`
- `task_completed`
- `task_failed`

### `report_files`

保存上传报告的元数据。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text pk | 文件 ID |
| `task_id` | text nullable | 所属任务 |
| `original_name` | text | 原文件名 |
| `mime_type` | text | MIME |
| `file_path` | text | 存储路径 |
| `size_bytes` | integer | 文件大小 |
| `sha256` | text | 文件 hash |
| `page_count` | integer nullable | PDF 页数 |
| `parse_status` | text | 解析状态 |
| `created_at` | datetime | 上传时间 |

### `parsed_documents`

保存解析结果索引。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text pk | 解析文档 ID |
| `task_id` | text nullable | 所属任务 |
| `source_file_id` | text nullable | 源文件 ID |
| `kind` | text | `pdf`、`latex`、`bibtex`、`markdown`、`docx`、`log`、`archive` |
| `parser_name` | text | 解析器名称 |
| `parser_version` | text nullable | 解析器或依赖版本 |
| `metadata_json` | text | 元数据 |
| `artifact_id` | text nullable | 完整解析产物 artifact |
| `status` | text | `completed`、`warning`、`failed` |
| `warnings_json` | text | 警告信息 |
| `created_at` | datetime | 创建时间 |

### `parsed_text_blocks`

保存解析出的文本块，供 PDF finding、LaTeX segment 和报告定位复用。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text pk | 文本块 ID |
| `parsed_document_id` | text | 解析文档 ID |
| `task_id` | text nullable | 任务 ID |
| `block_index` | integer | 文档内序号 |
| `page` | integer nullable | 页码 |
| `file_path` | text nullable | 源文件路径 |
| `line_start` | integer nullable | 起始行 |
| `line_end` | integer nullable | 结束行 |
| `bbox_json` | text nullable | PDF 坐标 |
| `text` | text | 文本 |
| `normalized_text` | text | 规范化文本 |
| `hash` | text | hash |

### `report_findings`

保存 PDF 或人工输入中的疑似问题项。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text pk | finding ID |
| `task_id` | text | 任务 ID |
| `report_file_id` | text nullable | 报告文件 ID |
| `page` | integer nullable | 页码 |
| `raw_text` | text | 原始文本 |
| `normalized_text` | text | 规范化文本 |
| `risk_type` | text | 问题类型 |
| `severity` | text | 严重程度 |
| `confidence` | real | 解析置信度 |
| `source` | text | `pdf`、`manual`、`style_lint` |

### `latex_segments`

保存从 LaTeX 中抽取的可编辑正文段。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text pk | segment ID |
| `task_id` | text | 任务 ID |
| `file_path` | text | 相对项目路径 |
| `line_start` | integer | 起始行 |
| `line_end` | integer | 结束行 |
| `section_path_json` | text | 章节路径 |
| `text` | text | 原始 segment |
| `normalized_text` | text | 规范化文本 |
| `text_hash` | text | 原文 hash |
| `protected_tokens_json` | text | protected token 列表 |

### `finding_matches`

保存报告 finding 与 LaTeX segment 的匹配结果。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text pk | match ID |
| `task_id` | text | 任务 ID |
| `finding_id` | text | finding ID |
| `segment_id` | text | segment ID |
| `score` | real | 匹配分 |
| `method` | text | `exact`、`normalized`、`ngram`、`edit_distance`、`embedding` |
| `needs_review` | integer | 是否需要人工确认 |
| `created_at` | datetime | 创建时间 |

### `revisions`

保存每条改写记录。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text pk | revision ID |
| `task_id` | text | 任务 ID |
| `segment_id` | text | segment ID |
| `finding_id` | text nullable | 来源 finding |
| `original_text` | text | 原文 |
| `revised_text` | text nullable | 改写文本 |
| `revision_note` | text | 修改说明 |
| `status` | text | `draft`、`approved`、`rejected`、`applied`、`failed` |
| `risk_flags_json` | text | 风险标记 |
| `confidence` | real | 模型置信度 |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |

### `validation_results`

保存每条 revision 的验证结果。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text pk | 验证 ID |
| `task_id` | text | 任务 ID |
| `revision_id` | text nullable | revision ID |
| `scope` | text | `segment`、`file`、`project`、`compile` |
| `status` | text | `passed`、`warning`、`failed` |
| `protected_token_ok` | integer nullable | token 是否通过 |
| `length_delta_ratio` | real nullable | 长度变化 |
| `claim_risk` | text nullable | claim drift 风险 |
| `warnings_json` | text | 警告 |
| `created_at` | datetime | 验证时间 |

### `tool_runs`

记录工具调用。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text pk | 调用 ID |
| `task_id` | text | 任务 ID |
| `step_key` | text | 所属步骤 |
| `tool_name` | text | 工具名 |
| `command_json` | text nullable | 命令摘要 |
| `input_json` | text nullable | 输入摘要 |
| `stdout_path` | text nullable | stdout 日志路径 |
| `stderr_path` | text nullable | stderr 日志路径 |
| `exit_code` | integer nullable | 退出码 |
| `status` | text | `running`、`completed`、`failed` |
| `duration_ms` | integer nullable | 耗时 |
| `created_at` | datetime | 创建时间 |
| `finished_at` | datetime nullable | 完成时间 |

### `agent_runs`

记录模型调用。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text pk | 调用 ID |
| `task_id` | text | 任务 ID |
| `step_key` | text | 所属步骤 |
| `agent_name` | text | Agent 名称 |
| `model` | text | 模型名 |
| `prompt_hash` | text | prompt hash |
| `input_summary_json` | text | 输入摘要 |
| `output_json` | text nullable | 结构化输出 |
| `token_usage_json` | text nullable | token 用量 |
| `status` | text | `running`、`completed`、`failed` |
| `error_message` | text nullable | 错误信息 |
| `created_at` | datetime | 创建时间 |
| `finished_at` | datetime nullable | 完成时间 |

默认不保存完整 prompt 和完整论文文本，除非用户显式开启调试模式。

### `artifacts`

保存文件产物索引。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text pk | artifact ID |
| `task_id` | text | 任务 ID |
| `kind` | text | `audit`、`packet`、`diff`、`report`、`log`、`backup` |
| `file_path` | text | 文件路径 |
| `mime_type` | text nullable | MIME |
| `sha256` | text | 文件 hash |
| `size_bytes` | integer | 文件大小 |
| `created_at` | datetime | 创建时间 |

## 状态写入协议

所有步骤更新必须走统一服务：

```ts
await taskProgress.updateStep({
  taskId,
  stepKey: "audit_project",
  status: "running",
  progressCurrent: 1,
  progressTotal: 4,
  event: {
    type: "step_progress",
    message: "正在审计 LaTeX 项目",
  },
});
```

内部用事务完成：

1. 更新 `tasks.current_step` 和全局进度。
2. upsert `task_steps`。
3. 插入 `task_events`。
4. 广播 SSE 事件。

## 恢复策略

服务启动后：

1. 查询 `state in ('running', 'paused_for_user', 'paused_for_risk')` 的任务。
2. 将异常退出的 `running` 任务标记为 `failed` 或 `paused_for_recovery`。
3. 根据 `task_steps` 找到最后完成阶段。
4. 根据 `artifacts` 检查中间文件是否存在且 hash 匹配。
5. 允许用户从最近稳定阶段继续。

## 索引建议

必要索引：

- `task_steps(task_id, step_key)`
- `task_events(task_id, sequence)`
- `report_findings(task_id, severity)`
- `latex_segments(task_id, file_path)`
- `finding_matches(task_id, finding_id)`
- `revisions(task_id, status)`
- `tool_runs(task_id, step_key)`
- `agent_runs(task_id, step_key)`
- `artifacts(task_id, kind)`
- `parsed_documents(task_id, kind)`
- `parsed_text_blocks(parsed_document_id, block_index)`

## API 与前端进度

前端进度页从数据库读取：

- `GET /api/tasks/:taskId`
- `GET /api/tasks/:taskId/steps`
- `GET /api/tasks/:taskId/events?after=<sequence>`
- `GET /api/events/tasks/:taskId` SSE

SSE 不作为唯一事实来源。断线后前端用 `after=lastSequence` 从 `task_events` 补齐事件。

## 迁移计划

初始迁移：

1. 创建 `.down-ai/down-ai.sqlite`。
2. 创建核心任务表。
3. 创建 finding、segment、revision、validation 表。
4. 创建 tool、agent、artifact 表。
5. 写入 schema version。

后续迁移必须兼容旧任务。无法兼容时，需要提供 task export/import。
