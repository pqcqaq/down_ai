import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { taskOptionsSchema } from "../src/domain/schemas.js";
import { createDatabase, type DatabaseHandle } from "../src/storage/db.js";
import { TaskProgressService } from "../src/services/taskProgressService.js";

const testDir = path.resolve(".down-ai-test");
let handle: DatabaseHandle;

beforeEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });
  handle = createDatabase(path.join(testDir, "progress.sqlite"));
});

afterEach(() => {
  handle.sqlite.close();
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("TaskProgressService", () => {
  it("records task steps and resumable events", () => {
    const service = new TaskProgressService(handle);
    const task = service.createTask({
      projectDir: path.resolve("tests/fixtures/latex-project"),
      options: taskOptionsSchema.parse({}),
    });

    service.markTaskRunning(task.id);
    service.startStep(task.id, "audit_project");
    service.stepProgress(task.id, "audit_project", 1, 2, "halfway");
    service.completeStep(task.id, "audit_project");

    const events = service.listEvents(task.id);
    expect(events.map((event) => event.type)).toContain("step_completed");

    const lastSequence = events[events.length - 1]?.sequence ?? 0;
    expect(service.listEvents(task.id, lastSequence)).toEqual([]);

    const steps = service.listSteps(task.id);
    expect(steps.find((step) => step.stepKey === "audit_project")?.status).toBe("completed");
  });
});
