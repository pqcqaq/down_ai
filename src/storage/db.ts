import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export type DatabaseHandle = {
  db: AppDatabase;
  sqlite: Database.Database;
};

let defaultHandle: DatabaseHandle | undefined;

export function createDatabase(dbPath = path.join(env.dataDir, "down-ai.sqlite")): DatabaseHandle {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  runMigrations(sqlite);

  return {
    db: drizzle(sqlite, { schema }),
    sqlite,
  };
}

export function getDatabase(): DatabaseHandle {
  defaultHandle ??= createDatabase();
  return defaultHandle;
}

export function resetDatabaseForTests(handle?: DatabaseHandle): void {
  handle?.sqlite.close();
  defaultHandle?.sqlite.close();
  defaultHandle = undefined;
}

function runMigrations(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_dir TEXT NOT NULL,
      report_file_id TEXT,
      state TEXT NOT NULL,
      current_step TEXT,
      progress_current INTEGER NOT NULL DEFAULT 0,
      progress_total INTEGER NOT NULL DEFAULT 0,
      options_json TEXT NOT NULL,
      summary_json TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS tasks_state_idx ON tasks(state);

    CREATE TABLE IF NOT EXISTS task_steps (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      step_key TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      progress_current INTEGER NOT NULL DEFAULT 0,
      progress_total INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      finished_at TEXT,
      duration_ms INTEGER,
      error_code TEXT,
      error_message TEXT,
      UNIQUE(task_id, step_key)
    );

    CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      step_key TEXT,
      message TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(task_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS report_files (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      page_count INTEGER,
      parse_status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS report_findings (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      report_file_id TEXT,
      page INTEGER,
      raw_text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      risk_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      confidence REAL NOT NULL,
      source TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS report_findings_task_severity_idx ON report_findings(task_id, severity);

    CREATE TABLE IF NOT EXISTS latex_segments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      packet_index INTEGER,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      section_path_json TEXT NOT NULL,
      text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      protected_tokens_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS latex_segments_task_file_idx ON latex_segments(task_id, file_path);

    CREATE TABLE IF NOT EXISTS finding_matches (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      finding_id TEXT NOT NULL,
      segment_id TEXT NOT NULL,
      score REAL NOT NULL,
      method TEXT NOT NULL,
      needs_review INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS revisions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      segment_id TEXT NOT NULL,
      finding_id TEXT,
      original_text TEXT NOT NULL,
      revised_text TEXT,
      revision_note TEXT NOT NULL,
      status TEXT NOT NULL,
      risk_flags_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS revisions_task_status_idx ON revisions(task_id, status);

    CREATE TABLE IF NOT EXISTS validation_results (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      revision_id TEXT,
      scope TEXT NOT NULL,
      status TEXT NOT NULL,
      protected_token_ok INTEGER,
      length_delta_ratio REAL,
      claim_risk TEXT,
      warnings_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      step_key TEXT,
      tool_name TEXT NOT NULL,
      command_json TEXT,
      input_json TEXT,
      stdout_path TEXT,
      stderr_path TEXT,
      exit_code INTEGER,
      status TEXT NOT NULL,
      duration_ms INTEGER,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      step_key TEXT,
      agent_name TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      input_summary_json TEXT NOT NULL,
      output_json TEXT,
      token_usage_json TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      kind TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT,
      sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  ensureColumn(sqlite, "latex_segments", "packet_index", "INTEGER");
}

function ensureColumn(sqlite: Database.Database, table: string, column: string, definition: string): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((item) => item.name === column)) {
    return;
  }

  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
