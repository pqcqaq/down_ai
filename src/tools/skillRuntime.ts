import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { env } from "../config/env.js";
import type { TaskStepKey } from "../domain/taskSteps.js";
import { ArtifactStore } from "../storage/artifactStore.js";
import type { DatabaseHandle } from "../storage/db.js";
import { getDatabase } from "../storage/db.js";
import { ToolRunRecorder } from "./toolRunRecorder.js";

export type SkillCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
};

export class SkillRuntime {
  private readonly artifactStore: ArtifactStore;
  private readonly recorder: ToolRunRecorder;

  constructor(private readonly handle: DatabaseHandle = getDatabase()) {
    this.artifactStore = new ArtifactStore(handle);
    this.recorder = new ToolRunRecorder(handle);
  }

  async assertReady(): Promise<void> {
    const requiredScripts = [
      "latex_project_audit.py",
      "build_revision_pack.py",
      "chinese_ai_style_lint.py",
      "render_revision_prompt.py",
      "lint_revision_packet.py",
      "apply_segment_revisions.py",
      "latex_segmenter.py",
    ];

    await fs.access(path.resolve(env.skillDir, "SKILL.md"));

    for (const script of requiredScripts) {
      await fs.access(this.scriptPath(script));
    }
  }

  async auditProject(input: {
    taskId: string;
    projectDir: string;
    stepKey?: TaskStepKey;
  }): Promise<Record<string, unknown>> {
    const outputPath = path.join(this.artifactStore.getTaskArtifactDir(input.taskId), "audit.json");
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await this.runPython({
      taskId: input.taskId,
      stepKey: input.stepKey,
      toolName: "latex_project_audit",
      args: [this.scriptPath("latex_project_audit.py"), input.projectDir, "--json", outputPath],
    });
    const content = await fs.readFile(outputPath, "utf8");
    await this.artifactStore.recordFile({ taskId: input.taskId, kind: "audit", filePath: outputPath, mimeType: "application/json" });
    return JSON.parse(content) as Record<string, unknown>;
  }

  async buildRevisionPack(input: {
    taskId: string;
    texFile: string;
    stepKey?: TaskStepKey;
    artifactBasename?: string;
  }): Promise<Record<string, unknown>> {
    const basename = input.artifactBasename ?? "revision-packet";
    const jsonPath = path.join(this.artifactStore.getTaskArtifactDir(input.taskId), `${basename}.json`);
    const markdownPath = path.join(this.artifactStore.getTaskArtifactDir(input.taskId), `${basename}.md`);
    await fs.mkdir(path.dirname(jsonPath), { recursive: true });
    await this.runPython({
      taskId: input.taskId,
      stepKey: input.stepKey,
      toolName: "build_revision_pack",
      args: [
        this.scriptPath("build_revision_pack.py"),
        input.texFile,
        "--json",
        jsonPath,
        "--markdown",
        markdownPath,
      ],
    });
    const content = await fs.readFile(jsonPath, "utf8");
    await this.artifactStore.recordFile({ taskId: input.taskId, kind: "revision_packet", filePath: jsonPath, mimeType: "application/json" });
    await this.artifactStore.recordFile({ taskId: input.taskId, kind: "revision_packet_markdown", filePath: markdownPath, mimeType: "text/markdown" });
    return JSON.parse(content) as Record<string, unknown>;
  }

  async lintChineseStyle(input: {
    taskId: string;
    target: string;
    stepKey?: TaskStepKey;
  }): Promise<unknown> {
    const result = await this.runPython({
      taskId: input.taskId,
      stepKey: input.stepKey,
      toolName: "chinese_ai_style_lint",
      args: [
        this.scriptPath("chinese_ai_style_lint.py"),
        input.target,
        "--json",
        "--min-severity",
        "medium",
      ],
      allowExitCodes: [0, 2],
    });

    const parsed = tryParseJson(result.stdout);
    await this.artifactStore.writeJson(input.taskId, "style_lint", "style-lint.json", parsed ?? { stdout: result.stdout });
    return parsed ?? result.stdout;
  }

  async renderRevisionPrompt(input: {
    taskId: string;
    packetPath: string;
    segmentIndex: number;
    mode?: string;
    stepKey?: TaskStepKey;
  }): Promise<string> {
    const result = await this.runPython({
      taskId: input.taskId,
      stepKey: input.stepKey,
      toolName: "render_revision_prompt",
      args: [
        this.scriptPath("render_revision_prompt.py"),
        input.packetPath,
        "--segment",
        String(input.segmentIndex),
        "--mode",
        input.mode ?? "chinese-humanize",
      ],
    });
    return result.stdout;
  }

  async lintRevisionPacket(input: {
    taskId: string;
    packetPath: string;
    stepKey?: TaskStepKey;
  }): Promise<SkillCommandResult> {
    return this.runPython({
      taskId: input.taskId,
      stepKey: input.stepKey,
      toolName: "lint_revision_packet",
      args: [this.scriptPath("lint_revision_packet.py"), input.packetPath],
    });
  }

  async applySegmentRevisions(input: {
    taskId: string;
    sourceTex: string;
    packetPath: string;
    outTex: string;
    stepKey?: TaskStepKey;
  }): Promise<SkillCommandResult> {
    await fs.mkdir(path.dirname(input.outTex), { recursive: true });
    return this.runPython({
      taskId: input.taskId,
      stepKey: input.stepKey,
      toolName: "apply_segment_revisions",
      args: [
        this.scriptPath("apply_segment_revisions.py"),
        input.sourceTex,
        input.packetPath,
        "--out",
        input.outTex,
      ],
    });
  }

  async checkProtectedTokens(input: {
    taskId: string;
    originalTex: string;
    revisedTex: string;
    stepKey?: TaskStepKey;
  }): Promise<SkillCommandResult> {
    return this.runPython({
      taskId: input.taskId,
      stepKey: input.stepKey,
      toolName: "latex_segmenter_check",
      args: [this.scriptPath("latex_segmenter.py"), "check", input.originalTex, input.revisedTex],
    });
  }

  private scriptPath(script: string): string {
    return path.resolve(env.skillDir, "scripts", script);
  }

  private async runPython(input: {
    taskId?: string;
    stepKey?: TaskStepKey;
    toolName: string;
    args: string[];
    allowExitCodes?: number[];
  }): Promise<SkillCommandResult> {
    const command = [env.pythonBin, ...input.args];
    const started = Date.now();
    const logDir = input.taskId ? path.join(this.artifactStore.getTaskDir(input.taskId), "logs") : undefined;
    const runId = this.recorder.start({
      taskId: input.taskId,
      stepKey: input.stepKey,
      toolName: input.toolName,
      command,
      logDir,
    });

    const result = await new Promise<SkillCommandResult>((resolve, reject) => {
      const child = spawn(env.pythonBin, input.args, {
        cwd: process.cwd(),
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
          durationMs: Date.now() - started,
        });
      });
    });

    const allowed = input.allowExitCodes ?? [0];
    await this.recorder.finish({
      id: runId,
      status: allowed.includes(result.exitCode) ? "completed" : "failed",
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      logDir,
    });

    if (!allowed.includes(result.exitCode)) {
      throw new Error(`${input.toolName} failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`);
    }

    return result;
  }
}

function tryParseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
