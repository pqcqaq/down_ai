import { PDFParse } from "pdf-parse";
import { createId } from "../utils/id.js";
import { normalizeText, splitTextBlocks } from "./textNormalize.js";
import type { ParsedDocument, ReportFindingDraft } from "./types.js";

export class PdfParser {
  async parse(buffer: Buffer): Promise<ParsedDocument> {
    const parser = new PDFParse({ data: buffer });
    try {
      const [textResult, infoResult] = await Promise.all([
        parser.getText(),
        parser.getInfo().catch(() => undefined),
      ]);
      const blocks = splitTextBlocks(textResult.text).map((text) => ({
        id: createId("block"),
        text,
        normalizedText: normalizeText(text),
      }));

      return {
        id: createId("parsed"),
        kind: "pdf",
        metadata: {
          totalPages: infoResult?.total,
          info: infoResult?.info,
        },
        textBlocks: blocks,
        warnings: blocks.length === 0 ? ["PDF 文本为空，可能需要 OCR 或人工输入。"] : [],
      };
    } finally {
      await parser.destroy();
    }
  }

  toFindings(document: ParsedDocument): ReportFindingDraft[] {
    return document.textBlocks.slice(0, 200).map((block) => ({
      rawText: block.text,
      normalizedText: block.normalizedText,
      riskType: "report_text",
      severity: "medium",
      confidence: 0.7,
      source: "pdf",
    }));
  }
}
