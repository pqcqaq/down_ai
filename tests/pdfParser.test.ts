import { describe, expect, it } from "vitest";
import { PdfParser } from "../src/parsers/pdfParser.js";
import type { ParsedDocument } from "../src/parsers/types.js";
import { createPdfBuffer } from "./helpers/pdf.js";

describe("PdfParser", () => {
  it("extracts text blocks from a generated review report PDF", async () => {
    const buffer = await createPdfBuffer([
      "This study aims to provide a comprehensive analysis of the proposed revision workflow.",
      "The workflow plays an important role in improving document quality.",
    ]);

    const parsed = await new PdfParser().parse(buffer);

    expect(parsed.kind).toBe("pdf");
    expect(parsed.textBlocks.length).toBeGreaterThan(0);
    expect(parsed.textBlocks.map((block) => block.text).join("\n")).toContain("proposed revision workflow");
  });

  it("keeps all extracted report findings instead of truncating at 200", () => {
    const document: ParsedDocument = {
      id: "parsed_all_findings",
      kind: "pdf",
      metadata: {},
      textBlocks: Array.from({ length: 225 }, (_, index) => ({
        id: `block_${index}`,
        text: `疑似 AIGC 风险段落 ${index}：这是一段需要进入后续匹配流程的检测报告内容。`,
        normalizedText: `疑似aigc风险段落${index}这是一段需要进入后续匹配流程的检测报告内容`,
      })),
      warnings: [],
    };

    expect(new PdfParser().toFindings(document)).toHaveLength(225);
  });
});
