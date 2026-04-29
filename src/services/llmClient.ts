import { env } from "../config/env.js";
import { revisionDecisionSchema, type RevisionDecision } from "../domain/schemas.js";
import type { TaskStepKey } from "../domain/taskSteps.js";
import { stripReasoningContent } from "./deepseekClient.js";
import { AgentRunRecorder } from "./agentRunRecorder.js";

type GenerateRevisionInput = {
  taskId?: string;
  stepKey?: TaskStepKey;
  segmentId: string;
  originalText: string;
  prompt?: string;
};

export interface RevisionLlmClient {
  generateRevisionDecision(input: GenerateRevisionInput): Promise<RevisionDecision>;
}

export class MockRevisionLlmClient implements RevisionLlmClient {
  async generateRevisionDecision(input: GenerateRevisionInput): Promise<RevisionDecision> {
    const revisedText = input.originalText
      .replace(/本文/g, "本研究")
      .replace(/进行了/g, "完成了")
      .replace(/系统首先/g, "流程首先")
      .replace(/最后/g, "随后")
      .replace(/该过程/g, "这一过程")
      .replace(/具有重要意义/g, "为后续分析提供了更明确的依据")
      .trim();

    return revisionDecisionSchema.parse({
      segmentId: input.segmentId,
      action: revisedText === input.originalText ? "keep" : "revise",
      revisedText,
      revisionNote: "mock 修订：压缩泛化表达并保持原有 LaTeX token。",
      riskFlags: [],
      confidence: 0.72,
    });
  }
}

export class DeepSeekRevisionLlmClient implements RevisionLlmClient {
  private readonly recorder = new AgentRunRecorder();

  async generateRevisionDecision(input: GenerateRevisionInput): Promise<RevisionDecision> {
    if (!env.deepseekApiKey) {
      throw new Error("DEEPSEEK_API_KEY is required when USE_LIVE_LLM=true.");
    }

    const prompt = input.prompt || this.buildPrompt(input.originalText);
    const runId = this.recorder.start({
      taskId: input.taskId,
      stepKey: input.stepKey,
      agentName: "revision_writer",
      prompt,
      inputSummary: {
        segmentId: input.segmentId,
        originalLength: input.originalText.length,
      },
    });

    try {
      const response = await fetch(`${env.deepseekBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.deepseekApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.deepseekModel,
          messages: [
            {
              role: "system",
              content: [
                "你是保守的 LaTeX 学术文本修订助手。",
                "只输出 JSON，不要 Markdown，不要解释过程。",
                "必须保留所有 LaTeX 命令、公式、引用、label 和环境。",
                "不要新增事实、数据、文献或扩大结论强度。",
              ].join("\n"),
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          thinking: {
            type: "disabled",
          },
          response_format: {
            type: "json_object",
          },
          stream: false,
        }),
      });

      const payload = (await response.json().catch(() => null)) as {
        choices?: Array<{ message?: { content?: string | null; reasoning_content?: string } }>;
        usage?: unknown;
        error?: { message?: string };
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error?.message || `DeepSeek API request failed with status ${response.status}`);
      }

      const raw = stripReasoningContent(payload?.choices?.[0]?.message?.content || "");
      const parsed = revisionDecisionSchema.parse({
        ...JSON.parse(raw),
        segmentId: input.segmentId,
      });
      this.recorder.complete(runId, parsed, payload?.usage);
      return parsed;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.recorder.fail(runId, err);
      throw err;
    }
  }

  private buildPrompt(originalText: string): string {
    return JSON.stringify({
      task: "revise_latex_academic_prose",
      outputSchema: {
        segmentId: "string",
        action: "keep | revise | needs_review",
        revisedText: "string | optional",
        revisionNote: "string",
        riskFlags: "string[]",
        confidence: "number 0..1",
      },
      originalText,
    });
  }
}

export function createRevisionLlmClient(): RevisionLlmClient {
  return env.useLiveLlm ? new DeepSeekRevisionLlmClient() : new MockRevisionLlmClient();
}
