import { taskStepDefinitions, type TaskStepKey } from "../domain/taskSteps.js";
import type { TaskOptions } from "../domain/schemas.js";
import { createId } from "../utils/id.js";
import { parseJson, stringifyJson } from "../utils/json.js";
import type { DatabaseHandle } from "../storage/db.js";
import { getDatabase } from "../storage/db.js";

export type TaskRecord = {
  id: string;
  projectDir: string;
  reportFileId?: string;
  state: string;
  currentStep?: string;
  progressCurrent: number;
  progressTotal: number;
  options: TaskOptions;
  summary?: unknown;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type TaskStepRecord = {
  id: string;
  taskId: string;
  stepKey: string;
  title: string;
  status: string;
  progressCurrent: number;
  progressTotal: number;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
};

export type TaskEventRecord = {
  id: string;
  taskId: string;
  sequence: number;
  type: string;
  stepKey?: string;
  message: string;
  payload?: unknown;
  createdAt: string;
};

type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export class TaskProgressService {
  constructor(private readonly handle: DatabaseHandle = getDatabase()) {}

  createTask(input: { projectDir: string; reportFileId?: string; options: TaskOptions }): TaskRecord {
    const now = new Date().toISOString();
    const taskId = createId("task");
    const tx = this.handle.sqlite.transaction(() => {
      this.handle.sqlite
        .prepare(
          `INSERT INTO tasks
            (id, project_dir, report_file_id, state, current_step, progress_current, progress_total, options_json,
             summary_json, error_code, error_message, created_at, updated_at, started_at, finished_at)
            VALUES (@id, @projectDir, @reportFileId, 'created', NULL, 0, @progressTotal, @optionsJson,
             NULL, NULL, NULL, @now, @now, NULL, NULL)`,
        )
        .run({
          id: taskId,
          projectDir: input.projectDir,
          reportFileId: input.reportFileId ?? null,
          progressTotal: taskStepDefinitions.length,
          optionsJson: stringifyJson(input.options),
          now,
        });

      for (const step of taskStepDefinitions) {
        this.handle.sqlite
          .prepare(
            `INSERT INTO task_steps
              (id, task_id, step_key, title, status, progress_current, progress_total, started_at, finished_at,
               duration_ms, error_code, error_message)
              VALUES (@id, @taskId, @stepKey, @title, 'pending', 0, 1, NULL, NULL, NULL, NULL, NULL)`,
          )
          .run({
            id: createId("step"),
            taskId,
            stepKey: step.key,
            title: step.title,
          });
      }

      this.insertEvent(taskId, {
        type: "task_created",
        message: "任务已创建",
        payload: { projectDir: input.projectDir, reportFileId: input.reportFileId },
      });
    });

    tx();
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Failed to create task: ${taskId}`);
    }
    return task;
  }

  getTask(taskId: string): TaskRecord | undefined {
    const row = this.handle.sqlite.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as
      | Record<string, unknown>
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: String(row.id),
      projectDir: String(row.project_dir),
      reportFileId: row.report_file_id ? String(row.report_file_id) : undefined,
      state: String(row.state),
      currentStep: row.current_step ? String(row.current_step) : undefined,
      progressCurrent: Number(row.progress_current),
      progressTotal: Number(row.progress_total),
      options: parseJson<TaskOptions>(String(row.options_json), {} as TaskOptions),
      summary: parseJson(row.summary_json ? String(row.summary_json) : null, undefined),
      errorCode: row.error_code ? String(row.error_code) : undefined,
      errorMessage: row.error_message ? String(row.error_message) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      startedAt: row.started_at ? String(row.started_at) : undefined,
      finishedAt: row.finished_at ? String(row.finished_at) : undefined,
    };
  }

  listSteps(taskId: string): TaskStepRecord[] {
    const rows = this.handle.sqlite
      .prepare("SELECT * FROM task_steps WHERE task_id = ? ORDER BY rowid ASC")
      .all(taskId) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: String(row.id),
      taskId: String(row.task_id),
      stepKey: String(row.step_key),
      title: String(row.title),
      status: String(row.status),
      progressCurrent: Number(row.progress_current),
      progressTotal: Number(row.progress_total),
      startedAt: row.started_at ? String(row.started_at) : undefined,
      finishedAt: row.finished_at ? String(row.finished_at) : undefined,
      durationMs: row.duration_ms == null ? undefined : Number(row.duration_ms),
      errorCode: row.error_code ? String(row.error_code) : undefined,
      errorMessage: row.error_message ? String(row.error_message) : undefined,
    }));
  }

  listEvents(taskId: string, after = 0, limit = 200): TaskEventRecord[] {
    const rows = this.handle.sqlite
      .prepare("SELECT * FROM task_events WHERE task_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?")
      .all(taskId, after, limit) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: String(row.id),
      taskId: String(row.task_id),
      sequence: Number(row.sequence),
      type: String(row.type),
      stepKey: row.step_key ? String(row.step_key) : undefined,
      message: String(row.message),
      payload: parseJson(row.payload_json ? String(row.payload_json) : null, undefined),
      createdAt: String(row.created_at),
    }));
  }

  markTaskRunning(taskId: string): void {
    const now = new Date().toISOString();
    this.handle.sqlite
      .prepare("UPDATE tasks SET state = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?")
      .run(now, now, taskId);
    this.insertEvent(taskId, { type: "task_started", message: "任务已启动" });
  }

  startStep(taskId: string, stepKey: TaskStepKey, message?: string): void {
    this.updateStep(taskId, stepKey, "running", {
      progressCurrent: 0,
      progressTotal: 1,
      message: message ?? "步骤开始",
      eventType: "step_started",
    });
  }

  stepProgress(taskId: string, stepKey: TaskStepKey, current: number, total: number, message: string): void {
    this.updateStep(taskId, stepKey, "running", {
      progressCurrent: current,
      progressTotal: total,
      message,
      eventType: "step_progress",
      payload: { current, total },
    });
  }

  completeStep(taskId: string, stepKey: TaskStepKey, message?: string, payload?: unknown): void {
    this.updateStep(taskId, stepKey, "completed", {
      progressCurrent: 1,
      progressTotal: 1,
      message: message ?? "步骤完成",
      eventType: "step_completed",
      payload,
    });
  }

  skipStep(taskId: string, stepKey: TaskStepKey, message: string): void {
    this.updateStep(taskId, stepKey, "skipped", {
      progressCurrent: 1,
      progressTotal: 1,
      message,
      eventType: "step_skipped",
    });
  }

  failStep(taskId: string, stepKey: TaskStepKey, error: Error, code = "STEP_FAILED"): void {
    const now = new Date().toISOString();
    const tx = this.handle.sqlite.transaction(() => {
      this.handle.sqlite
        .prepare(
          `UPDATE task_steps
           SET status = 'failed', finished_at = @now, error_code = @code, error_message = @message
           WHERE task_id = @taskId AND step_key = @stepKey`,
        )
        .run({ now, code, message: error.message, taskId, stepKey });
      this.handle.sqlite
        .prepare(
          `UPDATE tasks
           SET state = 'failed', current_step = @stepKey, error_code = @code, error_message = @message,
               updated_at = @now, finished_at = @now
           WHERE id = @taskId`,
        )
        .run({ now, code, message: error.message, taskId, stepKey });
      this.insertEvent(taskId, {
        type: "step_failed",
        stepKey,
        message: error.message,
        payload: { code },
      });
    });

    tx();
  }

  completeTask(taskId: string, summary: unknown): void {
    const now = new Date().toISOString();
    const tx = this.handle.sqlite.transaction(() => {
      this.handle.sqlite
        .prepare(
          `UPDATE tasks
           SET state = 'completed', current_step = NULL, progress_current = progress_total,
               summary_json = @summaryJson, updated_at = @now, finished_at = @now
           WHERE id = @taskId`,
        )
        .run({ taskId, summaryJson: stringifyJson(summary), now });
      this.insertEvent(taskId, {
        type: "task_completed",
        message: "任务已完成",
        payload: summary,
      });
    });

    tx();
  }

  insertEvent(
    taskId: string,
    input: { type: string; message: string; stepKey?: string; payload?: unknown },
  ): TaskEventRecord {
    const row = this.handle.sqlite
      .prepare("SELECT COALESCE(MAX(sequence), 0) AS max_sequence FROM task_events WHERE task_id = ?")
      .get(taskId) as { max_sequence: number };
    const event: TaskEventRecord = {
      id: createId("event"),
      taskId,
      sequence: Number(row.max_sequence) + 1,
      type: input.type,
      stepKey: input.stepKey,
      message: input.message,
      payload: input.payload,
      createdAt: new Date().toISOString(),
    };

    this.handle.sqlite
      .prepare(
        `INSERT INTO task_events
          (id, task_id, sequence, type, step_key, message, payload_json, created_at)
          VALUES (@id, @taskId, @sequence, @type, @stepKey, @message, @payloadJson, @createdAt)`,
      )
      .run({
        ...event,
        stepKey: event.stepKey ?? null,
        payloadJson: stringifyJson(event.payload),
      });

    return event;
  }

  private updateStep(
    taskId: string,
    stepKey: TaskStepKey,
    status: StepStatus,
    input: {
      progressCurrent: number;
      progressTotal: number;
      message: string;
      eventType: string;
      payload?: unknown;
    },
  ): void {
    const now = new Date().toISOString();
    const completedSteps = this.countCompletedSteps(taskId);
    const tx = this.handle.sqlite.transaction(() => {
      this.handle.sqlite
        .prepare(
          `UPDATE task_steps
           SET status = @status,
               progress_current = @progressCurrent,
               progress_total = @progressTotal,
               started_at = COALESCE(started_at, @now),
               finished_at = CASE WHEN @status IN ('completed', 'failed', 'skipped') THEN @now ELSE finished_at END
           WHERE task_id = @taskId AND step_key = @stepKey`,
        )
        .run({
          taskId,
          stepKey,
          status,
          progressCurrent: input.progressCurrent,
          progressTotal: input.progressTotal,
          now,
        });

      this.handle.sqlite
        .prepare(
          `UPDATE tasks
           SET state = CASE WHEN state = 'created' THEN 'running' ELSE state END,
               current_step = @stepKey,
               progress_current = @progressCurrent,
               updated_at = @now
           WHERE id = @taskId`,
        )
        .run({
          taskId,
          stepKey,
          progressCurrent: status === "completed" || status === "skipped" ? completedSteps + 1 : completedSteps,
          now,
        });

      this.insertEvent(taskId, {
        type: input.eventType,
        stepKey,
        message: input.message,
        payload: input.payload,
      });
    });

    tx();
  }

  private countCompletedSteps(taskId: string): number {
    const row = this.handle.sqlite
      .prepare("SELECT COUNT(*) AS count FROM task_steps WHERE task_id = ? AND status IN ('completed', 'skipped')")
      .get(taskId) as { count: number };
    return Number(row.count);
  }
}
