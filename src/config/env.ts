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

function readUseLiveLlm(apiKey: string): boolean {
  const value = process.env.USE_LIVE_LLM?.trim();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return Boolean(apiKey);
}

const deepseekApiKey = process.env.DEEPSEEK_API_KEY?.trim() || "";

export const env = {
  deepseekApiKey,
  deepseekModel: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-pro",
  deepseekBaseUrl: normalizeBaseUrl(
    process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
  ),
  deepseekThinking: readThinkingMode(),
  deepseekReasoningEffort: readReasoningEffort(),
  useLiveLlm: readUseLiveLlm(deepseekApiKey),
  runLiveLlmTests: process.env.RUN_LIVE_LLM_TESTS?.trim() === "true",
  skillDir: process.env.BYPASS_AIGC_SKILL_DIR?.trim() || "../BypassAIGC-Skill",
  pythonBin: process.env.PYTHON_BIN?.trim() || "python",
  dataDir: process.env.DOWN_AI_DATA_DIR?.trim() || ".down-ai",
  workspaceRoot: process.env.WORKSPACE_ROOT?.trim() || "..",
  port: Number(process.env.PORT || 3000),
  corsOrigin: process.env.CORS_ORIGIN?.trim() || "*",
};
