export type Task = {
  id: string;
  projectDir: string;
  reportFileId?: string;
  state: string;
  currentStep?: string;
  progressCurrent: number;
  progressTotal: number;
  summary?: unknown;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskStep = {
  stepKey: string;
  title: string;
  status: string;
  progressCurrent: number;
  progressTotal: number;
};

export type TaskEvent = {
  id: string;
  sequence: number;
  type: string;
  message: string;
  createdAt: string;
};

export type Revision = {
  id: string;
  originalText: string;
  revisedText?: string;
  revisionNote: string;
  status: string;
  confidence: number;
  riskFlags: string[];
};

export type WorkspaceEntry = {
  name: string;
  path: string;
  texFiles: number;
  bibFiles: number;
  rootCandidates: number;
  isLatexProject: boolean;
};

export type WorkspaceBrowseResult = {
  workspaceRoot: string;
  currentDir: string;
  parentDir?: string;
  entries: WorkspaceEntry[];
};

export type ReportParseResult = {
  fileId: string;
  findings: Array<{
    page?: number;
    rawText: string;
    normalizedText: string;
    riskType: string;
    severity: string;
    confidence: number;
    source: string;
  }>;
};

const apiBaseUrl = (
  (import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL || ""
).replace(/\/+$/, "");

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${url}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error || `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export async function inspectWorkspace(projectDir: string) {
  return request<{
    projectDir: string;
    exists: boolean;
    texFiles: number;
    bibFiles: number;
    rootCandidates: string[];
    warnings: string[];
  }>("/api/workspaces/inspect", {
    method: "POST",
    body: JSON.stringify({ projectDir }),
  });
}

export async function browseWorkspaces(dir?: string) {
  const query = dir ? `?dir=${encodeURIComponent(dir)}` : "";
  return request<WorkspaceBrowseResult>(`/api/workspaces/browse${query}`);
}

export async function uploadReport(file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<{ fileId: string }>("/api/reports/upload", {
    method: "POST",
    body: form,
  });
}

export async function parseReport(fileId: string) {
  return request<ReportParseResult>(`/api/reports/${fileId}/parse`);
}

export async function createTask(input: { projectDir: string; reportFileId?: string; maxSegments: number }) {
  return request<{ task: Task }>("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      projectDir: input.projectDir,
      reportFileId: input.reportFileId,
      options: {
        applyMode: "dry_run",
        maxSegments: input.maxSegments,
      },
    }),
  });
}

export async function startTask(taskId: string) {
  return request<{ task: Task }>(`/api/tasks/${taskId}/start`, { method: "POST" });
}

export async function listTasks(limit = 10) {
  return request<{ tasks: Task[] }>(`/api/tasks?limit=${limit}`);
}

export async function getTask(taskId: string) {
  return request<{ task: Task }>(`/api/tasks/${taskId}`);
}

export async function getSteps(taskId: string) {
  return request<{ steps: TaskStep[] }>(`/api/tasks/${taskId}/steps`);
}

export async function getEvents(taskId: string, after = 0) {
  return request<{ events: TaskEvent[] }>(`/api/tasks/${taskId}/events?after=${after}`);
}

export async function getRevisions(taskId: string) {
  return request<{ revisions: Revision[] }>(`/api/tasks/${taskId}/revisions`);
}

export async function approveRevision(taskId: string, revisionId: string) {
  return request<{ ok: true }>(`/api/tasks/${taskId}/revisions/${revisionId}/approve`, { method: "POST" });
}

export async function approveAllRevisions(taskId: string) {
  return request<{ ok: true; approved: number }>(`/api/tasks/${taskId}/revisions/approve-all`, { method: "POST" });
}

export async function rejectRevision(taskId: string, revisionId: string) {
  return request<{ ok: true }>(`/api/tasks/${taskId}/revisions/${revisionId}/reject`, { method: "POST" });
}

export async function regenerateRevision(taskId: string, revisionId: string) {
  return request<{ ok: true; decision: unknown }>(`/api/tasks/${taskId}/revisions/${revisionId}/regenerate`, {
    method: "POST",
  });
}

export async function editRevision(taskId: string, revisionId: string, revisedText: string) {
  return request<{ ok: true }>(`/api/tasks/${taskId}/revisions/${revisionId}/edit`, {
    method: "POST",
    body: JSON.stringify({ revisedText }),
  });
}

export async function applyTask(taskId: string) {
  return request<{ appliedFiles: number }>(`/api/tasks/${taskId}/apply`, { method: "POST" });
}

export async function rollbackTask(taskId: string) {
  return request<{ rolledBackFiles: number }>(`/api/tasks/${taskId}/rollback`, { method: "POST" });
}
