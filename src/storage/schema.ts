import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectDir: text("project_dir").notNull(),
    reportFileId: text("report_file_id"),
    state: text("state").notNull(),
    currentStep: text("current_step"),
    progressCurrent: integer("progress_current").notNull().default(0),
    progressTotal: integer("progress_total").notNull().default(0),
    optionsJson: text("options_json").notNull(),
    summaryJson: text("summary_json"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => ({
    stateIdx: index("tasks_state_idx").on(table.state),
  }),
);

export const taskSteps = sqliteTable(
  "task_steps",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    stepKey: text("step_key").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull(),
    progressCurrent: integer("progress_current").notNull().default(0),
    progressTotal: integer("progress_total").notNull().default(0),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    durationMs: integer("duration_ms"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
  },
  (table) => ({
    taskStepUnique: uniqueIndex("task_steps_task_step_unique").on(table.taskId, table.stepKey),
  }),
);

export const taskEvents = sqliteTable(
  "task_events",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    stepKey: text("step_key"),
    message: text("message").notNull(),
    payloadJson: text("payload_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    taskSequenceIdx: uniqueIndex("task_events_task_sequence_unique").on(table.taskId, table.sequence),
  }),
);

export const reportFiles = sqliteTable("report_files", {
  id: text("id").primaryKey(),
  taskId: text("task_id"),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  filePath: text("file_path").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  pageCount: integer("page_count"),
  parseStatus: text("parse_status").notNull(),
  createdAt: text("created_at").notNull(),
});

export const reportFindings = sqliteTable(
  "report_findings",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    reportFileId: text("report_file_id"),
    page: integer("page"),
    rawText: text("raw_text").notNull(),
    normalizedText: text("normalized_text").notNull(),
    riskType: text("risk_type").notNull(),
    severity: text("severity").notNull(),
    confidence: real("confidence").notNull(),
    source: text("source").notNull(),
  },
  (table) => ({
    taskSeverityIdx: index("report_findings_task_severity_idx").on(table.taskId, table.severity),
  }),
);

export const latexSegments = sqliteTable(
  "latex_segments",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    filePath: text("file_path").notNull(),
    packetIndex: integer("packet_index"),
    lineStart: integer("line_start").notNull(),
    lineEnd: integer("line_end").notNull(),
    sectionPathJson: text("section_path_json").notNull(),
    text: text("text").notNull(),
    normalizedText: text("normalized_text").notNull(),
    textHash: text("text_hash").notNull(),
    protectedTokensJson: text("protected_tokens_json").notNull(),
  },
  (table) => ({
    taskFileIdx: index("latex_segments_task_file_idx").on(table.taskId, table.filePath),
  }),
);

export const findingMatches = sqliteTable("finding_matches", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  findingId: text("finding_id").notNull(),
  segmentId: text("segment_id").notNull(),
  score: real("score").notNull(),
  method: text("method").notNull(),
  needsReview: integer("needs_review").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const revisions = sqliteTable(
  "revisions",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    segmentId: text("segment_id").notNull(),
    findingId: text("finding_id"),
    originalText: text("original_text").notNull(),
    revisedText: text("revised_text"),
    revisionNote: text("revision_note").notNull(),
    status: text("status").notNull(),
    riskFlagsJson: text("risk_flags_json").notNull(),
    confidence: real("confidence").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    taskStatusIdx: index("revisions_task_status_idx").on(table.taskId, table.status),
  }),
);

export const validationResults = sqliteTable("validation_results", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  revisionId: text("revision_id"),
  scope: text("scope").notNull(),
  status: text("status").notNull(),
  protectedTokenOk: integer("protected_token_ok"),
  lengthDeltaRatio: real("length_delta_ratio"),
  claimRisk: text("claim_risk"),
  warningsJson: text("warnings_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const toolRuns = sqliteTable("tool_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id"),
  stepKey: text("step_key"),
  toolName: text("tool_name").notNull(),
  commandJson: text("command_json"),
  inputJson: text("input_json"),
  stdoutPath: text("stdout_path"),
  stderrPath: text("stderr_path"),
  exitCode: integer("exit_code"),
  status: text("status").notNull(),
  durationMs: integer("duration_ms"),
  createdAt: text("created_at").notNull(),
  finishedAt: text("finished_at"),
});

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id"),
  stepKey: text("step_key"),
  agentName: text("agent_name").notNull(),
  model: text("model").notNull(),
  promptHash: text("prompt_hash").notNull(),
  inputSummaryJson: text("input_summary_json").notNull(),
  outputJson: text("output_json"),
  tokenUsageJson: text("token_usage_json"),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
  finishedAt: text("finished_at"),
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  taskId: text("task_id"),
  kind: text("kind").notNull(),
  filePath: text("file_path").notNull(),
  mimeType: text("mime_type"),
  sha256: text("sha256").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: text("created_at").notNull(),
});
