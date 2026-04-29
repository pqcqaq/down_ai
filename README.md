# down-ai

一个 TypeScript + Express 服务：输入一段内容，调用 DeepSeek 官方 OpenAI 兼容的 `/chat/completions` API，并返回去除深度思考内容后的文本。

## 环境变量

复制 `.env.example` 为 `.env`，并填入 DeepSeek API Key：

```env
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_THINKING=disabled
DEEPSEEK_REASONING_EFFORT=high
PORT=3000
CORS_ORIGIN=*
```

- `DEEPSEEK_THINKING=disabled`：默认关闭思考模式，不让上游返回深度思考。
- `DEEPSEEK_THINKING=enabled`：启用思考模式时，服务仍只返回最终答案 `content`，不会返回 `reasoning_content`。
- `DEEPSEEK_REASONING_EFFORT`：仅在 `DEEPSEEK_THINKING=enabled` 时生效，可设为 `high` 或 `max`。

DeepSeek 官方文档参考：

- https://api-docs.deepseek.com/zh-cn/
- https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/
- https://api-docs.deepseek.com/zh-cn/guides/thinking_mode

## 安装与运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm start
```

## 接口

### `POST /api/generate`

请求：

```json
{
  "content": "请把这段文字改写得更清晰"
}
```

响应：

```json
{
  "content": "改写后的内容"
}
```

### `GET /health`

返回服务健康状态。
