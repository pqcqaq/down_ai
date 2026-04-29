import fs from "node:fs/promises";
import path from "node:path";
import { createId } from "../utils/id.js";
import { stringifyJson } from "../utils/json.js";
import type { DatabaseHandle } from "../storage/db.js";
import { getDatabase } from "../storage/db.js";

export type ToolRunInput = {
  taskId?: string;
  stepKey?: string;
  toolName: string;
  command?: string[];
  input?: unknown;
  logDir?: string;
};

export class ToolRunRecorder {
  constructor(private readonly handle: DatabaseHandle = getDatabase()) {}

  start(input: ToolRunInput): string {
    const id = createId("toolrun");
    this.handle.sqlite
      .prepare(
        `INSERT INTO tool_runs
          (id, task_id, step_key, tool_name, command_json, input_json, stdout_path, stderr_path,
           exit_code, status, duration_ms, created_at, finished_at)
          VALUES (@id, @taskId, @stepKey, @toolName, @commandJson, @inputJson, NULL, NULL,
           NULL, 'running', NULL, @createdAt, NULL)`,
      )
      .run({
        id,
        taskId: input.taskId ?? null,
        stepKey: input.stepKey ?? null,
        toolName: input.toolName,
        commandJson: stringifyJson(input.command ?? []),
        inputJson: stringifyJson(input.input),
        createdAt: new Date().toISOString(),
      });
    return id;
  }

  async finish(input: {
    id: string;
    status: "completed" | "failed";
    exitCode: number | null;
    stdout: string;
    stderr: string;
    durationMs: number;
    logDir?: string;
  }): Promise<void> {
    let stdoutPath: string | null = null;
    let stderrPath: string | null = null;

    if (input.logDir) {
      await fs.mkdir(input.logDir, { recursive: true });
      stdoutPath = path.join(input.logDir, `${input.id}.stdout.log`);
      stderrPath = path.join(input.logDir, `${input.id}.stderr.log`);
      await fs.writeFile(stdoutPath, input.stdout, "utf8");
      await fs.writeFile(stderrPath, input.stderr, "utf8");
    }

    this.handle.sqlite
      .prepare(
        `UPDATE tool_runs
         SET stdout_path = @stdoutPath, stderr_path = @stderrPath, exit_code = @exitCode,
             status = @status, duration_ms = @durationMs, finished_at = @finishedAt
         WHERE id = @id`,
      )
      .run({
        id: input.id,
        stdoutPath,
        stderrPath,
        exitCode: input.exitCode,
        status: input.status,
        durationMs: input.durationMs,
        finishedAt: new Date().toISOString(),
      });
  }
}
