import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseHandle } from "../src/storage/db.js";

const testRoot = path.resolve("tmp-revision-safety-test");
let handle: DatabaseHandle | undefined;

beforeEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  fs.mkdirSync(testRoot, { recursive: true });
  fs.cpSync(path.resolve("tests/fixtures/realistic-thesis"), path.join(testRoot, "project"), { recursive: true });

  process.env.DOWN_AI_DATA_DIR = path.join(testRoot, "data");
  process.env.BYPASS_AIGC_SKILL_DIR = path.resolve("../BypassAIGC-Skill");
  process.env.USE_LIVE_LLM = "false";
  vi.resetModules();
});

afterEach(() => {
  handle?.sqlite.close();
  handle = undefined;
  fs.rmSync(testRoot, { recursive: true, force: true });
});

describe("revision safety workflow", () => {
  it("blocks applying an approved revision that drops LaTeX protected tokens", async () => {
    const { taskOptionsSchema } = await import("../src/domain/schemas.js");
    const { createDatabase } = await import("../src/storage/db.js");
    const { RevisionApplyService } = await import("../src/services/revisionApplyService.js");
    const { TaskOrchestrator } = await import("../src/services/taskOrchestrator.js");
    const { TaskProgressService } = await import("../src/services/taskProgressService.js");

    handle = createDatabase(path.join(testRoot, "safety.sqlite"));
    const projectDir = path.join(testRoot, "project");
    const mainTex = path.join(projectDir, "main.tex");
    const before = fs.readFileSync(mainTex, "utf8");

    const progress = new TaskProgressService(handle);
    const task = progress.createTask({
      projectDir,
      options: taskOptionsSchema.parse({ maxSegments: 6 }),
    });
    await new TaskOrchestrator(handle).runDryRun(task.id);

    const unsafeTarget = handle.sqlite
      .prepare(
        `SELECT id, original_text
         FROM revisions
         WHERE task_id = ? AND (original_text LIKE '%cite%' OR original_text LIKE '%ref%')
         LIMIT 1`,
      )
      .get(task.id) as { id: string; original_text: string } | undefined;

    expect(unsafeTarget).toBeTruthy();
    expect(unsafeTarget!.original_text).toMatch(/\\(?:cite|ref)\{/);

    const service = new RevisionApplyService(handle);
    service.editRevision(task.id, unsafeTarget!.id, "本系统由多个模块组成，并已完成相关说明。", "synthetic unsafe edit");

    const edited = handle.sqlite.prepare("SELECT risk_flags_json FROM revisions WHERE id = ?").get(unsafeTarget!.id) as {
      risk_flags_json: string;
    };
    expect(JSON.parse(edited.risk_flags_json)).toContain("protected-token-drift");

    service.approveRevision(task.id, unsafeTarget!.id);
    await expect(service.applyApproved(task.id)).rejects.toThrow(/protected token drift|lint_revision_packet failed/i);

    expect(fs.readFileSync(mainTex, "utf8")).toBe(before);

    const failedLint = handle.sqlite
      .prepare(
        `SELECT status, exit_code
         FROM tool_runs
         WHERE task_id = ? AND tool_name = 'lint_revision_packet'
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(task.id) as { status: string; exit_code: number };

    expect(failedLint.status).toBe("failed");
    expect(failedLint.exit_code).toBe(2);
  });
});
