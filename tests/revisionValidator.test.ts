import { describe, expect, it } from "vitest";
import { validateRevisionText } from "../src/services/revisionValidator.js";

describe("validateRevisionText", () => {
  it("passes when protected LaTeX tokens are preserved", () => {
    const original = "本文说明方法 \\cite{smith2024}，见图 \\ref{fig:arch}。";
    const revised = "本研究说明该方法的处理流程 \\cite{smith2024}，见图 \\ref{fig:arch}。";

    const result = validateRevisionText(original, revised);

    expect(result.protectedTokenOk).toBe(true);
    expect(result.warnings).not.toContain("protected-token-drift");
  });

  it("warns when protected LaTeX tokens drift", () => {
    const result = validateRevisionText("本文说明方法 \\cite{smith2024}。", "本研究说明方法。");

    expect(result.protectedTokenOk).toBe(false);
    expect(result.warnings).toContain("protected-token-drift");
  });
});
