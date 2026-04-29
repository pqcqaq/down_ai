import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { taskOptionsSchema } from "../src/domain/schemas.js";
import { createDatabase, type DatabaseHandle } from "../src/storage/db.js";
import { TaskProgressService } from "../src/services/taskProgressService.js";

const testDir = path.resolve(".down-ai-test-recovery");
let handle: DatabaseHandle;

beforeEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });
  handle = createDatabase(path.join(testDir, "recovery.sqlite"));
});

afterEach(() => {
  handle.sqlite.close();
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("task recovery", () => {
  it("marks running tasks as paused_for_recovery", () => {
    const progress = new TaskProgressService(handle);
    const task = progress.createTask({
      projectDir: path.resolve("tests/fixtures/latex-project"),
      options: taskOptionsSchema.parse({}),
    });
    progress.markTaskRunning(task.id);

    const recovered = progress.recoverInterruptedTasks();

    expect(recovered).toBe(1);
    expect(progress.getTask(task.id)?.state).toBe("paused_for_recovery");
    expect(progress.listEvents(task.id).map((event) => event.type)).toContain("task_recovery_required");
  });
});
