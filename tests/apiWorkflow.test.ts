import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPdfBuffer } from "./helpers/pdf.js";

const testRoot = path.resolve("tmp-realistic-api-test");
let app: import("express").Express;
let resetDatabaseForTests: () => void;

beforeAll(async () => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  fs.mkdirSync(testRoot, { recursive: true });
  fs.cpSync(path.resolve("tests/fixtures/realistic-thesis"), path.join(testRoot, "project"), { recursive: true });

  process.env.DOWN_AI_DATA_DIR = path.join(testRoot, "data");
  process.env.WORKSPACE_ROOT = path.resolve(".");
  process.env.BYPASS_AIGC_SKILL_DIR = path.resolve("../BypassAIGC-Skill");
  process.env.USE_LIVE_LLM = "false";
  vi.resetModules();

  const appModule = await import("../src/app.js");
  const dbModule = await import("../src/storage/db.js");
  app = appModule.createApp();
  resetDatabaseForTests = dbModule.resetDatabaseForTests;
});

afterAll(() => {
  resetDatabaseForTests();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

describe("realistic API workflow", () => {
  it("uploads a PDF report, runs dry-run, approves, applies, and rolls back", async () => {
    const reportBuffer = await createPdfBuffer([
      "This study aims to provide a comprehensive analysis of the proposed revision workflow.",
      "The workflow plays an important role in improving document quality and provides a complete solution for academic writing scenarios.",
    ]);

    const upload = await request(app)
      .post("/api/reports/upload")
      .attach("file", reportBuffer, {
        filename: "review-report.pdf",
        contentType: "application/pdf",
      })
      .expect(200);

    expect(upload.body.fileId).toMatch(/^file_/);

    const projectDir = path.join(testRoot, "project");
    const created = await request(app)
      .post("/api/tasks")
      .send({
        projectDir,
        reportFileId: upload.body.fileId,
        options: { maxSegments: 2 },
      })
      .expect(201);

    const taskId = created.body.task.id;
    const started = await request(app).post(`/api/tasks/${taskId}/start`).expect(200);
    expect(started.body.task.state).toBe("completed");

    const steps = await request(app).get(`/api/tasks/${taskId}/steps`).expect(200);
    expect(steps.body.steps.every((step: { status: string }) => ["completed", "skipped"].includes(step.status))).toBe(
      true,
    );

    const events = await request(app).get(`/api/tasks/${taskId}/events`).expect(200);
    expect(events.body.events.map((event: { type: string }) => event.type)).toContain("task_completed");

    const revisions = await request(app).get(`/api/tasks/${taskId}/revisions`).expect(200);
    expect(revisions.body.revisions.length).toBeGreaterThan(0);

    const mainTex = path.join(projectDir, "main.tex");
    const before = fs.readFileSync(mainTex, "utf8");
    const revision = revisions.body.revisions.find((item: { revisedText?: string }) => item.revisedText);
    expect(revision).toBeTruthy();

    await request(app).post(`/api/tasks/${taskId}/revisions/${revision.id}/approve`).expect(200);
    const applied = await request(app).post(`/api/tasks/${taskId}/apply`).expect(200);
    expect(applied.body.appliedFiles).toBe(1);
    expect(fs.readFileSync(mainTex, "utf8")).not.toBe(before);

    const rolledBack = await request(app).post(`/api/tasks/${taskId}/rollback`).expect(200);
    expect(rolledBack.body.rolledBackFiles).toBe(1);
    expect(fs.readFileSync(mainTex, "utf8")).toBe(before);
  });
});
