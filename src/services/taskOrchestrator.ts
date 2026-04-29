import crypto from "node:crypto";
import path from "node:path";
import type { TaskOptions } from "../domain/schemas.js";
import type { TaskStepKey } from "../domain/taskSteps.js";
import { createId } from "../utils/id.js";
import { stringifyJson } from "../utils/json.js";
import { normalizeText } from "../parsers/textNormalize.js";
import { ParserRegistry } from "../parsers/parserRegistry.js";
import { ArtifactStore } from "../storage/artifactStore.js";
import type { DatabaseHandle } from "../storage/db.js";
import { getDatabase } from "../storage/db.js";
import { SkillRuntime } from "../tools/skillRuntime.js";
import { createRevisionLlmClient } from "./llmClient.js";
import { ReportFileService } from "./reportFileService.js";
import { TaskProgressService } from "./taskProgressService.js";
import { validateRevisionText } from "./revisionValidator.js";

type PacketSegment = {
  index: number;
  line_start: number;
  line_end: number;
  text: string;
  section_hint?: {
    command?: string;
    title?: string;
  };
};

type RevisionPacket = {
  source_file: string;
  segment_count: number;
  segments: PacketSegment[];
};

type StoredSegment = {
  id: string;
  packetIndex: number;
  text: string;
  normalizedText: string;
};

type StoredFinding = {
  id: string;
  normalizedText: string;
};

export class TaskOrchestrator {
  private readonly progress: TaskProgressService;
  private readonly skillRuntime: SkillRuntime;
  private readonly artifactStore: ArtifactStore;
  private readonly reportFileService: ReportFileService;
  private readonly parserRegistry = new ParserRegistry();
  private readonly llmClient = createRevisionLlmClient();

  constructor(private readonly handle: DatabaseHandle = getDatabase()) {
    this.progress = new TaskProgressService(handle);
    this.skillRuntime = new SkillRuntime(handle);
    this.artifactStore = new ArtifactStore(handle);
    this.reportFileService = new ReportFileService(handle);
  }

  async runDryRun(taskId: string): Promise<void> {
    const task = this.progress.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    this.progress.markTaskRunning(taskId);

    try {
      await this.runStep(taskId, "validate_input", async () => {
        await this.skillRuntime.assertReady();
      });

      const audit = await this.runStep(taskId, "audit_project", async () =>
        this.skillRuntime.auditProject({ taskId, projectDir: task.projectDir, stepKey: "audit_project" }),
      );

      const findings = await this.runStep(taskId, "parse_report", async () => {
        if (!task.reportFileId) {
          this.progress.skipStep(taskId, "parse_report", "未提供报告文件，跳过 PDF 解析。");
          return [] as StoredFinding[];
        }
        const report = this.reportFileService.getReportFile(task.reportFileId);
        if (!report) {
          throw new Error(`Report file not found: ${task.reportFileId}`);
        }
        const buffer = await this.reportFileService.readReportBuffer(task.reportFileId);
        const parsed = await this.parserRegistry.parsePdf(buffer);
        this.reportFileService.markParsed(task.reportFileId, Number(parsed.metadata.totalPages) || undefined);
        await this.artifactStore.writeJson(taskId, "parsed_report", "parsed-report.json", parsed);
        const findingDrafts = this.parserRegistry.getPdfParser().toFindings(parsed);
        return this.insertFindings(taskId, task.reportFileId, findingDrafts);
      });

      const rootTex = this.pickRootTex(audit);
      const packet = await this.runStep(taskId, "build_revision_pack", async () =>
        this.skillRuntime.buildRevisionPack({ taskId, texFile: rootTex, stepKey: "build_revision_pack" }) as Promise<
          RevisionPacket
        >,
      );

      const segments = await this.runStep(taskId, "index_segments", async () =>
        this.insertSegments(taskId, packet.source_file, packet.segments),
      );

      await this.runStep(taskId, "diagnose_style", async () =>
        this.skillRuntime.lintChineseStyle({ taskId, target: rootTex, stepKey: "diagnose_style" }),
      );

      const selectedSegments = await this.runStep(taskId, "match_findings", async () =>
        this.matchSegments(taskId, findings, segments, task.options),
      );

      const revisions = await this.runStep(taskId, "generate_revisions", async () => {
        const output = [];
        for (let index = 0; index < selectedSegments.length; index += 1) {
          const segment = selectedSegments[index];
          this.progress.stepProgress(
            taskId,
            "generate_revisions",
            index + 1,
            selectedSegments.length,
            `正在生成修订建议 ${index + 1}/${selectedSegments.length}`,
          );
          const decision = await this.llmClient.generateRevisionDecision({
            taskId,
            stepKey: "generate_revisions",
            segmentId: segment.id,
            originalText: segment.text,
          });
          output.push(this.insertRevision(taskId, segment.id, segment.text, decision));
        }
        return output;
      });

      await this.runStep(taskId, "validate_revisions", async () => {
        for (const revision of revisions) {
          const validation = validateRevisionText(revision.originalText, revision.revisedText || revision.originalText);
          this.insertValidation(taskId, revision.id, validation);
        }
      });

      const summary = await this.runStep(taskId, "generate_report", async () => {
        const report = {
          taskId,
          mode: "dry_run",
          segmentCount: segments.length,
          findingCount: findings.length,
          revisionCount: revisions.length,
          generatedAt: new Date().toISOString(),
        };
        await this.artifactStore.writeJson(taskId, "dry_run_report", "report.json", report);
        await this.artifactStore.writeText(
          taskId,
          "dry_run_report_markdown",
          "report.md",
          [
            "# Down AI Dry-run Report",
            "",
            `- Task: ${taskId}`,
            `- Segments: ${segments.length}`,
            `- Findings: ${findings.length}`,
            `- Revision drafts: ${revisions.length}`,
            "",
          ].join("\n"),
        );
        return report;
      });

      this.progress.completeTask(taskId, summary);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const currentStep = this.progress.getTask(taskId)?.currentStep as TaskStepKey | undefined;
      if (currentStep) {
        this.progress.failStep(taskId, currentStep, err);
      }
      throw err;
    }
  }

