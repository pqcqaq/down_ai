import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  FileText,
  FolderOpen,
  History,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
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

export function App() {
  const [projectDir, setProjectDir] = useState("tests/fixtures/realistic-thesis");
  const [maxSegments, setMaxSegments] = useState(3);
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
  const [editing, setEditing] = useState<Record<string, string>>({});

  const revisionStats = useMemo(() => {
    const approved = revisions.filter((revision) => revision.status === "approved").length;
    const applied = revisions.filter((revision) => revision.status === "applied").length;
    const risky = revisions.filter((revision) => revision.riskFlags.length > 0).length;
    return { approved, applied, risky, total: revisions.length };
  }, [revisions]);

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

  async function startDryRun() {
    const inspected = await inspectWorkspace(projectDir);
    setWorkspace(inspected);
    if (!inspected.exists) {
      throw new Error("项目目录不可用。");
    }
    const created = await createTask({ projectDir: inspected.projectDir, reportFileId, maxSegments });
    setTask(created.task);
    const started = await startTask(created.task.id);
    setTask(started.task);
    await refresh(created.task.id);
  }

  async function loadTask(taskId: string) {
    await refresh(taskId);
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

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Down AI Agent</p>
          <h1>LaTeX 修订工作台</h1>
        </div>
        <div className="status-stack">
          <span className={`state-pill state-${task?.state ?? "idle"}`}>{task?.state ?? "未创建"}</span>
          <span className="muted">{task ? `${task.progressCurrent}/${task.progressTotal} · ${progressPercent}%` : "待开始"}</span>
        </div>
      </header>

      <section className="workspace">
        <aside className="panel input-panel">
          <div className="section-title">
            <h2>输入</h2>
            <button
              type="button"
              onClick={() =>
                run("刷新目录", async () => {
                  await loadBrowser(projectDir);
                })
              }
            >
              <FolderOpen size={16} />
              浏览
            </button>
          </div>

          <label>
            LaTeX 项目目录
            <input
              data-testid="project-dir-input"
              value={projectDir}
              onChange={(event) => setProjectDir(event.target.value)}
            />
          </label>

          <div className="button-row">
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
            <button
              type="button"
              onClick={() =>
                run("载入示例", async () => {
                  await inspectCurrentProject("tests/fixtures/realistic-thesis");
                })
              }
            >
              <Sparkles size={16} />
              示例
            </button>
          </div>

          {browser && (
            <div className="directory-browser" data-testid="directory-browser">
              <div className="directory-toolbar">
                <button
                  type="button"
                  disabled={!browser.parentDir}
                  onClick={() =>
                    browser.parentDir &&
                    run("返回上级", async () => {
                      await loadBrowser(browser.parentDir);
                    })
                  }
                >
                  <ChevronLeft size={16} />
                  上级
                </button>
                <span title={browser.currentDir}>{browser.currentDir}</span>
              </div>
              <div className="directory-list">
                {browser.entries.map((entry) => (
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
                          await inspectCurrentProject(entry.path);
                        })
                      }
                    >
                      选择
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <label>
            最大处理段落
            <input
              data-testid="max-segments-input"
              type="number"
              min={1}
              max={20}
              value={maxSegments}
              onChange={(event) => setMaxSegments(Number(event.target.value))}
            />
          </label>

          <label className="file-button">
            <Upload size={16} />
            上传报告 PDF
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
            className="primary"
            disabled={busy}
            type="button"
            onClick={() => run("创建并启动 dry-run", startDryRun)}
          >
            {busy ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
            创建并启动
          </button>

          {workspace && (
            <dl className="facts">
              <div>
                <dt>TeX</dt>
                <dd>{workspace.texFiles}</dd>
              </div>
              <div>
                <dt>BibTeX</dt>
                <dd>{workspace.bibFiles}</dd>
              </div>
              <div>
                <dt>主文件</dt>
                <dd>{workspace.rootCandidates.length}</dd>
              </div>
            </dl>
          )}

          {reportFileId && (
            <p className="hint">
              {reportName || reportFileId}
              {reportFindingCount == null ? "" : ` · ${reportFindingCount} 条报告线索`}
            </p>
          )}
          {message && <p className="message">{message}</p>}
        </aside>

        <section className="panel progress-panel">
          <div className="section-title">
            <h2>进度</h2>
            <button type="button" onClick={() => void refresh()} disabled={!task || busy}>
              <RefreshCw size={16} />
              刷新
            </button>
          </div>

          <div className="task-summary">
            <div>
              <span className="metric">{task?.id.slice(0, 12) ?? "暂无任务"}</span>
              <span className="muted">当前任务</span>
            </div>
            <div>
              <span className="metric">{revisionStats.total}</span>
              <span className="muted">修订</span>
            </div>
            <div>
              <span className="metric">{revisionStats.approved}</span>
              <span className="muted">已确认</span>
            </div>
          </div>

          <div className="progress-track">
            <span style={{ width: `${progressPercent}%` }} />
          </div>

          <ol className="steps">
            {steps.map((step) => (
              <li key={step.stepKey} data-status={step.status}>
                <span>{step.title}</span>
                <strong>{step.status}</strong>
              </li>
            ))}
          </ol>

          <h3>最近任务</h3>
          <div className="recent-list">
            {recentTasks.map((item) => (
              <button key={item.id} type="button" onClick={() => void loadTask(item.id)}>
                <span>{item.id.slice(0, 14)}</span>
                <strong>{item.state}</strong>
              </button>
            ))}
          </div>

          <h3>事件</h3>
          <div className="events">
            {events.slice(-12).map((event) => (
              <p key={event.id}>
                <span>{event.sequence}</span>
                {event.message}
              </p>
            ))}
          </div>
        </section>

        <section className="panel review-panel">
          <div className="section-title">
            <h2>修订审核</h2>
            <div className="button-row">
              <button
                type="button"
                disabled={!task || revisions.length === 0 || busy}
                onClick={() =>
                  task &&
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

          <div className="review-stats">
            <span>{revisionStats.total} 条修订</span>
            <span>{revisionStats.risky} 条需复核</span>
            <span>{revisionStats.applied} 条已写回</span>
          </div>

          <div className="revision-list" data-testid="revision-list">
            {revisions.length === 0 && <p className="empty">任务完成后会在这里显示可审核修订。</p>}
            {revisions.map((revision) => (
              <article key={revision.id} className="revision">
                <div className="revision-meta">
                  <span className={`badge status-${revision.status}`}>{revision.status}</span>
                  <span>{Math.round(revision.confidence * 100)}%</span>
                  {revision.riskFlags.map((flag) => (
                    <span key={flag} className="badge warning">
                      {flag}
                    </span>
                  ))}
                </div>
                <div className="diff">
                  <label>
                    原文
                    <textarea value={revision.originalText} readOnly />
                  </label>
                  <label>
                    修订
                    <textarea
                      value={editing[revision.id] ?? revision.revisedText ?? revision.originalText}
                      onChange={(event) =>
                        setEditing((current) => ({
                          ...current,
                          [revision.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <p className="note">{revision.revisionNote}</p>
                <div className="button-row">
                  <button
                    type="button"
                    disabled={!task || busy}
                    onClick={() =>
                      task &&
                      run("保存修订", async () => {
                        await editRevision(task.id, revision.id, editing[revision.id] ?? revision.revisedText ?? "");
                        await refresh(task.id);
                      })
                    }
                  >
                    <Save size={16} />
                    保存
                  </button>
                  <button
                    type="button"
                    disabled={!task || busy}
                    onClick={() =>
                      task &&
                      run("重新生成", async () => {
                        await regenerateRevision(task.id, revision.id);
                        await refresh(task.id);
                      })
                    }
                  >
                    <RefreshCw size={16} />
                    重新生成
                  </button>
                  <button
                    type="button"
                    disabled={!task || busy}
                    onClick={() =>
                      task &&
                      run("确认修订", async () => {
                        await approveRevision(task.id, revision.id);
                        await refresh(task.id);
                      })
                    }
                  >
                    <Check size={16} />
                    确认
                  </button>
                  <button
                    type="button"
                    disabled={!task || busy}
                    onClick={() =>
                      task &&
                      run("拒绝修订", async () => {
                        await rejectRevision(task.id, revision.id);
                        await refresh(task.id);
                      })
                    }
                  >
                    <X size={16} />
                    拒绝
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>

      <footer>
        <History size={16} />
        SQLite 已记录任务、步骤、工具调用、模型调用、写回补丁和回滚日志。
      </footer>
    </main>
  );
}
