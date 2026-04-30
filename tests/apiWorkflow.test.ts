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
    const browsed = await request(app)
      .get(`/api/workspaces/browse?dir=${encodeURIComponent(testRoot)}`)
      .expect(200);
    expect(browsed.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "project",
          isLatexProject: true,
        }),
      ]),
    );

    const parsedReport = await request(app).get(`/api/reports/${upload.body.fileId}/parse`).expect(200);
    expect(parsedReport.body.findings.length).toBeGreaterThan(0);

    const created = await request(app)
      .post("/api/tasks")
      .send({
        projectDir,
        reportFileId: upload.body.fileId,
        options: { maxSegments: 2 },
      })
      .expect(201);

    const taskId = created.body.task.id;
    const recentTasks = await request(app).get("/api/tasks?limit=5").expect(200);
    expect(recentTasks.body.tasks.map((item: { id: string }) => item.id)).toContain(taskId);

    const started = await request(app).post(`/api/tasks/${taskId}/start`).expect(202);
    expect(["running", "completed"]).toContain(started.body.task.state);

    const completed = await waitForTask(taskId);
    expect(completed.state).toBe("completed");

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

    const approved = await request(app).post(`/api/tasks/${taskId}/revisions/approve-all`).expect(200);
    expect(approved.body.approved).toBeGreaterThan(0);
    const applied = await request(app).post(`/api/tasks/${taskId}/apply`).expect(200);
    expect(applied.body.appliedFiles).toBe(1);
    expect(fs.readFileSync(mainTex, "utf8")).not.toBe(before);

    const rolledBack = await request(app).post(`/api/tasks/${taskId}/rollback`).expect(200);
    expect(rolledBack.body.rolledBackFiles).toBe(1);
    expect(fs.readFileSync(mainTex, "utf8")).toBe(before);
  });
});

async function waitForTask(taskId: string): Promise<{ state: string }> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await request(app).get(`/api/tasks/${taskId}`).expect(200);
    const task = response.body.task as { state: string; errorMessage?: string };
    if (task.state === "completed") {
      return task;
    }
    if (task.state === "failed") {
      throw new Error(task.errorMessage || "Task failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for task: ${taskId}`);
}
