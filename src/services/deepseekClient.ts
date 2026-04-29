import { env } from "../config/env.js";
import { builtinPrompt } from "../prompts/builtinPrompt.js";

type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string | null;
  reasoning_content?: string;
};

type DeepSeekChatRequest = {
  model: string;
  messages: Array<{
    role: "system" | "user";
    content: string;
  }>;
  thinking: {
    type: "enabled" | "disabled";
  };
  reasoning_effort?: "high" | "max";
  stream: false;
};

type DeepSeekChatResponse = {
  choices?: Array<{
    message?: DeepSeekMessage;
  }>;
  error?: {
    message?: string;
    type?: string;
  };
};

function createRequestBody(content: string): DeepSeekChatRequest {
  return {
    model: env.deepseekModel,
    messages: [
      {
        role: "system",
        content: builtinPrompt,
      },
      {
        role: "user",
        content,
      },
    ],
    thinking: {
      type: env.deepseekThinking,
    },
    ...(env.deepseekThinking === "enabled"
      ? {
          reasoning_effort: env.deepseekReasoningEffort,
        }
      : {}),
    stream: false,
  };
}

export class DeepSeekError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 502,
  ) {
    super(message);
    this.name = "DeepSeekError";
  }
}

export async function generateContent(content: string): Promise<string> {
  if (!env.deepseekApiKey) {
    throw new DeepSeekError("Missing required environment variable: DEEPSEEK_API_KEY", 500);
  }

  const response = await fetch(`${env.deepseekBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.deepseekApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createRequestBody(content)),
  });

  const payload = (await response.json().catch(() => null)) as DeepSeekChatResponse | null;

  if (!response.ok) {
    const message = payload?.error?.message || `DeepSeek API request failed with status ${response.status}`;
    throw new DeepSeekError(message, response.status);
  }

  const message = payload?.choices?.[0]?.message;
  const answer = message?.content;

  if (!answer) {
    throw new DeepSeekError("DeepSeek API returned an empty response.");
  }

  return stripReasoningContent(answer);
}

export function stripReasoningContent(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/^\s*(?:思考过程|深度思考|推理过程|Reasoning|Thinking)\s*[:：][\s\S]*?(?=\n\s*(?:最终答案|答案|Final Answer)\s*[:：]|\n{2,}|$)/i, "")
    .replace(/^\s*(?:最终答案|答案|Final Answer)\s*[:：]\s*/i, "")
    .trim();
}
