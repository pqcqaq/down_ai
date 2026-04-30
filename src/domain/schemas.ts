import { z } from "zod";

export const taskOptionsSchema = z.object({
  scope: z.enum(["report_findings", "selected_files", "full_scan"]).default("report_findings"),
  language: z.enum(["auto", "zh", "en"]).default("auto"),
  revisionStrength: z.enum(["light", "medium", "conservative_rewrite"]).default("medium"),
  applyMode: z.enum(["dry_run", "review_required", "auto_low_risk"]).default("dry_run"),
  compileMode: z.enum(["none", "auto", "manual"]).default("none"),
  maxSegments: z.number().int().positive().nullable().default(null),
});

export type TaskOptions = z.infer<typeof taskOptionsSchema>;

export const revisionDecisionSchema = z.object({
  segmentId: z.string(),
  action: z.enum(["keep", "revise", "needs_review"]),
  revisedText: z.string().optional(),
  revisionNote: z.string(),
  riskFlags: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});

export type RevisionDecision = z.infer<typeof revisionDecisionSchema>;

export const createTaskSchema = z.object({
  projectDir: z.string().min(1),
  reportFileId: z.string().optional(),
  options: taskOptionsSchema.partial().optional(),
});

export const inspectWorkspaceSchema = z.object({
  projectDir: z.string().min(1),
});
