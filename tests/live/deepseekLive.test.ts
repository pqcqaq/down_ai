import { describe, expect, it } from "vitest";
import { DeepSeekRevisionLlmClient } from "../../src/services/llmClient.js";

const shouldRun = process.env.RUN_LIVE_LLM_TESTS === "true" && Boolean(process.env.DEEPSEEK_API_KEY);

describe.skipIf(!shouldRun)("DeepSeek live API", () => {
  it("returns a structured revision decision without drifting protected tokens", async () => {
    const client = new DeepSeekRevisionLlmClient();
    const decision = await client.generateRevisionDecision({
      segmentId: "live_segment",
      originalText:
        "本文基于已有方法完成系统设计，并通过实验验证其有效性 \\cite{smith2024}。如图 \\ref{fig:arch} 所示，系统包含三个模块。",
    });

    expect(["keep", "revise", "needs_review"]).toContain(decision.action);
    expect(decision.segmentId).toBe("live_segment");
    if (decision.revisedText) {
      expect(decision.revisedText).toContain("\\cite{smith2024}");
      expect(decision.revisedText).toContain("\\ref{fig:arch}");
      expect(decision.revisedText).not.toContain("```");
    }
  });
});
