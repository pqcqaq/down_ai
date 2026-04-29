import { Router } from "express";
import { createTaskSchema, taskOptionsSchema } from "../domain/schemas.js";
import { getDatabase } from "../storage/db.js";
import { TaskOrchestrator } from "../services/taskOrchestrator.js";
import { TaskProgressService } from "../services/taskProgressService.js";
import { RevisionApplyService } from "../services/revisionApplyService.js";
import { createRevisionLlmClient } from "../services/llmClient.js";
import { assertInsideWorkspace } from "../utils/pathSafety.js";
import { parseJson } from "../utils/json.js";

export const tasksRouter = Router();

const handle = getDatabase();
const progress = new TaskProgressService(handle);
const orchestrator = new TaskOrchestrator(handle);
const revisionApplyService = new RevisionApplyService(handle);

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

tasksRouter.post("/:taskId/revisions/:revisionId/approve", (req, res, next) => {
  try {
    revisionApplyService.approveRevision(req.params.taskId, req.params.revisionId);
    progress.insertEvent(req.params.taskId, {
      type: "revision_approved",
      message: "修订已确认",
      payload: { revisionId: req.params.revisionId },
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

tasksRouter.post("/:taskId/revisions/:revisionId/reject", (req, res, next) => {
  try {
    revisionApplyService.rejectRevision(req.params.taskId, req.params.revisionId);
    progress.insertEvent(req.params.taskId, {
      type: "revision_rejected",
      message: "修订已拒绝",
      payload: { revisionId: req.params.revisionId },
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

tasksRouter.post("/:taskId/revisions/:revisionId/edit", (req, res, next) => {
  try {
    const revisedText = typeof req.body?.revisedText === "string" ? req.body.revisedText : "";
    const revisionNote = typeof req.body?.revisionNote === "string" ? req.body.revisionNote : undefined;
    if (!revisedText.trim()) {
      res.status(400).json({ error: "revisedText is required." });
      return;
    }
    revisionApplyService.editRevision(req.params.taskId, req.params.revisionId, revisedText, revisionNote);
    progress.insertEvent(req.params.taskId, {
      type: "revision_edited",
      message: "修订已手动编辑",
      payload: { revisionId: req.params.revisionId },
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

tasksRouter.post("/:taskId/revisions/:revisionId/regenerate", async (req, res, next) => {
  try {
    const row = handle.sqlite
      .prepare("SELECT * FROM revisions WHERE task_id = ? AND id = ?")
      .get(req.params.taskId, req.params.revisionId) as
      | { segment_id: string; original_text: string }
      | undefined;
    if (!row) {
      res.status(404).json({ error: "Revision not found." });
      return;
    }
    const decision = await createRevisionLlmClient().generateRevisionDecision({
      taskId: req.params.taskId,
      stepKey: "generate_revisions",
      segmentId: row.segment_id,
      originalText: row.original_text,
    });
    revisionApplyService.editRevision(
      req.params.taskId,
      req.params.revisionId,
      decision.revisedText || row.original_text,
      decision.revisionNote,
    );
    progress.insertEvent(req.params.taskId, {
      type: "revision_regenerated",
      message: "修订已重新生成",
      payload: { revisionId: req.params.revisionId },
    });
    res.json({ ok: true, decision });
  } catch (error) {
    next(error);
  }
});

tasksRouter.post("/:taskId/apply", async (req, res, next) => {
  try {
    progress.insertEvent(req.params.taskId, {
      type: "apply_started",
      message: "开始应用已确认修订",
    });
    const result = await revisionApplyService.applyApproved(req.params.taskId, "validate_revisions");
    progress.insertEvent(req.params.taskId, {
      type: "apply_completed",
      message: "已应用修订",
      payload: result,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

tasksRouter.post("/:taskId/rollback", async (req, res, next) => {
  try {
    const result = await revisionApplyService.rollback(req.params.taskId);
    progress.insertEvent(req.params.taskId, {
      type: "rollback_completed",
      message: "已回滚任务修改",
      payload: result,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});
