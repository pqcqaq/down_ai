import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseHandle } from "../../src/storage/db.js";

const shouldRun = process.env.RUN_LIVE_LLM_TESTS === "true" && Boolean(process.env.DEEPSEEK_API_KEY);
const testRoot = path.resolve("tmp-live-workflow-test");
let handle: DatabaseHandle | undefined;
let resetDatabaseForTests: (() => void) | undefined;

beforeEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  fs.mkdirSync(testRoot, { recursive: true });
  fs.cpSync(path.resolve("tests/fixtures/realistic-thesis"), path.join(testRoot, "project"), { recursive: true });

  process.env.DOWN_AI_DATA_DIR = path.join(testRoot, "data");
  process.env.BYPASS_AIGC_SKILL_DIR = path.resolve("../BypassAIGC-Skill");
  process.env.WORKSPACE_ROOT = path.resolve(".");
  process.env.USE_LIVE_LLM = "true";
  vi.resetModules();
});

afterEach(() => {
  if (resetDatabaseForTests) {
    resetDatabaseForTests();
  } else {
    handle?.sqlite.close();
  }
  handle = undefined;
  resetDatabaseForTests = undefined;
  process.env.USE_LIVE_LLM = "false";
  fs.rmSync(testRoot, { recursive: true, force: true });
});

describe.skipIf(!shouldRun)("DeepSeek live task workflow", () => {
  it("runs a one-segment dry-run and records the live model call in the task database", async () => {
    const { taskOptionsSchema } = await import("../../src/domain/schemas.js");
    const dbModule = await import("../../src/storage/db.js");
    const { TaskOrchestrator } = await import("../../src/services/taskOrchestrator.js");
    const { TaskProgressService } = await import("../../src/services/taskProgressService.js");

    resetDatabaseForTests = dbModule.resetDatabaseForTests;
    handle = dbModule.getDatabase();

    const progress = new TaskProgressService(handle);
    const task = progress.createTask({
      projectDir: path.join(testRoot, "project"),
      options: taskOptionsSchema.parse({ maxSegments: 1 }),
    });

    await new TaskOrchestrator(handle).runDryRun(task.id);

    expect(progress.getTask(task.id)?.state).toBe("completed");

    const agentRun = handle.sqlite
      .prepare(
        `SELECT status, model, prompt_hash, input_summary_json, output_json
         FROM agent_runs
         WHERE task_id = ?
         LIMIT 1`,
      )
      .get(task.id) as {
      status: string;
      model: string;
      prompt_hash: string;
      input_summary_json: string;
      output_json: string;
    };

    expect(agentRun.status).toBe("completed");
    expect(agentRun.model).not.toBe("mock");
    expect(agentRun.prompt_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(agentRun.input_summary_json).toContain("segmentId");
    expect(agentRun.input_summary_json).not.toContain("本文围绕论文修订任务");
    expect(agentRun.output_json).not.toMatch(/<think>|reasoning_content|思考过程|推理过程/i);

    const revisionCount = handle.sqlite
      .prepare("SELECT COUNT(*) AS count FROM revisions WHERE task_id = ?")
      .get(task.id) as { count: number };
    expect(revisionCount.count).toBe(1);
  });
});
