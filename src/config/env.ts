import dotenv from "dotenv";

dotenv.config();

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function readThinkingMode(): "enabled" | "disabled" {
  const value = process.env.DEEPSEEK_THINKING?.trim() || "disabled";

  if (value !== "enabled" && value !== "disabled") {
    throw new Error("DEEPSEEK_THINKING must be either enabled or disabled.");
  }

  return value;
}

function readReasoningEffort(): "high" | "max" {
  const value = process.env.DEEPSEEK_REASONING_EFFORT?.trim() || "high";

  if (value !== "high" && value !== "max") {
    throw new Error("DEEPSEEK_REASONING_EFFORT must be either high or max.");
  }

  return value;
}

export const env = {
  deepseekApiKey: readRequiredEnv("DEEPSEEK_API_KEY"),
  deepseekModel: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-pro",
  deepseekBaseUrl: normalizeBaseUrl(
    process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
  ),
  deepseekThinking: readThinkingMode(),
  deepseekReasoningEffort: readReasoningEffort(),
  port: Number(process.env.PORT || 3000),
  corsOrigin: process.env.CORS_ORIGIN?.trim() || "*",
};
