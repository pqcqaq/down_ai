import { useMemo, useState } from "react";
import {
  Check,
  FileText,
  History,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Upload,
  X,
} from "lucide-react";
import {
  applyTask,
  approveRevision,
  createTask,
  editRevision,
  getEvents,
  getRevisions,
  getSteps,
  inspectWorkspace,
  rejectRevision,
  rollbackTask,
  startTask,
  uploadReport,
  type Revision,
  type Task,
  type TaskEvent,
  type TaskStep,
} from "./api";

type WorkspaceInfo = Awaited<ReturnType<typeof inspectWorkspace>>;

export function App() {
  const [projectDir, setProjectDir] = useState("tests/fixtures/latex-project");
  const [maxSegments, setMaxSegments] = useState(3);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | undefined>();
  const [reportFileId, setReportFileId] = useState<string | undefined>();
  const [task, setTask] = useState<Task | undefined>();
  const [steps, setSteps] = useState<TaskStep[]>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<Record<string, string>>({});

  const progressLabel = useMemo(() => {
    if (!task) {
      return "未创建";
    }
    return `${task.progressCurrent}/${task.progressTotal} · ${task.state}`;
  }, [task]);

  async function refresh(taskId = task?.id) {
    if (!taskId) {
      return;
    }
    const [stepPayload, eventPayload, revisionPayload] = await Promise.all([
      getSteps(taskId),
      getEvents(taskId),
      getRevisions(taskId),
    ]);
    setSteps(stepPayload.steps);
    setEvents(eventPayload.events);
    setRevisions(revisionPayload.revisions);
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

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Down AI Agent</p>
          <h1>LaTeX 修订工作台</h1>
        </div>
        <div className="status">{progressLabel}</div>
      </header>

      <section className="workspace">
        <aside className="panel input-panel">
          <h2>任务输入</h2>
          <label>
            LaTeX 项目目录
            <input value={projectDir} onChange={(event) => setProjectDir(event.target.value)} />
          </label>
          <label>
            最大处理段落
            <input
              type="number"
              min={1}
              max={20}
              value={maxSegments}
              onChange={(event) => setMaxSegments(Number(event.target.value))}
            />
          </label>
          <div className="button-row">
            <button
              onClick={() =>
                run("检查项目", async () => {
                  setWorkspace(await inspectWorkspace(projectDir));
                })
              }
            >
              <FileText size={16} />
              检查
            </button>
            <label className="file-button">
              <Upload size={16} />
              上传 PDF
              <input
                type="file"
                accept="application/pdf"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void run("上传报告", async () => {
                    const result = await uploadReport(file);
                    setReportFileId(result.fileId);
                  });
                }}
              />
            </label>
          </div>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run("创建并启动 dry-run", async () => {
                const created = await createTask({ projectDir, reportFileId, maxSegments });
                setTask(created.task);
                const started = await startTask(created.task.id);
                setTask(started.task);
                await refresh(created.task.id);
              })
            }
          >
            <Play size={16} />
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
                <dt>主文件候选</dt>
                <dd>{workspace.rootCandidates.length}</dd>
              </div>
            </dl>
          )}

          {reportFileId && <p className="hint">报告文件：{reportFileId}</p>}
          {message && <p className="message">{message}</p>}
        </aside>

        <section className="panel progress-panel">
          <div className="section-title">
            <h2>进度</h2>
            <button onClick={() => void refresh()} disabled={!task}>
              <RefreshCw size={16} />
              刷新
            </button>
          </div>
          <ol className="steps">
            {steps.map((step) => (
              <li key={step.stepKey} data-status={step.status}>
                <span>{step.title}</span>
                <strong>{step.status}</strong>
              </li>
            ))}
          </ol>
          <h3>事件</h3>
          <div className="events">
            {events.slice(-10).map((event) => (
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
                disabled={!task}
                onClick={() =>
                  run("应用修订", async () => {
                    if (!task) return;
                    await applyTask(task.id);
                    await refresh(task.id);
                  })
                }
              >
                <Save size={16} />
                应用
              </button>
              <button
                disabled={!task}
                onClick={() =>
                  run("回滚修改", async () => {
                    if (!task) return;
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

          <div className="revision-list">
            {revisions.map((revision) => (
              <article key={revision.id} className="revision">
                <div className="revision-meta">
                  <span>{revision.status}</span>
                  <span>{Math.round(revision.confidence * 100)}%</span>
                </div>
                <div className="diff">
                  <textarea value={revision.originalText} readOnly />
                  <textarea
                    value={editing[revision.id] ?? revision.revisedText ?? revision.originalText}
                    onChange={(event) =>
                      setEditing((current) => ({
                        ...current,
                        [revision.id]: event.target.value,
                      }))
                    }
                  />
                </div>
                <p className="note">{revision.revisionNote}</p>
                <div className="button-row">
                  <button
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
        所有步骤和修订记录写入 SQLite，写回前仍需人工确认。
      </footer>
    </main>
  );
}
