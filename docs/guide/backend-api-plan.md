# 后端接口计划

## API 分组

后端在现有 Express 项目基础上扩展以下模块：

```text
/api/workspaces
/api/tasks
/api/reports
/api/parsers
/api/revisions
/api/files
/api/events
```

## Progress API

### `GET /api/tasks/:taskId/steps`

返回任务全部步骤及当前进度。

响应：

```json
{
  "taskId": "task_001",
  "steps": [
    {
      "stepKey": "audit_project",
      "title": "审计 LaTeX 项目",
      "status": "completed",
      "progressCurrent": 4,
      "progressTotal": 4,
      "durationMs": 1280
    }
  ]
}
```

### `GET /api/tasks/:taskId/events`

从数据库读取任务事件，支持断线续传。

查询参数：

| 参数 | 说明 |
| --- | --- |
| `after` | 只返回 sequence 大于该值的事件 |
| `limit` | 返回数量，默认 200 |

## Workspace API

### `POST /api/workspaces/inspect`

输入本地 LaTeX 项目路径，返回基础检查结果。

请求：

```json
{
  "projectDir": "D:/papers/thesis"
}
```

响应：

```json
{
  "projectDir": "D:/papers/thesis",
  "exists": true,
  "texFiles": 12,
  "bibFiles": 1,
  "rootCandidates": ["main.tex"],
  "warnings": []
}
```

### `POST /api/workspaces/audit`

调用 Skill 项目审计脚本，生成完整审计结果。

## Task API

### `POST /api/tasks`

创建修订任务。

请求：

```json
{
  "projectDir": "D:/papers/thesis",
  "reportFileId": "file_pdf_001",
  "options": {
    "scope": "report_findings",
    "language": "auto",
    "revisionStrength": "medium",
    "applyMode": "review_required",
    "compileMode": "auto"
  }
}
```

响应：

```json
{
  "taskId": "task_001",
  "state": "created"
}
```

### `GET /api/tasks/:taskId`

返回任务状态、当前阶段和统计信息。

### `POST /api/tasks/:taskId/start`

启动任务。

### `POST /api/tasks/:taskId/pause`

暂停任务。

### `POST /api/tasks/:taskId/cancel`

取消任务。

### `POST /api/tasks/:taskId/resume`

从最近阶段恢复任务。

## Report API

### `POST /api/reports/upload`

上传 PDF 报告，返回 `fileId`。

### `GET /api/reports/:fileId/parse`

解析 PDF，返回命中项。

## Parser API

### `POST /api/parsers/inspect`

识别文件类型和可用解析器。

请求：

```json
{
  "fileId": "file_001"
}
```

响应：

```json
{
  "fileId": "file_001",
  "kind": "pdf",
  "availableParsers": ["pdfjs_text", "pdf_ocr"],
  "recommendedParser": "pdfjs_text",
  "warnings": []
}
```

### `POST /api/parsers/parse`

执行指定解析器，生成结构化解析产物。

请求：

```json
{
  "fileId": "file_001",
  "parser": "pdfjs_text",
  "options": {
    "includePositions": true
  }
}
```

### `GET /api/tasks/:taskId/report`

返回最终统计报告。

## Revision API

### `GET /api/tasks/:taskId/findings`

返回所有命中和匹配 segment。

### `GET /api/tasks/:taskId/revisions/:revisionId`

返回单条修订详情。

### `POST /api/tasks/:taskId/revisions/:revisionId/approve`

人工确认通过。

### `POST /api/tasks/:taskId/revisions/:revisionId/reject`

拒绝该条修改。

### `POST /api/tasks/:taskId/revisions/:revisionId/regenerate`

重新生成该条修改。

### `POST /api/tasks/:taskId/apply`

应用已确认的修改。

### `POST /api/tasks/:taskId/rollback`

按 journal 回滚本任务修改。

## File API

### `GET /api/files/read`

读取项目内文件片段，用于 diff 预览。

### `GET /api/files/diff`

返回 unified diff 或 side-by-side diff 数据。

## Event API

### `GET /api/events/tasks/:taskId`

SSE 事件流。

事件示例：

```json
{
  "type": "step_completed",
  "taskId": "task_001",
  "step": "audit_project",
  "timestamp": "2026-04-30T10:00:00.000Z"
}
```

SSE 事件来自数据库 `task_events`，不是内存临时队列。服务重启后前端仍可通过 events API 补齐历史。

## 数据校验

所有请求使用 Zod schema 校验：

- 路径必须在允许的 workspace 根目录内。
- 文件大小受限。
- 枚举值必须显式列出。
- 用户提交的手动 revisedText 必须再次走 lint。

## 错误格式

```json
{
  "error": {
    "code": "LATEX_AUDIT_FAILED",
    "message": "LaTeX project audit failed.",
    "details": {
      "exitCode": 1,
      "stderr": "..."
    }
  }
}
```

## 后端模块划分

```text
src/
  config/
  routes/
    workspaces.ts
    tasks.ts
    reports.ts
    revisions.ts
    files.ts
    events.ts
  services/
    taskService.ts
    taskProgressService.ts
    agentOrchestrator.ts
    parserRegistry.ts
    reportParser.ts
    latexIndexer.ts
    revisionService.ts
    compileLogParser.ts
  tools/
    skillRuntime.ts
    latexProjectAudit.ts
    buildRevisionPack.ts
    chineseStyleLint.ts
    renderRevisionPrompt.ts
    lintRevisionPacket.ts
    applySegmentRevisions.ts
  storage/
    db.ts
    migrations/
    artifactStore.ts
    taskStore.ts
    taskEventStore.ts
    taskStepStore.ts
    revisionJournal.ts
  parsers/
    pdfParser.ts
    pdfOcrParser.ts
    latexParser.ts
    bibtexParser.ts
    markdownParser.ts
    docxParser.ts
    archiveParser.ts
    latexLogParser.ts
```
