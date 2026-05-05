import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { eventsRouter } from "./routes/events.js";
import { generateRouter } from "./routes/generate.js";
import { reportsRouter } from "./routes/reports.js";
import { tasksRouter } from "./routes/tasks.js";
import { workspacesRouter } from "./routes/workspaces.js";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.corsOrigin === "*" ? true : env.corsOrigin,
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
    });
  });

  app.get("/api/runtime", (_req, res) => {
    res.json({
      llmMode: env.useLiveLlm ? "deepseek_live" : "mock",
      model: env.useLiveLlm ? env.deepseekModel : "mock",
      hasDeepSeekApiKey: Boolean(env.deepseekApiKey),
    });
  });

  app.use("/api", generateRouter);
  app.use("/api/workspaces", workspacesRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/tasks", tasksRouter);
  app.use("/api/events", eventsRouter);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : "Internal server error";

    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message,
      },
    });
  });

  return app;
}
