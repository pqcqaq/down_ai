import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import type { TaskStepKey } from "../domain/taskSteps.js";
import { createId } from "../utils/id.js";
import { parseJson, stringifyJson } from "../utils/json.js";
import { ArtifactStore } from "../storage/artifactStore.js";
import type { DatabaseHandle } from "../storage/db.js";
import { getDatabase } from "../storage/db.js";
import { SkillRuntime } from "../tools/skillRuntime.js";
import { validateRevisionText } from "./revisionValidator.js";

type RevisionRow = {
  id: string;
  task_id: string;
  segment_id: string;
  original_text: string;
  revised_text: string | null;
  status: string;
  revision_note: string;
};

type SegmentRow = {
  id: string;
  file_path: string;
  packet_index: number | null;
};

type ApplyJournalEntry = {
  filePath: string;
  backupPath: string;
  beforeHash: string;
  afterHash: string;
  patchPath: string;
  appliedRevisionIds: string[];
  appliedAt: string;
};

export class RevisionApplyService {
  private readonly artifactStore: ArtifactStore;
  private readonly skillRuntime: SkillRuntime;

  constructor(private readonly handle: DatabaseHandle = getDatabase()) {
    this.artifactStore = new ArtifactStore(handle);
    this.skillRuntime = new SkillRuntime(handle);
  }

  approveRevision(taskId: string, revisionId: string): void {
    this.updateRevisionStatus(taskId, revisionId, "approved");
  }

  rejectRevision(taskId: string, revisionId: string): void {
    this.updateRevisionStatus(taskId, revisionId, "rejected");
  }

  editRevision(taskId: string, revisionId: string, revisedText: string, revisionNote?: string): void {
    const row = this.getRevision(taskId, revisionId);
    const validation = validateRevisionText(row.original_text, revisedText);
    const riskFlags = validation.warnings;

    this.handle.sqlite
      .prepare(
        `UPDATE revisions
         SET revised_text = @revisedText, revision_note = COALESCE(@revisionNote, revision_note),
             status = 'draft', risk_flags_json = @riskFlagsJson, updated_at = @updatedAt
         WHERE task_id = @taskId AND id = @revisionId`,
      )
      .run({
        taskId,
        revisionId,
        revisedText,
        revisionNote: revisionNote ?? null,
        riskFlagsJson: stringifyJson(riskFlags),
        updatedAt: new Date().toISOString(),
      });
  }

  async applyApproved(taskId: string, stepKey?: TaskStepKey): Promise<{ appliedFiles: number; journal: ApplyJournalEntry[] }> {
    const rows = this.handle.sqlite
      .prepare(
        `SELECT r.*, s.file_path, s.packet_index
         FROM revisions r
         JOIN latex_segments s ON s.id = r.segment_id
         WHERE r.task_id = ? AND r.status = 'approved' AND r.revised_text IS NOT NULL
         ORDER BY s.file_path, s.packet_index`,
      )
      .all(taskId) as Array<RevisionRow & SegmentRow>;

    const byFile = new Map<string, Array<RevisionRow & SegmentRow>>();
    for (const row of rows) {
      if (row.packet_index == null) {
        continue;
      }
      const list = byFile.get(row.file_path) ?? [];
      list.push(row);
      byFile.set(row.file_path, list);
    }

    const journal: ApplyJournalEntry[] = [];

    for (const [filePath, revisions] of byFile) {
      const packetPath = await this.createApplyPacket(taskId, filePath, revisions);
      const original = await fs.readFile(filePath, "utf8");
      const beforeHash = sha256(original);
      const backupPath = await this.createBackup(taskId, filePath, original);
      const tempOut = path.join(this.artifactStore.getTaskArtifactDir(taskId), `${path.basename(filePath)}.applied.tex`);

      await this.skillRuntime.lintRevisionPacket({ taskId, packetPath, stepKey });
      await this.skillRuntime.applySegmentRevisions({
        taskId,
        sourceTex: filePath,
        packetPath,
        outTex: tempOut,
        stepKey,
      });

      const revised = await fs.readFile(tempOut, "utf8");
      const patch = createTwoFilesPatch(filePath, filePath, original, revised, "original", "revised");
      const patchPath = path.join(this.artifactStore.getTaskArtifactDir(taskId), `${path.basename(filePath)}.patch`);
      await fs.writeFile(patchPath, patch, "utf8");
      await fs.writeFile(filePath, revised, "utf8");

      const entry: ApplyJournalEntry = {
        filePath,
        backupPath,
        beforeHash,
        afterHash: sha256(revised),
        patchPath,
        appliedRevisionIds: revisions.map((item) => item.id),
        appliedAt: new Date().toISOString(),
      };
      journal.push(entry);

      this.handle.sqlite
        .prepare(`UPDATE revisions SET status = 'applied', updated_at = ? WHERE id IN (${revisions.map(() => "?").join(",")})`)
        .run(new Date().toISOString(), ...revisions.map((item) => item.id));
      await this.artifactStore.recordFile({ taskId, kind: "patch", filePath: patchPath, mimeType: "text/x-diff" });
    }

    await this.artifactStore.writeJson(taskId, "apply_journal", "apply-journal.json", journal);
    return { appliedFiles: journal.length, journal };
  }

