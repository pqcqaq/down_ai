import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { taskOptionsSchema } from "../src/domain/schemas.js";
import { createDatabase, type DatabaseHandle } from "../src/storage/db.js";
import { TaskOrchestrator } from "../src/services/taskOrchestrator.js";
import { TaskProgressService } from "../src/services/taskProgressService.js";

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
});
