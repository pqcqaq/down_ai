import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { generateRouter } from "./routes/generate.js";

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

  app.use("/api", generateRouter);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : "Internal server error";

    res.status(500).json({
      error: message,
    });
  });

  return app;
}