  private async runStep<T>(taskId: string, stepKey: TaskStepKey, fn: () => Promise<T>): Promise<T> {
    const current = this.progress.getTask(taskId);
    const step = this.progress.listSteps(taskId).find((item) => item.stepKey === stepKey);
    if (step?.status === "skipped") {
      return undefined as T;
    }

    this.progress.startStep(taskId, stepKey);
    const value = await fn();
    const taskAfter = this.progress.getTask(taskId);
    if (taskAfter?.state !== "failed" && this.progress.listSteps(taskId).find((item) => item.stepKey === stepKey)?.status !== "skipped") {
      this.progress.completeStep(taskId, stepKey);
    }
    return value;
  }

  private pickRootTex(audit: Record<string, unknown>): string {
    const candidates = Array.isArray(audit.root_candidates) ? audit.root_candidates : [];
    const root = candidates[0];
    if (typeof root === "string") {
      return root;
    }
    const files = Array.isArray(audit.files) ? audit.files : [];
    const first = files.find((file): file is { path: string } => {
      return typeof file === "object" && file !== null && typeof (file as { path?: unknown }).path === "string";
    });
    if (first) {
      return first.path;
    }
    throw new Error("No .tex file found in LaTeX project audit.");
  }

  private insertFindings(
    taskId: string,
    reportFileId: string,
    findings: Array<{
      page?: number;
      rawText: string;
      normalizedText: string;
      riskType: string;
      severity: string;
      confidence: number;
      source: string;
    }>,
  ): StoredFinding[] {
    const stored: StoredFinding[] = [];
    const stmt = this.handle.sqlite.prepare(
      `INSERT INTO report_findings
        (id, task_id, report_file_id, page, raw_text, normalized_text, risk_type, severity, confidence, source)
        VALUES (@id, @taskId, @reportFileId, @page, @rawText, @normalizedText, @riskType, @severity, @confidence, @source)`,
    );
    const tx = this.handle.sqlite.transaction(() => {
      for (const finding of findings) {
        const id = createId("finding");
        stmt.run({
          id,
          taskId,
          reportFileId,
          page: finding.page ?? null,
          rawText: finding.rawText,
          normalizedText: finding.normalizedText,
          riskType: finding.riskType,
          severity: finding.severity,
          confidence: finding.confidence,
          source: finding.source,
        });
        stored.push({ id, normalizedText: finding.normalizedText });
      }
    });
    tx();
    return stored;
  }

  private insertSegments(taskId: string, sourceFile: string, segments: PacketSegment[]): StoredSegment[] {
    const stored: StoredSegment[] = [];
    const stmt = this.handle.sqlite.prepare(
      `INSERT INTO latex_segments
        (id, task_id, file_path, line_start, line_end, section_path_json, text, normalized_text, text_hash, protected_tokens_json)
        VALUES (@id, @taskId, @filePath, @lineStart, @lineEnd, @sectionPathJson, @text, @normalizedText, @textHash, @protectedTokensJson)`,
    );
    const tx = this.handle.sqlite.transaction(() => {
      for (const segment of segments) {
        const text = segment.text.trim();
        const normalizedText = normalizeText(text);
        const id = createId("segment");
        stmt.run({
          id,
          taskId,
          filePath: path.resolve(sourceFile),
          lineStart: segment.line_start,
          lineEnd: segment.line_end,
          sectionPathJson: stringifyJson(segment.section_hint ? [segment.section_hint] : []),
          text,
          normalizedText,
          textHash: crypto.createHash("sha256").update(text).digest("hex"),
          protectedTokensJson: "[]",
        });
        stored.push({ id, packetIndex: segment.index, text, normalizedText });
      }
    });
    tx();
    return stored;
  }

