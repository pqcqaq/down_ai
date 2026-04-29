import { describe, expect, it } from "vitest";
import { generateContent } from "../../src/services/deepseekClient.js";
import { DeepSeekRevisionLlmClient } from "../../src/services/llmClient.js";

const shouldRun = process.env.RUN_LIVE_LLM_TESTS === "true" && Boolean(process.env.DEEPSEEK_API_KEY);

describe.skipIf(!shouldRun)("DeepSeek live API", () => {
  it("generates final content without exposed reasoning text", async () => {
    const content = await generateContent("请将这句话改得更清晰：本文设计了系统，并完成了实现。");

    expect(content.length).toBeGreaterThan(0);
    expect(content).not.toMatch(/<think>|<\/think>|reasoning_content|思考过程|推理过程/i);
  });

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
