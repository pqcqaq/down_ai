import crypto from "node:crypto";
import { env } from "../config/env.js";
import { createId } from "../utils/id.js";
import { stringifyJson } from "../utils/json.js";
import type { DatabaseHandle } from "../storage/db.js";
import { getDatabase } from "../storage/db.js";

export class AgentRunRecorder {
  constructor(private readonly handle: DatabaseHandle = getDatabase()) {}

  start(input: {
    taskId?: string;
    stepKey?: string;
    agentName: string;
    prompt: string;
    inputSummary: unknown;
  }): string {
    const id = createId("agentrun");
    this.handle.sqlite
      .prepare(
        `INSERT INTO agent_runs
          (id, task_id, step_key, agent_name, model, prompt_hash, input_summary_json,
           output_json, token_usage_json, status, error_message, created_at, finished_at)
          VALUES (@id, @taskId, @stepKey, @agentName, @model, @promptHash, @inputSummaryJson,
           NULL, NULL, 'running', NULL, @createdAt, NULL)`,
      )
      .run({
        id,
        taskId: input.taskId ?? null,
        stepKey: input.stepKey ?? null,
        agentName: input.agentName,
        model: env.useLiveLlm ? env.deepseekModel : "mock",
        promptHash: crypto.createHash("sha256").update(input.prompt).digest("hex"),
        inputSummaryJson: stringifyJson(input.inputSummary),
        createdAt: new Date().toISOString(),
      });
    return id;
  }

  complete(id: string, output: unknown, tokenUsage?: unknown): void {
    this.handle.sqlite
      .prepare(
        `UPDATE agent_runs
         SET output_json = @outputJson, token_usage_json = @tokenUsageJson, status = 'completed', finished_at = @finishedAt
         WHERE id = @id`,
      )
      .run({
        id,
        outputJson: stringifyJson(output),
        tokenUsageJson: stringifyJson(tokenUsage),
        finishedAt: new Date().toISOString(),
      });
  }

  fail(id: string, error: Error): void {
    this.handle.sqlite
      .prepare(
        `UPDATE agent_runs
         SET status = 'failed', error_message = @errorMessage, finished_at = @finishedAt
         WHERE id = @id`,
      )
      .run({
        id,
        errorMessage: error.message,
        finishedAt: new Date().toISOString(),
      });
  }
}
