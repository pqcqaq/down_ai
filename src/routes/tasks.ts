import { Router } from "express";
import { createTaskSchema, taskOptionsSchema } from "../domain/schemas.js";
import { getDatabase } from "../storage/db.js";
import { TaskOrchestrator } from "../services/taskOrchestrator.js";
import { TaskProgressService } from "../services/taskProgressService.js";
import { assertInsideWorkspace } from "../utils/pathSafety.js";
import { parseJson } from "../utils/json.js";

export const tasksRouter = Router();

const handle = getDatabase();
const progress = new TaskProgressService(handle);
const orchestrator = new TaskOrchestrator(handle);

tasksRouter.post("/", async (req, res, next) => {
  try {
    const input = createTaskSchema.parse(req.body);
    const projectDir = assertInsideWorkspace(input.projectDir);
    const options = taskOptionsSchema.parse(input.options ?? {});
    const task = progress.createTask({
      projectDir,
      reportFileId: input.reportFileId,
      options,
    });
    res.status(201).json({ task });
  } catch (error) {
    next(error);
  }
});

tasksRouter.post("/:taskId/start", async (req, res, next) => {
  try {
    await orchestrator.runDryRun(req.params.taskId);
    res.json({
      task: progress.getTask(req.params.taskId),
    });
  } catch (error) {
    next(error);
  }
});

tasksRouter.get("/:taskId", (req, res) => {
  const task = progress.getTask(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: "Task not found." });
    return;
  }
  res.json({ task });
});

tasksRouter.get("/:taskId/steps", (req, res) => {
  res.json({
    taskId: req.params.taskId,
    steps: progress.listSteps(req.params.taskId),
  });
});

tasksRouter.get("/:taskId/events", (req, res) => {
  const after = Number(req.query.after || 0);
  const limit = Math.min(Number(req.query.limit || 200), 1000);
  res.json({
    taskId: req.params.taskId,
    events: progress.listEvents(req.params.taskId, after, limit),
  });
});

tasksRouter.get("/:taskId/revisions", (req, res) => {
  const rows = handle.sqlite
    .prepare("SELECT * FROM revisions WHERE task_id = ? ORDER BY created_at ASC")
    .all(req.params.taskId) as Record<string, unknown>[];

  res.json({
    taskId: req.params.taskId,
    revisions: rows.map((row) => ({
      id: String(row.id),
      taskId: String(row.task_id),
      segmentId: String(row.segment_id),
      originalText: String(row.original_text),
      revisedText: row.revised_text ? String(row.revised_text) : undefined,
      revisionNote: String(row.revision_note),
      status: String(row.status),
      riskFlags: parseJson(row.risk_flags_json ? String(row.risk_flags_json) : null, [] as string[]),
      confidence: Number(row.confidence),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    })),
  });
});
