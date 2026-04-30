import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Check,
  ChevronLeft,
  Clock3,
  FileText,
  FolderOpen,
  History,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  applyTask,
  approveAllRevisions,
  approveRevision,
  browseWorkspaces,
  createTask,
  editRevision,
  getEvents,
  getRevisions,
  getSteps,
  getTask,
  inspectWorkspace,
  listTasks,
  parseReport,
  regenerateRevision,
  rejectRevision,
  rollbackTask,
  startTask,
  uploadReport,
  type Revision,
  type Task,
  type TaskEvent,
  type TaskStep,
  type WorkspaceBrowseResult,
} from "./api";

type WorkspaceInfo = Awaited<ReturnType<typeof inspectWorkspace>>;
type ModalName = "directory" | "settings" | "history" | "events" | "revision" | null;

export function App() {
  const [projectDir, setProjectDir] = useState("tests/fixtures/realistic-thesis");
  const [limitSegments, setLimitSegments] = useState(false);
  const [maxSegments, setMaxSegments] = useState(20);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | undefined>();
  const [browser, setBrowser] = useState<WorkspaceBrowseResult | undefined>();
  const [reportFileId, setReportFileId] = useState<string | undefined>();
  const [reportName, setReportName] = useState("");
  const [reportFindingCount, setReportFindingCount] = useState<number | undefined>();
  const [task, setTask] = useState<Task | undefined>();
  const [recentTasks, setRecentTasks] = useState<Task[]>([]);
  const [steps, setSteps] = useState<TaskStep[]>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [modal, setModal] = useState<ModalName>(null);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | undefined>();
  const [editing, setEditing] = useState<Record<string, string>>({});

  const revisionStats = useMemo(() => {
    const approved = revisions.filter((revision) => revision.status === "approved").length;
    const applied = revisions.filter((revision) => revision.status === "applied").length;
    const risky = revisions.filter((revision) => revision.riskFlags.length > 0).length;
    return { approved, applied, risky, total: revisions.length };
  }, [revisions]);

  const selectedRevision = useMemo(
    () => revisions.find((revision) => revision.id === selectedRevisionId),
    [revisions, selectedRevisionId],
  );

  const progressPercent = useMemo(() => {
    if (!task?.progressTotal) {
      return 0;
    }
    return Math.round((task.progressCurrent / task.progressTotal) * 100);
  }, [task]);

  useEffect(() => {
    void loadBrowser();
    void loadRecentTasks();
  }, []);

  async function loadBrowser(dir?: string) {
    setBrowser(await browseWorkspaces(dir));
  }

  async function loadRecentTasks() {
    const result = await listTasks(8);
    setRecentTasks(result.tasks);
  }

  async function refresh(taskId = task?.id) {
    if (!taskId) {
      return;
    }
    const [taskPayload, stepPayload, eventPayload, revisionPayload] = await Promise.all([
      getTask(taskId),
      getSteps(taskId),
      getEvents(taskId),
      getRevisions(taskId),
    ]);
    setTask(taskPayload.task);
    setSteps(stepPayload.steps);
    setEvents(eventPayload.events);
    setRevisions(revisionPayload.revisions);
    await loadRecentTasks();
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setMessage(label);
    try {
      await fn();
      setMessage(`${label}完成`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function inspectCurrentProject(nextDir = projectDir) {
    const result = await inspectWorkspace(nextDir);
    setWorkspace(result);
    setProjectDir(result.projectDir);
  }

  async function chooseProjectDir(nextDir: string) {
    await inspectCurrentProject(nextDir);
    setModal(null);
  }

  async function startDryRun() {
    const inspected = await inspectWorkspace(projectDir);
    setWorkspace(inspected);
    if (!inspected.exists) {
      throw new Error("项目目录不可用。");
    }
    const created = await createTask({
      projectDir: inspected.projectDir,
      reportFileId,
      maxSegments: limitSegments ? maxSegments : null,
    });
    setTask(created.task);
    const started = await startTask(created.task.id);
    setTask(started.task);
    await refresh(created.task.id);
  }

  async function loadTask(taskId: string) {
    await refresh(taskId);
    setModal(null);
    setMessage(`已载入任务 ${taskId}`);
  }

  async function approveSafeRevisions() {
    if (!task) {
      return;
    }
    const safe = revisions.filter(
      (revision) => revision.revisedText && revision.status !== "applied" && revision.riskFlags.length === 0,
    );
    for (const revision of safe) {
      await approveRevision(task.id, revision.id);
    }
    await refresh(task.id);
    setMessage(`已确认 ${safe.length} 条无风险修订`);
  }

  function openRevision(revision: Revision) {
    setSelectedRevisionId(revision.id);
    setModal("revision");
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Down AI Agent</p>
          <h1>LaTeX 修订工作台</h1>
        </div>
        <div className="top-actions">
          <button type="button" onClick={() => setModal("history")}>
            <History size={16} />
            历史任务
          </button>
          <button type="button" onClick={() => setModal("settings")}>
            <Settings size={16} />
            设置
          </button>
          <span className={`state-pill state-${task?.state ?? "idle"}`}>{task?.state ?? "未创建"}</span>
        </div>
      </header>

      <section className="workflow-bar">
        <div className="workflow-field project-field">
          <span className="field-label">LaTeX 项目</span>
          <input
            data-testid="project-dir-input"
            value={projectDir}
            onChange={(event) => setProjectDir(event.target.value)}
          />
          <button
            type="button"
            onClick={() =>
              run("打开目录选择", async () => {
                await loadBrowser(projectDir);
                setModal("directory");
              })
            }
          >
            <FolderOpen size={16} />
            选择
          </button>
          <button
            type="button"
            onClick={() =>
              run("检查项目", async () => {
                await inspectCurrentProject();
              })
            }
          >
            <FileText size={16} />
            检查
          </button>
        </div>

        <label className="file-button workflow-upload">
          <Upload size={16} />
          {reportName ? "更换报告" : "上传报告"}
          <input
            data-testid="report-file-input"
            type="file"
            accept="application/pdf"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void run("上传并解析报告", async () => {
                const result = await uploadReport(file);
                setReportFileId(result.fileId);
                setReportName(file.name);
                const parsed = await parseReport(result.fileId);
                setReportFindingCount(parsed.findings.length);
              });
            }}
          />
        </label>

        <button
          data-testid="start-task-button"
          className="primary run-button"
          disabled={busy}
          type="button"
          onClick={() => run("创建并启动 dry-run", startDryRun)}
        >
          {busy ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
          开始分析
        </button>
      </section>

      <section className="summary-strip">
        <SummaryItem
          label="项目"
          value={workspace ? `${workspace.texFiles} tex / ${workspace.rootCandidates.length} 主文件` : "未检查"}
        />
        <SummaryItem label="报告" value={reportName ? `${reportName}${reportFindingCount == null ? "" : ` / ${reportFindingCount} 条线索`}` : "未上传"} />
        <SummaryItem
          label="任务"
          value={task ? `${task.id.slice(0, 12)} / ${progressPercent}%` : limitSegments ? `最多 ${maxSegments} 段` : "全部风险段落"}
        />
        <SummaryItem label="修订" value={`${revisionStats.total} 条 / ${revisionStats.approved} 已确认 / ${revisionStats.applied} 已写回`} />
      </section>

      {message && <p className="message">{message}</p>}

      <section className="workspace">
        <section className="panel progress-panel">
          <div className="section-title">
            <h2>进度</h2>
            <div className="button-row">
              <button type="button" onClick={() => void refresh()} disabled={!task || busy}>
                <RefreshCw size={16} />
                刷新
              </button>
              <button type="button" onClick={() => setModal("events")} disabled={events.length === 0}>
                <Clock3 size={16} />
                事件
              </button>
            </div>
          </div>

          <div className="progress-track">
            <span style={{ width: `${progressPercent}%` }} />
          </div>

          <ol className="steps compact-steps">
            {steps.length === 0 && <li className="empty-step">任务启动后显示步骤。</li>}
            {steps.map((step) => (
              <li key={step.stepKey} data-status={step.status}>
                <span>{step.title}</span>
                <strong>{step.status}</strong>
              </li>
            ))}
          </ol>
        </section>

        <section className="panel review-panel">
          <div className="section-title">
            <h2>修订审核</h2>
            <div className="button-row">
              <button
                type="button"
                disabled={!task || revisions.length === 0 || busy}
                onClick={() =>
                  run("确认无风险修订", async () => {
                    await approveSafeRevisions();
                  })
                }
              >
                <Check size={16} />
                确认无风险
              </button>
              <button
                type="button"
                disabled={!task || revisions.length === 0 || busy}
                onClick={() =>
                  task &&
                  run("批量确认", async () => {
                    await approveAllRevisions(task.id);
                    await refresh(task.id);
                  })
                }
              >
                <Check size={16} />
                全部确认
              </button>
              <button
                type="button"
                disabled={!task || revisionStats.approved === 0 || busy}
                onClick={() =>
                  task &&
                  run("应用修订", async () => {
                    await applyTask(task.id);
                    await refresh(task.id);
                  })
                }
              >
                <Save size={16} />
                应用
              </button>
              <button
                type="button"
                disabled={!task || busy}
                onClick={() =>
                  task &&
                  run("回滚修改", async () => {
                    await rollbackTask(task.id);
                    await refresh(task.id);
                  })
                }
              >
                <RotateCcw size={16} />
                回滚
              </button>
            </div>
          </div>

          <div className="revision-table" data-testid="revision-list">
            {revisions.length === 0 && <p className="empty">任务完成后会在这里显示可审核修订。</p>}
            {revisions.map((revision) => (
              <button key={revision.id} type="button" className="revision-row" onClick={() => openRevision(revision)}>
                <span className={`badge status-${revision.status}`}>{revision.status}</span>
                <span className="revision-preview">{preview(revision.revisedText || revision.originalText)}</span>
                <span className="revision-meta">{Math.round(revision.confidence * 100)}%</span>
                <span className={revision.riskFlags.length ? "badge warning" : "badge good"}>
                  {revision.riskFlags.length ? "需复核" : "无风险"}
                </span>
              </button>
            ))}
          </div>
        </section>
      </section>

      <footer>SQLite 已记录任务、步骤、工具调用、模型调用、写回补丁和回滚日志。</footer>

      {modal === "directory" && (
        <Modal title="选择 LaTeX 项目目录" onClose={() => setModal(null)} wide>
          <div className="directory-toolbar">
            <button
              type="button"
              disabled={!browser?.parentDir}
              onClick={() =>
                browser?.parentDir &&
                run("返回上级", async () => {
                  await loadBrowser(browser.parentDir);
                })
              }
            >
              <ChevronLeft size={16} />
              上级
            </button>
            <span title={browser?.currentDir}>{browser?.currentDir || "正在读取目录"}</span>
          </div>
          <div className="directory-list modal-list" data-testid="directory-browser">
            {browser?.entries.map((entry) => (
              <div key={entry.path} className="directory-row">
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    run("打开目录", async () => {
                      await loadBrowser(entry.path);
                    })
                  }
                >
                  <FolderOpen size={15} />
                  {entry.name}
                </button>
                <span className={entry.isLatexProject ? "badge good" : "badge"}>{entry.texFiles} tex</span>
                <button
                  type="button"
                  onClick={() =>
                    run("选择目录", async () => {
                      await chooseProjectDir(entry.path);
                    })
                  }
                >
                  选择
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {modal === "settings" && (
        <Modal title="任务设置" onClose={() => setModal(null)}>
          <label className="checkbox-line">
            <input
              data-testid="limit-segments-checkbox"
              type="checkbox"
              checked={limitSegments}
              onChange={(event) => setLimitSegments(event.target.checked)}
            />
            限制处理数量
          </label>
          <label>
            安全上限
            <input
              data-testid="max-segments-input"
              type="number"
              min={1}
              max={500}
              disabled={!limitSegments}
              value={maxSegments}
              onChange={(event) => setMaxSegments(Math.max(1, Math.min(500, Number(event.target.value) || 1)))}
            />
          </label>
          <p className="hint">关闭限制时会处理报告匹配到的全部风险段落；开启后仅用于控制模型调用成本。</p>
        </Modal>
      )}

      {modal === "history" && (
        <Modal title="历史任务" onClose={() => setModal(null)}>
          <div className="history-list">
            {recentTasks.length === 0 && <p className="empty">暂无历史任务。</p>}
            {recentTasks.map((item) => (
              <button key={item.id} type="button" onClick={() => void loadTask(item.id)}>
                <span>{item.id}</span>
                <strong>{item.state}</strong>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {modal === "events" && (
        <Modal title="任务事件" onClose={() => setModal(null)} wide>
          <div className="events modal-list">
            {events.map((event) => (
              <p key={event.id}>
                <span>{event.sequence}</span>
                {event.message}
              </p>
            ))}
          </div>
        </Modal>
      )}

      {modal === "revision" && selectedRevision && task && (
        <Modal title="修订详情" onClose={() => setModal(null)} wide>
          <div className="revision-detail-meta">
            <span className={`badge status-${selectedRevision.status}`}>{selectedRevision.status}</span>
            <span>{Math.round(selectedRevision.confidence * 100)}%</span>
            {selectedRevision.riskFlags.map((flag) => (
              <span key={flag} className="badge warning">
                {flag}
              </span>
            ))}
          </div>
          <div className="diff">
            <label>
              原文
              <textarea value={selectedRevision.originalText} readOnly />
            </label>
            <label>
              修订
              <textarea
                value={editing[selectedRevision.id] ?? selectedRevision.revisedText ?? selectedRevision.originalText}
                onChange={(event) =>
                  setEditing((current) => ({
                    ...current,
                    [selectedRevision.id]: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          <p className="note">{selectedRevision.revisionNote}</p>
          <div className="button-row modal-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run("保存修订", async () => {
                  await editRevision(
                    task.id,
                    selectedRevision.id,
                    editing[selectedRevision.id] ?? selectedRevision.revisedText ?? "",
                  );
                  await refresh(task.id);
                })
              }
            >
              <Save size={16} />
              保存
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run("重新生成", async () => {
                  await regenerateRevision(task.id, selectedRevision.id);
                  await refresh(task.id);
                })
              }
            >
              <RefreshCw size={16} />
              重新生成
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run("确认修订", async () => {
                  await approveRevision(task.id, selectedRevision.id);
                  await refresh(task.id);
                })
              }
            >
              <Check size={16} />
              确认
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run("拒绝修订", async () => {
                  await rejectRevision(task.id, selectedRevision.id);
                  await refresh(task.id);
                })
              }
            >
              <X size={16} />
              拒绝
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={wide ? "modal modal-wide" : "modal"} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function preview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 140 ? `${compact.slice(0, 140)}...` : compact;
}
