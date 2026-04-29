import type { ParsedDocument } from "./types.js";
import { PdfParser } from "./pdfParser.js";

export class ParserRegistry {
  private readonly pdfParser = new PdfParser();

  async parsePdf(buffer: Buffer): Promise<ParsedDocument> {
    return this.pdfParser.parse(buffer);
  }

  getPdfParser(): PdfParser {
    return this.pdfParser;
  }
}
