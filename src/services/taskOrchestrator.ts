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
import { createRevisionLlmClient, type RevisionLlmClient } from "./llmClient.js";
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

type MatchedSegment = StoredSegment & {
  findingId?: string;
  matchScore?: number;
  matchMethod?: string;
};

export class TaskOrchestrator {
  private readonly progress: TaskProgressService;
  private readonly skillRuntime: SkillRuntime;
  private readonly artifactStore: ArtifactStore;
  private readonly reportFileService: ReportFileService;
  private readonly parserRegistry = new ParserRegistry();
  private readonly llmClient: RevisionLlmClient;

  constructor(private readonly handle: DatabaseHandle = getDatabase()) {
    this.progress = new TaskProgressService(handle);
    this.skillRuntime = new SkillRuntime(handle);
    this.artifactStore = new ArtifactStore(handle);
    this.reportFileService = new ReportFileService(handle);
    this.llmClient = createRevisionLlmClient(handle);
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

      const packets = await this.runStep(taskId, "build_revision_pack", async () =>
        this.buildProjectRevisionPacks(taskId, audit),
      );

      const segments = await this.runStep(taskId, "index_segments", async () =>
        packets.flatMap((packet) => this.insertSegments(taskId, packet.source_file, packet.segments)),
      );

      await this.runStep(taskId, "diagnose_style", async () =>
        this.skillRuntime.lintChineseStyle({ taskId, target: task.projectDir, stepKey: "diagnose_style" }),
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
          output.push(this.insertRevision(taskId, segment.id, segment.findingId, segment.text, decision));
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
        const matchStats = this.readMatchStats(taskId);
        const report = {
          taskId,
          mode: "dry_run",
          segmentCount: segments.length,
          findingCount: findings.length,
          matchedFindingCount: matchStats.matchedFindings,
          selectedSegmentCount: selectedSegments.length,
          needsReviewMatchCount: matchStats.needsReviewMatches,
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
            `- Matched findings: ${matchStats.matchedFindings}`,
            `- Selected segments: ${selectedSegments.length}`,
            `- Needs review matches: ${matchStats.needsReviewMatches}`,
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

  private async buildProjectRevisionPacks(taskId: string, audit: Record<string, unknown>): Promise<RevisionPacket[]> {
    const texFiles = this.pickProjectTexFiles(audit);
    const packets: RevisionPacket[] = [];

    for (let index = 0; index < texFiles.length; index += 1) {
      const texFile = texFiles[index];
      this.progress.stepProgress(
        taskId,
        "build_revision_pack",
        index + 1,
        texFiles.length,
        `正在全局抽取 LaTeX 段落 ${index + 1}/${texFiles.length}`,
      );
      const artifactBasename = `revision-packet-${index + 1}-${crypto
        .createHash("sha1")
        .update(path.resolve(texFile))
        .digest("hex")
        .slice(0, 10)}`;
      const packet = (await this.skillRuntime.buildRevisionPack({
        taskId,
        texFile,
        stepKey: "build_revision_pack",
        artifactBasename,
      })) as RevisionPacket;

      if (Array.isArray(packet.segments) && packet.segments.length > 0) {
        packets.push(packet);
      }
    }

    if (packets.length === 0) {
      throw new Error("No editable LaTeX prose segment found in project.");
    }

    return packets;
  }

  private pickProjectTexFiles(audit: Record<string, unknown>): string[] {
    const candidates = Array.isArray(audit.root_candidates) ? audit.root_candidates : [];
    const files = Array.isArray(audit.files) ? audit.files : [];
    const typedFiles = files.filter((file): file is { path: string; labels?: unknown[]; refs?: unknown[]; cites?: unknown[]; inputs?: unknown[] } => {
      return typeof file === "object" && file !== null && typeof (file as { path?: unknown }).path === "string";
    });

    const unique = new Map<string, { path: string; score: number }>();
    for (const file of typedFiles) {
      if (!file.path.toLowerCase().endsWith(".tex")) {
        continue;
      }
      const normalized = toPosix(file.path).toLowerCase();
      if (/\/(?:dist|build|node_modules)\//.test(normalized)) {
        continue;
      }
      const labels = Array.isArray(file.labels) ? file.labels.length : 0;
      const refs = Array.isArray(file.refs) ? file.refs.length : 0;
      const cites = Array.isArray(file.cites) ? file.cites.length : 0;
      const inputs = Array.isArray(file.inputs) ? file.inputs.length : 0;
      let score = labels * 2 + refs + cites + Math.min(inputs, 2);
      if (/\/chapters?\//.test(normalized) || /\/body/.test(normalized) || /正文|章节/.test(file.path)) {
        score += 12;
      }
      if (candidates.includes(file.path)) {
        score += 2;
      }
      unique.set(path.resolve(file.path), { path: file.path, score });
    }

    if (unique.size === 0) {
      return [this.pickRootTex(audit)];
    }

    return [...unique.values()].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).map((item) => item.path);
  }

  private pickRootTex(audit: Record<string, unknown>): string {
    const candidates = Array.isArray(audit.root_candidates) ? audit.root_candidates : [];
    const files = Array.isArray(audit.files) ? audit.files : [];
    const typedFiles = files.filter((file): file is { path: string; labels?: unknown[]; refs?: unknown[]; cites?: unknown[]; inputs?: unknown[] } => {
      return typeof file === "object" && file !== null && typeof (file as { path?: unknown }).path === "string";
    });

    const scored = typedFiles
      .map((file) => {
        const normalized = toPosix(file.path).toLowerCase();
        const labels = Array.isArray(file.labels) ? file.labels.length : 0;
        const refs = Array.isArray(file.refs) ? file.refs.length : 0;
        const cites = Array.isArray(file.cites) ? file.cites.length : 0;
        const inputs = Array.isArray(file.inputs) ? file.inputs.length : 0;
        const isRootCandidate = candidates.includes(file.path);
        let score = labels * 2 + refs + cites + Math.min(inputs, 2);
        if (/\/chapters?\//.test(normalized) || /\/body/.test(normalized) || /正文|章节/.test(file.path)) {
          score += 12;
        }
        if (/\/dist\//.test(normalized) || /\/build\//.test(normalized)) {
          score -= 20;
        }
        if (isRootCandidate && inputs > 0 && labels + refs + cites === 0) {
          score -= 10;
        }
        if (path.basename(file.path).toLowerCase() === "main.tex") {
          score += 4;
        }
        return { file, score };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored.find((item) => item.score > 0);
    if (best) {
      return best.file.path;
    }

    const mainRoot = candidates.find((candidate) => typeof candidate === "string" && path.basename(candidate).toLowerCase() === "main.tex");
    if (typeof mainRoot === "string") {
      return mainRoot;
    }
    const root = candidates[0];
    if (typeof root === "string") {
      return root;
    }
    if (typedFiles[0]) {
      return typedFiles[0].path;
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
        (id, task_id, file_path, packet_index, line_start, line_end, section_path_json, text, normalized_text, text_hash, protected_tokens_json)
        VALUES (@id, @taskId, @filePath, @packetIndex, @lineStart, @lineEnd, @sectionPathJson, @text, @normalizedText, @textHash, @protectedTokensJson)`,
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
          packetIndex: segment.index,
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
  ): MatchedSegment[] {
    const segmentLimit = options.maxSegments ?? Number.POSITIVE_INFINITY;

    if (!findings?.length) {
      return Number.isFinite(segmentLimit) ? segments.slice(0, segmentLimit) : segments;
    }

    const matches: Array<{ segment: StoredSegment; score: number; findingId: string; method: string; needsReview: boolean }> = [];
    const stmt = this.handle.sqlite.prepare(
      `INSERT INTO finding_matches
        (id, task_id, finding_id, segment_id, score, method, needs_review, created_at)
        VALUES (@id, @taskId, @findingId, @segmentId, @score, @method, @needsReview, @createdAt)`,
    );
    const tx = this.handle.sqlite.transaction(() => {
      for (const finding of findings) {
        const match = this.findReportSegmentMatch(finding, segments);

        if (match) {
          stmt.run({
            id: createId("match"),
            taskId,
            findingId: finding.id,
            segmentId: match.segment.id,
            score: match.score,
            method: match.method,
            needsReview: match.needsReview ? 1 : 0,
            createdAt: new Date().toISOString(),
          });
          if (!match.needsReview) {
            matches.push({ ...match, findingId: finding.id });
          }
        }
      }
    });
    tx();

    const unique = new Map<string, MatchedSegment>();
    for (const match of matches.sort((a, b) => b.score - a.score)) {
      if (!unique.has(match.segment.id)) {
        unique.set(match.segment.id, {
          ...match.segment,
          findingId: match.findingId,
          matchScore: match.score,
          matchMethod: match.method,
        });
      }
      if (unique.size >= segmentLimit) {
        break;
      }
    }
    return [...unique.values()];
  }

  private findReportSegmentMatch(
    finding: StoredFinding,
    segments: StoredSegment[],
  ): { segment: StoredSegment; score: number; method: string; needsReview: boolean } | undefined {
    const normalizedFinding = finding.normalizedText;
    if (!normalizedFinding) {
      return undefined;
    }

    for (const length of prefixLengths(normalizedFinding.length)) {
      const prefix = normalizedFinding.slice(0, length);
      const prefixMatches = segments.filter((segment) => segment.normalizedText.includes(prefix));
      if (prefixMatches.length === 1) {
        return {
          segment: prefixMatches[0],
          score: Math.min(1, 0.72 + length / 400),
          method: `prefix_${length}`,
          needsReview: false,
        };
      }

      if (prefixMatches.length > 1) {
        const ranked = rankSegmentsBySimilarity(normalizedFinding, prefixMatches);
        const best = ranked[0];
        const second = ranked[1];
        if (best && best.score >= 0.55 && (!second || best.score - second.score >= 0.08)) {
          return {
            segment: best.segment,
            score: best.score,
            method: `prefix_ranked_${length}`,
            needsReview: false,
          };
        }
      }
    }

    const ranked = rankSegmentsBySimilarity(normalizedFinding, segments);
    const best = ranked[0];
    const second = ranked[1];
    if (!best || best.score < 0.35) {
      return undefined;
    }

    const isDefinite = best.score >= 0.72 || !second || best.score - second.score >= 0.12;
    return {
      segment: best.segment,
      score: best.score,
      method: "ngram_fallback",
      needsReview: !isDefinite,
    };
  }

  private insertRevision(
    taskId: string,
    segmentId: string,
    findingId: string | undefined,
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
          VALUES (@id, @taskId, @segmentId, @findingId, @originalText, @revisedText, @revisionNote,
           'draft', @riskFlagsJson, @confidence, @now, @now)`,
      )
      .run({
        id,
        taskId,
        segmentId,
        findingId: findingId ?? null,
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

  private readMatchStats(taskId: string): { matchedFindings: number; needsReviewMatches: number } {
    const row = this.handle.sqlite
      .prepare(
        `SELECT
           COUNT(DISTINCT finding_id) AS matchedFindings,
           SUM(CASE WHEN needs_review = 1 THEN 1 ELSE 0 END) AS needsReviewMatches
         FROM finding_matches
         WHERE task_id = ?`,
      )
      .get(taskId) as { matchedFindings: number; needsReviewMatches: number | null };

    return {
      matchedFindings: Number(row.matchedFindings),
      needsReviewMatches: Number(row.needsReviewMatches ?? 0),
    };
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

function rankSegmentsBySimilarity(
  normalizedFinding: string,
  segments: StoredSegment[],
): Array<{ segment: StoredSegment; score: number }> {
  return segments
    .map((segment) => ({
      segment,
      score: similarity(normalizedFinding, segment.normalizedText),
    }))
    .sort((a, b) => b.score - a.score);
}

function prefixLengths(length: number): number[] {
  const candidates = [160, 120, 96, 72, 48, 36, 28, 20];
  return candidates.filter((candidate) => candidate <= length);
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

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}
