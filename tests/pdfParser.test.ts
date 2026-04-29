import { describe, expect, it } from "vitest";
import { PdfParser } from "../src/parsers/pdfParser.js";
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
});
