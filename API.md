# 接口文档

## 基本信息

- 服务名称：`down-ai`
- 默认地址：`http://localhost:3000`
- 数据格式：`application/json`
- 字符编码：`UTF-8`

本服务用于接收一段文本内容，调用 DeepSeek API 生成结果，并返回去除深度思考内容后的最终文本。

## 环境变量

| 变量名 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `DEEPSEEK_API_KEY` | 否 | 无 | DeepSeek API Key，通过环境变量注入；`/api/generate` 或 `USE_LIVE_LLM=true` 时需要 |
| `DEEPSEEK_MODEL` | 否 | `deepseek-v4-pro` | DeepSeek 模型名称 |
| `DEEPSEEK_BASE_URL` | 否 | `https://api.deepseek.com` | DeepSeek API 基础地址 |
| `DEEPSEEK_THINKING` | 否 | `disabled` | 是否启用思考模式，可选值：`enabled`、`disabled` |
| `DEEPSEEK_REASONING_EFFORT` | 否 | `high` | 思考强度，仅在 `DEEPSEEK_THINKING=enabled` 时生效，可选值：`high`、`max` |
| `USE_LIVE_LLM` | 否 | `false` | 任务 dry-run 是否真实调用 DeepSeek；默认使用 mock LLM |
| `BYPASS_AIGC_SKILL_DIR` | 否 | `../BypassAIGC-Skill` | BypassAIGC-Skill 项目目录 |
| `PYTHON_BIN` | 否 | `python` | Python 可执行命令 |
| `DOWN_AI_DATA_DIR` | 否 | `.down-ai` | SQLite、上传文件、artifact 和日志目录 |
| `WORKSPACE_ROOT` | 否 | `..` | 允许访问的工作区根目录 |
| `PORT` | 否 | `3000` | HTTP 服务端口 |
| `CORS_ORIGIN` | 否 | `*` | 允许跨域访问的来源 |

## 通用响应

成功响应为 JSON 对象。失败响应统一包含 `error` 字段：

```json
{
  "error": "错误信息"
}
```

## 健康检查

### `GET /health`

用于检查服务是否正常启动。

#### 请求参数

无。

#### 成功响应

状态码：`200`

```json
{
  "ok": true
}
```

#### curl 示例

```bash
curl http://localhost:3000/health
```

## 内容生成

### `POST /api/generate`

接收用户输入内容，使用项目内置提示词调用 DeepSeek API，并返回最终生成内容。

服务默认关闭 DeepSeek 思考模式：

```json
{
  "thinking": {
    "type": "disabled"
  }
}
```

即使启用思考模式，接口也只返回 DeepSeek 响应中的 `message.content`，不会返回 `reasoning_content`。

#### 请求头

| 名称 | 必填 | 示例 | 说明 |
| --- | --- | --- | --- |
| `Content-Type` | 是 | `application/json` | 请求体格式 |

#### 请求体

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `content` | `string` | 是 | 用户输入内容，不能为空字符串 |

#### 请求示例

```json
{
  "content": "请把这段文字改写得更清晰：这个系统可以输入内容，然后返回内容。"
}
```

#### 成功响应

状态码：`200`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `content` | `string` | DeepSeek 返回的最终生成内容，已去除深度思考内容 |

响应示例：

```json
{
  "content": "该系统支持输入一段文本，并返回处理后的文本内容。"
}
```

#### 失败响应

请求参数错误：

状态码：`400`

```json
{
  "error": "Request body must include a non-empty string field: content"
}
```

DeepSeek API 调用失败：

状态码：取 DeepSeek API 返回的 HTTP 状态码，例如 `401`、`429`、`500`。

```json
{
  "error": "DeepSeek API 返回的错误信息"
}
```

服务内部错误：

状态码：`500`

```json
{
  "error": "Internal server error"
}
```

#### curl 示例

```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"请把这段文字改写得更清晰：这个系统可以输入内容，然后返回内容。\"}"
```

## 调用流程

1. 调用方向 `POST /api/generate` 发送 JSON 请求。
2. 服务读取请求体中的 `content`。
3. 服务拼接项目内置提示词和用户输入。
4. 服务调用 DeepSeek `/chat/completions` API。
5. 服务读取 DeepSeek 响应中的最终内容 `message.content`。
6. 服务清理可能残留的 `<think>`、`<thinking>` 或文本形式思考内容。
7. 服务返回：

```json
{
  "content": "最终内容"
}
```

## 注意事项

- API Key 不通过接口传入，只从环境变量 `DEEPSEEK_API_KEY` 读取。
- 请求体大小限制为 `1mb`。
- 当前接口不做用户鉴权，如需公网部署，应在网关或服务层增加鉴权。
- 当前接口为非流式响应，DeepSeek 请求参数中固定使用 `stream: false`。

## Iteration 1 Agent API

以下接口用于 LaTeX 论文 dry-run 任务。Iteration 1 默认不写回 `.tex` 文件，只生成修订草稿、任务事件和报告 artifact。

### `POST /api/workspaces/inspect`

检查 LaTeX 项目目录。

```json
{
  "projectDir": "tests/fixtures/latex-project"
}
```

响应包含 `.tex` 数量、`.bib` 数量、主文件候选和警告。

### `POST /api/workspaces/audit`

调用 `BypassAIGC-Skill` 的 `latex_project_audit.py`，返回完整审计结果，并创建一个审计任务记录。

### `POST /api/reports/upload`

上传报告 PDF。请求格式为 `multipart/form-data`，文件字段名为 `file`。

响应：

```json
{
  "fileId": "file_xxx",
  "filePath": "...",
  "sizeBytes": 12345,
  "sha256": "..."
}
```

### `GET /api/reports/:fileId/parse`

解析已上传 PDF，返回解析文本块和 finding 草稿。

### `POST /api/tasks`

创建 dry-run 任务。

```json
{
  "projectDir": "tests/fixtures/latex-project",
  "reportFileId": "file_xxx",
  "options": {
    "scope": "report_findings",
    "language": "auto",
    "revisionStrength": "medium",
    "applyMode": "dry_run",
    "compileMode": "none",
    "maxSegments": 3
  }
}
```

### `POST /api/tasks/:taskId/start`

同步启动 Iteration 1 dry-run。流程包括项目审计、报告解析、修订包生成、段落索引、风格诊断、finding 匹配、修订草稿生成和 dry-run 报告生成。

### `GET /api/tasks/:taskId`

查询任务快照。

### `GET /api/tasks/:taskId/steps`

查询任务步骤进度。

### `GET /api/tasks/:taskId/events?after=0`

查询任务事件，可用于 SSE 断线补齐。

### `GET /api/events/tasks/:taskId?after=0`

返回 `text/event-stream` 格式的任务事件流。

### `GET /api/tasks/:taskId/revisions`

查询 dry-run 生成的修订草稿。
