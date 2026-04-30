import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { taskOptionsSchema } from "../src/domain/schemas.js";
import { createDatabase, type DatabaseHandle } from "../src/storage/db.js";
import { TaskOrchestrator } from "../src/services/taskOrchestrator.js";
import { TaskProgressService } from "../src/services/taskProgressService.js";
import { createPdfBuffer } from "./helpers/pdf.js";

const testDir = path.resolve(".down-ai-test");
let handle: DatabaseHandle;

beforeEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });
  handle = createDatabase(path.join(testDir, "orchestrator.sqlite"));
});

afterEach(() => {
  handle.sqlite.close();
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("TaskOrchestrator", () => {
  it("runs a dry-run task with SkillRuntime and mock LLM", async () => {
    const progress = new TaskProgressService(handle);
    const task = progress.createTask({
      projectDir: path.resolve("tests/fixtures/latex-project"),
      options: taskOptionsSchema.parse({ maxSegments: 2 }),
    });

    await new TaskOrchestrator(handle).runDryRun(task.id);

    const completed = progress.getTask(task.id);
    expect(completed?.state).toBe("completed");

    const revisions = handle.sqlite.prepare("SELECT COUNT(*) AS count FROM revisions WHERE task_id = ?").get(task.id) as {
      count: number;
    };
    expect(revisions.count).toBeGreaterThan(0);
  });

  it("selects a content-bearing input file when root candidates only include wrappers", async () => {
    const progress = new TaskProgressService(handle);
    const task = progress.createTask({
      projectDir: path.resolve("tests/fixtures/input-project"),
      options: taskOptionsSchema.parse({ maxSegments: 2 }),
    });

    await new TaskOrchestrator(handle).runDryRun(task.id);

    const segments = handle.sqlite
      .prepare("SELECT COUNT(*) AS count, MIN(file_path) AS filePath FROM latex_segments WHERE task_id = ?")
      .get(task.id) as { count: number; filePath: string };
    const revisions = handle.sqlite.prepare("SELECT COUNT(*) AS count FROM revisions WHERE task_id = ?").get(task.id) as {
      count: number;
    };

    expect(segments.count).toBeGreaterThan(0);
    expect(segments.filePath).toContain(path.join("chapters", "body.tex"));
    expect(revisions.count).toBeGreaterThan(0);
  });

  it("processes every available segment when no safety limit is configured", async () => {
    const progress = new TaskProgressService(handle);
    const task = progress.createTask({
      projectDir: path.resolve("tests/fixtures/realistic-thesis"),
      options: taskOptionsSchema.parse({}),
    });

    await new TaskOrchestrator(handle).runDryRun(task.id);

    const segments = handle.sqlite.prepare("SELECT COUNT(*) AS count FROM latex_segments WHERE task_id = ?").get(task.id) as {
      count: number;
    };
    const revisions = handle.sqlite.prepare("SELECT COUNT(*) AS count FROM revisions WHERE task_id = ?").get(task.id) as {
      count: number;
    };

    expect(task.options.maxSegments).toBeNull();
    expect(segments.count).toBeGreaterThan(1);
    expect(revisions.count).toBe(segments.count);
  });

  it("globally locates report findings in included chapter files before rewriting", async () => {
    const reportFileId = "file_global_search";
    const reportPath = path.join(testDir, "global-search-report.pdf");
    const reportText =
      "This study aims to provide a comprehensive analysis of the proposed revision workflow. The workflow plays an important role in improving document quality and provides a complete solution for academic writing scenarios.";
    fs.writeFileSync(reportPath, await createPdfBuffer([reportText]));
    handle.sqlite
      .prepare(
        `INSERT INTO report_files
          (id, task_id, original_name, mime_type, file_path, size_bytes, sha256, page_count, parse_status, created_at)
         VALUES (@id, NULL, 'global-search-report.pdf', 'application/pdf', @filePath, @sizeBytes, 'test-sha', NULL, 'uploaded', @createdAt)`,
      )
      .run({
        id: reportFileId,
        filePath: reportPath,
        sizeBytes: fs.statSync(reportPath).size,
        createdAt: new Date().toISOString(),
      });

    const progress = new TaskProgressService(handle);
    const task = progress.createTask({
      projectDir: path.resolve("tests/fixtures/global-search-project"),
      reportFileId,
      options: taskOptionsSchema.parse({}),
    });

    await new TaskOrchestrator(handle).runDryRun(task.id);

    const revisions = handle.sqlite
      .prepare(
        `SELECT r.original_text AS originalText, r.revised_text AS revisedText, s.file_path AS filePath
         FROM revisions r
         JOIN latex_segments s ON s.id = r.segment_id
         WHERE r.task_id = ?
         ORDER BY r.created_at ASC`,
      )
      .all(task.id) as Array<{ originalText: string; revisedText: string; filePath: string }>;
    const matches = handle.sqlite.prepare("SELECT COUNT(*) AS count FROM finding_matches WHERE task_id = ?").get(task.id) as {
      count: number;
    };

    expect(matches.count).toBeGreaterThan(0);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].filePath).toContain(path.join("chapters", "target.tex"));
    expect(revisions[0].originalText).toContain("This study aims to provide a comprehensive analysis");
    expect(revisions[0].revisedText).toContain("This study examines");
  });
});
