import fs from "node:fs/promises";
import type { DatabaseHandle } from "../storage/db.js";
import { getDatabase } from "../storage/db.js";

export type ReportFileRecord = {
  id: string;
  taskId?: string;
  originalName: string;
  mimeType: string;
  filePath: string;
  sizeBytes: number;
  sha256: string;
  pageCount?: number;
  parseStatus: string;
  createdAt: string;
};

export class ReportFileService {
  constructor(private readonly handle: DatabaseHandle = getDatabase()) {}

  getReportFile(fileId: string): ReportFileRecord | undefined {
    const row = this.handle.sqlite.prepare("SELECT * FROM report_files WHERE id = ?").get(fileId) as
      | Record<string, unknown>
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: String(row.id),
      taskId: row.task_id ? String(row.task_id) : undefined,
      originalName: String(row.original_name),
      mimeType: String(row.mime_type),
      filePath: String(row.file_path),
      sizeBytes: Number(row.size_bytes),
      sha256: String(row.sha256),
      pageCount: row.page_count == null ? undefined : Number(row.page_count),
      parseStatus: String(row.parse_status),
      createdAt: String(row.created_at),
    };
  }

  async readReportBuffer(fileId: string): Promise<Buffer> {
    const report = this.getReportFile(fileId);
    if (!report) {
      throw new Error(`Report file not found: ${fileId}`);
    }

    return fs.readFile(report.filePath);
  }

  markParsed(fileId: string, pageCount?: number): void {
    this.handle.sqlite
      .prepare("UPDATE report_files SET parse_status = 'parsed', page_count = COALESCE(?, page_count) WHERE id = ?")
      .run(pageCount ?? null, fileId);
  }
}
