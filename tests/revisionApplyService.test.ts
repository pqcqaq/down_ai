import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { taskOptionsSchema } from "../src/domain/schemas.js";
import { createDatabase, type DatabaseHandle } from "../src/storage/db.js";
import { RevisionApplyService } from "../src/services/revisionApplyService.js";
import { TaskOrchestrator } from "../src/services/taskOrchestrator.js";
import { TaskProgressService } from "../src/services/taskProgressService.js";

const testDir = path.resolve("tmp-down-ai-test-apply");
let handle: DatabaseHandle;

beforeEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });
  fs.cpSync(path.resolve("tests/fixtures/latex-project"), path.join(testDir, "project"), { recursive: true });
  handle = createDatabase(path.join(testDir, "apply.sqlite"));
});

afterEach(() => {
  handle.sqlite.close();
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("RevisionApplyService", () => {
  it("applies approved revisions and rolls them back by journal", async () => {
    const projectDir = path.join(testDir, "project");
    const mainTex = path.join(projectDir, "main.tex");
    const before = fs.readFileSync(mainTex, "utf8");
    const beforeHash = sha256(before);

    const progress = new TaskProgressService(handle);
    const task = progress.createTask({
      projectDir,
      options: taskOptionsSchema.parse({ maxSegments: 1 }),
    });
    await new TaskOrchestrator(handle).runDryRun(task.id);

    const revision = handle.sqlite
      .prepare("SELECT id FROM revisions WHERE task_id = ? LIMIT 1")
      .get(task.id) as { id: string };

    const service = new RevisionApplyService(handle);
    service.approveRevision(task.id, revision.id);
    const applied = await service.applyApproved(task.id);

    expect(applied.appliedFiles).toBe(1);
    expect(sha256(fs.readFileSync(mainTex, "utf8"))).not.toBe(beforeHash);

    const rolledBack = await service.rollback(task.id);
    expect(rolledBack.rolledBackFiles).toBe(1);
    expect(sha256(fs.readFileSync(mainTex, "utf8"))).toBe(beforeHash);
  });
});

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
