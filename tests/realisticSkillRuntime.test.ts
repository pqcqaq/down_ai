import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseHandle } from "../src/storage/db.js";

const testRoot = path.resolve("tmp-realistic-skill-test");
let handle: DatabaseHandle | undefined;

beforeEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  fs.mkdirSync(testRoot, { recursive: true });
  fs.cpSync(path.resolve("tests/fixtures/realistic-thesis"), path.join(testRoot, "project"), { recursive: true });

  process.env.DOWN_AI_DATA_DIR = path.join(testRoot, "data");
  process.env.BYPASS_AIGC_SKILL_DIR = path.resolve("../BypassAIGC-Skill");
  vi.resetModules();
});

afterEach(() => {
  handle?.sqlite.close();
  handle = undefined;
  fs.rmSync(testRoot, { recursive: true, force: true });
});

describe("SkillRuntime realistic LaTeX integration", () => {
  it("audits, segments, and lints a mixed Chinese/English thesis fixture", async () => {
    const { createDatabase } = await import("../src/storage/db.js");
    const { SkillRuntime } = await import("../src/tools/skillRuntime.js");
    handle = createDatabase(path.join(testRoot, "skill.sqlite"));

    const taskId = "task_realistic_skill";
    const projectDir = path.join(testRoot, "project");
    const runtime = new SkillRuntime(handle);

    await runtime.assertReady();
    const audit = await runtime.auditProject({ taskId, projectDir, stepKey: "audit_project" });
    const rootCandidates = audit.root_candidates as string[];
    const rootTex = rootCandidates.find((candidate) => candidate.endsWith("main.tex"));

    expect(rootTex).toBeTruthy();

    const packet = (await runtime.buildRevisionPack({
      taskId,
      texFile: rootTex!,
      stepKey: "build_revision_pack",
    })) as {
      source_file: string;
      segment_count: number;
      segments: Array<{ text: string; line_start: number; line_end: number }>;
    };

    expect(packet.source_file).toBe(rootTex);
    expect(packet.segment_count).toBeGreaterThanOrEqual(5);
    expect(packet.segments.some((segment) => segment.text.includes("\\cite{smith2024,lee2025}"))).toBe(true);
    expect(packet.segments.every((segment) => segment.line_start > 0 && segment.line_end >= segment.line_start)).toBe(true);

    await runtime.lintChineseStyle({ taskId, target: rootTex!, stepKey: "diagnose_style" });

    const toolRuns = handle.sqlite
      .prepare("SELECT tool_name, status, exit_code FROM tool_runs WHERE task_id = ? ORDER BY created_at")
      .all(taskId) as Array<{ tool_name: string; status: string; exit_code: number }>;

    expect(toolRuns.map((run) => run.tool_name)).toEqual(
      expect.arrayContaining(["latex_project_audit", "build_revision_pack", "chinese_ai_style_lint"]),
    );
    expect(toolRuns.every((run) => run.status === "completed")).toBe(true);
  });
});