  async rollback(taskId: string): Promise<{ rolledBackFiles: number }> {
    const journalPath = path.join(this.artifactStore.getTaskArtifactDir(taskId), "apply-journal.json");
    const entries = parseJson<ApplyJournalEntry[]>(await fs.readFile(journalPath, "utf8"), []);
    let rolledBackFiles = 0;

    for (const entry of [...entries].reverse()) {
      const current = await fs.readFile(entry.filePath, "utf8");
      if (sha256(current) !== entry.afterHash) {
        throw new Error(`Cannot rollback because file changed after apply: ${entry.filePath}`);
      }
      await fs.copyFile(entry.backupPath, entry.filePath);
      rolledBackFiles += 1;
      this.handle.sqlite
        .prepare(`UPDATE revisions SET status = 'approved', updated_at = ? WHERE id IN (${entry.appliedRevisionIds.map(() => "?").join(",")})`)
        .run(new Date().toISOString(), ...entry.appliedRevisionIds);
    }

    return { rolledBackFiles };
  }

  private updateRevisionStatus(taskId: string, revisionId: string, status: string): void {
    this.handle.sqlite
      .prepare("UPDATE revisions SET status = @status, updated_at = @updatedAt WHERE task_id = @taskId AND id = @revisionId")
      .run({
        taskId,
        revisionId,
        status,
        updatedAt: new Date().toISOString(),
      });
  }

  private getRevision(taskId: string, revisionId: string): RevisionRow {
    const row = this.handle.sqlite
      .prepare("SELECT * FROM revisions WHERE task_id = ? AND id = ?")
      .get(taskId, revisionId) as RevisionRow | undefined;
    if (!row) {
      throw new Error(`Revision not found: ${revisionId}`);
    }
    return row;
  }

  private async createApplyPacket(
    taskId: string,
    filePath: string,
    revisions: Array<RevisionRow & SegmentRow>,
  ): Promise<string> {
    const packetPath = path.join(this.artifactStore.getTaskArtifactDir(taskId), "revision-packet.json");
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8")) as {
      source_file: string;
      segments: Array<{ index: number; revised_text: string; revision_note: string }>;
    };

    if (path.resolve(packet.source_file) !== path.resolve(filePath)) {
      throw new Error(`Revision packet source does not match file: ${filePath}`);
    }

    const byIndex = new Map(revisions.map((row) => [row.packet_index, row]));
    packet.segments = packet.segments.map((segment) => {
      const revision = byIndex.get(segment.index);
      if (!revision) {
        return {
          ...segment,
          revised_text: "",
          revision_note: "",
        };
      }
      return {
        ...segment,
        revised_text: revision.revised_text ?? "",
        revision_note: revision.revision_note,
      };
    });

    const outPath = path.join(this.artifactStore.getTaskArtifactDir(taskId), "revision-packet.apply.json");
    await fs.writeFile(outPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
    await this.artifactStore.recordFile({ taskId, kind: "apply_packet", filePath: outPath, mimeType: "application/json" });
    return outPath;
  }

  private async createBackup(taskId: string, filePath: string, content: string): Promise<string> {
    const backupDir = path.join(this.artifactStore.getTaskDir(taskId), "backups");
    await fs.mkdir(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `${createId("backup")}-${path.basename(filePath)}`);
    await fs.writeFile(backupPath, content, "utf8");
    await this.artifactStore.recordFile({ taskId, kind: "backup", filePath: backupPath, mimeType: "text/x-tex" });
    return backupPath;
  }
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
