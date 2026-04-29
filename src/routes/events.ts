import { Router } from "express";
import { TaskProgressService } from "../services/taskProgressService.js";

export const eventsRouter = Router();

const progress = new TaskProgressService();

eventsRouter.get("/tasks/:taskId", (req, res) => {
  const after = Number(req.query.after || 0);
  const events = progress.listEvents(req.params.taskId, after, 1000);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  for (const event of events) {
    res.write(`id: ${event.sequence}\n`);
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  res.end();
});
