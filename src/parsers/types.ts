export type ParsedTextBlock = {
  id: string;
  page?: number;
  text: string;
  normalizedText: string;
};

export type ParsedDocument = {
  id: string;
  kind: "pdf" | "latex" | "bibtex" | "markdown" | "docx" | "log" | "archive";
  metadata: Record<string, unknown>;
  textBlocks: ParsedTextBlock[];
  warnings: string[];
};

export type ReportFindingDraft = {
  page?: number;
  rawText: string;
  normalizedText: string;
  riskType: string;
  severity: "low" | "medium" | "high";
  confidence: number;
  source: "pdf" | "manual" | "style_lint";
};