  private matchSegments(
    taskId: string,
    findings: StoredFinding[] | undefined,
    segments: StoredSegment[],
    options: TaskOptions,
  ): StoredSegment[] {
    if (!findings?.length) {
      return segments.slice(0, options.maxSegments);
    }

    const matches: Array<{ segment: StoredSegment; score: number; findingId: string }> = [];
    const stmt = this.handle.sqlite.prepare(
      `INSERT INTO finding_matches
        (id, task_id, finding_id, segment_id, score, method, needs_review, created_at)
        VALUES (@id, @taskId, @findingId, @segmentId, @score, @method, @needsReview, @createdAt)`,
    );
    const tx = this.handle.sqlite.transaction(() => {
      for (const finding of findings) {
        const best = segments
          .map((segment) => ({
            segment,
            score: similarity(finding.normalizedText, segment.normalizedText),
          }))
          .sort((a, b) => b.score - a.score)[0];

        if (best && best.score > 0.2) {
          stmt.run({
            id: createId("match"),
            taskId,
            findingId: finding.id,
            segmentId: best.segment.id,
            score: best.score,
            method: best.score === 1 ? "normalized" : "ngram",
            needsReview: best.score < 0.6 ? 1 : 0,
            createdAt: new Date().toISOString(),
          });
          matches.push({ ...best, findingId: finding.id });
        }
      }
    });
    tx();

    const unique = new Map<string, StoredSegment>();
    for (const match of matches.sort((a, b) => b.score - a.score)) {
      unique.set(match.segment.id, match.segment);
      if (unique.size >= options.maxSegments) {
        break;
      }
    }
    return [...unique.values()];
  }

  private insertRevision(
    taskId: string,
    segmentId: string,
    originalText: string,
    decision: {
      action: "keep" | "revise" | "needs_review";
      revisedText?: string;
      revisionNote: string;
      riskFlags: string[];
      confidence: number;
    },
  ): { id: string; originalText: string; revisedText?: string } {
    const now = new Date().toISOString();
    const id = createId("revision");
    const revisedText = decision.action === "revise" ? decision.revisedText : undefined;
    this.handle.sqlite
      .prepare(
        `INSERT INTO revisions
          (id, task_id, segment_id, finding_id, original_text, revised_text, revision_note,
           status, risk_flags_json, confidence, created_at, updated_at)
          VALUES (@id, @taskId, @segmentId, NULL, @originalText, @revisedText, @revisionNote,
           'draft', @riskFlagsJson, @confidence, @now, @now)`,
      )
      .run({
        id,
        taskId,
        segmentId,
        originalText,
        revisedText: revisedText ?? null,
        revisionNote: decision.revisionNote,
        riskFlagsJson: stringifyJson(decision.riskFlags),
        confidence: decision.confidence,
        now,
      });
    return { id, originalText, revisedText };
  }

  private insertValidation(
    taskId: string,
    revisionId: string,
    validation: { protectedTokenOk: boolean; lengthDeltaRatio: number; warnings: string[] },
  ): void {
    this.handle.sqlite
      .prepare(
        `INSERT INTO validation_results
          (id, task_id, revision_id, scope, status, protected_token_ok, length_delta_ratio, claim_risk, warnings_json, created_at)
          VALUES (@id, @taskId, @revisionId, 'segment', @status, @protectedTokenOk, @lengthDeltaRatio, 'none', @warningsJson, @createdAt)`,
      )
      .run({
        id: createId("validation"),
        taskId,
        revisionId,
        status: validation.warnings.length === 0 ? "passed" : "warning",
        protectedTokenOk: validation.protectedTokenOk ? 1 : 0,
        lengthDeltaRatio: validation.lengthDeltaRatio,
        warningsJson: stringifyJson(validation.warnings),
        createdAt: new Date().toISOString(),
      });
  }
}

function similarity(a: string, b: string): number {
  if (!a || !b) {
    return 0;
  }
  if (a.includes(b) || b.includes(a)) {
    return 1;
  }
  const gramsA = ngrams(a, 12);
  const gramsB = new Set(ngrams(b, 12));
  if (gramsA.length === 0 || gramsB.size === 0) {
    return 0;
  }
  const hits = gramsA.filter((gram) => gramsB.has(gram)).length;
  return hits / Math.max(gramsA.length, gramsB.size);
}

function ngrams(value: string, size: number): string[] {
  if (value.length <= size) {
    return [value];
  }
  const result: string[] = [];
  for (let index = 0; index <= value.length - size; index += size) {
    result.push(value.slice(index, index + size));
  }
  return result;
}
