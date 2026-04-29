import { Router } from "express";
import { taskOptionsSchema, inspectWorkspaceSchema } from "../domain/schemas.js";
import { SkillRuntime } from "../tools/skillRuntime.js";
import { TaskProgressService } from "../services/taskProgressService.js";
import { WorkspaceService } from "../services/workspaceService.js";

export const workspacesRouter = Router();

const workspaceService = new WorkspaceService();
const progress = new TaskProgressService();
const skillRuntime = new SkillRuntime();

workspacesRouter.post("/inspect", async (req, res, next) => {
  try {
    const input = inspectWorkspaceSchema.parse(req.body);
    const result = await workspaceService.inspect(input.projectDir);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

workspacesRouter.post("/audit", async (req, res, next) => {
  try {
    const input = inspectWorkspaceSchema.parse(req.body);
    const workspace = await workspaceService.inspect(input.projectDir);

    if (!workspace.exists) {
      res.status(400).json({ error: "Workspace does not exist." });
      return;
    }

    const task = progress.createTask({
      projectDir: workspace.projectDir,
      options: taskOptionsSchema.parse({ applyMode: "dry_run" }),
    });
    progress.markTaskRunning(task.id);
    progress.startStep(task.id, "audit_project");
    const audit = await skillRuntime.auditProject({
      taskId: task.id,
      projectDir: workspace.projectDir,
      stepKey: "audit_project",
    });
    progress.completeStep(task.id, "audit_project");

    res.json({
      taskId: task.id,
      audit,
    });
  } catch (error) {
    next(error);
  }
});
