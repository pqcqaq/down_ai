import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { createId } from "../utils/id.js";
import type { DatabaseHandle } from "./db.js";
import { getDatabase } from "./db.js";

export type StoredArtifact = {
  id: string;
  taskId?: string;
  kind: string;
  filePath: string;
  sha256: string;
  sizeBytes: number;
};

export class ArtifactStore {
  constructor(private readonly handle: DatabaseHandle = getDatabase()) {}

  getTaskDir(taskId: string): string {
    return path.resolve(env.dataDir, "tasks", taskId);
  }

  getTaskArtifactDir(taskId: string): string {
    return path.join(this.getTaskDir(taskId), "artifacts");
  }

  getUploadDir(): string {
    return path.resolve(env.dataDir, "uploads");
  }

  async writeJson(taskId: string, kind: string, filename: string, value: unknown): Promise<StoredArtifact> {
    const filePath = path.join(this.getTaskArtifactDir(taskId), filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    return this.recordFile({ taskId, kind, filePath, mimeType: "application/json" });
  }

  async writeText(taskId: string, kind: string, filename: string, value: string): Promise<StoredArtifact> {
    const filePath = path.join(this.getTaskArtifactDir(taskId), filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, value, "utf8");
    return this.recordFile({ taskId, kind, filePath, mimeType: "text/plain" });
  }

  async saveUpload(file: Express.Multer.File): Promise<StoredArtifact> {
    const id = createId("file");
    const extension = path.extname(file.originalname) || ".bin";
    const filePath = path.join(this.getUploadDir(), `${id}${extension}`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.buffer);
    return this.recordReportFile({
      id,
      originalName: file.originalname,
      mimeType: file.mimetype || "application/octet-stream",
      filePath,
    });
  }

  async recordFile(input: {
    taskId?: string;
    kind: string;
    filePath: string;
    mimeType?: string;
  }): Promise<StoredArtifact> {
    const buffer = await fs.readFile(input.filePath);
    const artifact: StoredArtifact = {
      id: createId("artifact"),
      taskId: input.taskId,
      kind: input.kind,
      filePath: path.resolve(input.filePath),
      sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      sizeBytes: buffer.byteLength,
    };

    this.handle.sqlite
      .prepare(
        `INSERT INTO artifacts
          (id, task_id, kind, file_path, mime_type, sha256, size_bytes, created_at)
          VALUES (@id, @taskId, @kind, @filePath, @mimeType, @sha256, @sizeBytes, @createdAt)`,
      )
      .run({
        ...artifact,
        mimeType: input.mimeType ?? null,
        createdAt: new Date().toISOString(),
      });

    return artifact;
  }

  private async recordReportFile(input: {
    id: string;
    originalName: string;
    mimeType: string;
    filePath: string;
  }): Promise<StoredArtifact> {
    const buffer = await fs.readFile(input.filePath);
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const sizeBytes = buffer.byteLength;

    this.handle.sqlite
      .prepare(
        `INSERT INTO report_files
          (id, task_id, original_name, mime_type, file_path, size_bytes, sha256, page_count, parse_status, created_at)
          VALUES (@id, NULL, @originalName, @mimeType, @filePath, @sizeBytes, @sha256, NULL, 'uploaded', @createdAt)`,
      )
      .run({
        id: input.id,
        originalName: input.originalName,
        mimeType: input.mimeType,
        filePath: path.resolve(input.filePath),
        sizeBytes,
        sha256,
        createdAt: new Date().toISOString(),
      });

    return {
      id: input.id,
      kind: "report_upload",
      filePath: path.resolve(input.filePath),
      sha256,
      sizeBytes,
    };
  }
}
