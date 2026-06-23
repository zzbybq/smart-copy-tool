import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  loadState,
  onBatchDone,
  onLog,
  onProgress,
  openLogDir,
  saveState,
  startBatch,
  stopBatch,
} from "./api";
import {
  DEFAULT_OPTIONS,
  freshRuntime,
  type GlobalOptions,
  type Preset,
  type Task,
} from "./types";
import { newId, formatDuration } from "./format";
import OptionsPanel from "./components/OptionsPanel";
import TaskTable from "./components/TaskTable";
import EditTaskModal from "./components/EditTaskModal";
import PresetBar from "./components/PresetBar";
import LogPanel from "./components/LogPanel";

const MAX_LOG_LINES = 2000;

function leafName(p: string): string {
  const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function hydrateTask(raw: Partial<Task>): Task {
  return {
    id: raw.id ?? newId(),
    source: raw.source ?? "",
    destination: raw.destination ?? "",
    mode: raw.mode === "mirror" ? "mirror" : "incremental",
    createSubfolder: raw.createSubfolder ?? true,
    ...freshRuntime(),
  };
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [options, setOptions] = useState<GlobalOptions>(DEFAULT_OPTIONS);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [source, setSource] = useState("");
  const [dest, setDest] = useState("");
  const [createSubfolder, setCreateSubfolder] = useState(true);
  const [multiSources, setMultiSources] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [editing, setEditing] = useState<Task | null>(null);
  const [toast, setToast] = useState<string>("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef<number | null>(null);
  const [view, setView] = useState<"active" | "done">("active");

  // 最新值的引用，供持久化使用，避免闭包过期
  const latest = useRef({ tasks, options, presets });
  latest.current = { tasks, options, presets };

  // 载入持久化状态
  useEffect(() => {
    (async () => {
      const raw = (await loadState()) as
        | { tasks?: Partial<Task>[]; options?: Partial<GlobalOptions>; presets?: Preset[] }
        | null;
      if (raw && typeof raw === "object") {
        if (Array.isArray(raw.tasks)) setTasks(raw.tasks.map(hydrateTask));
        if (raw.options) setOptions({ ...DEFAULT_OPTIONS, ...raw.options });
        if (Array.isArray(raw.presets)) {
          setPresets(
            raw.presets.map((p) => ({
              name: p.name,
              options: { ...DEFAULT_OPTIONS, ...p.options },
              tasks: (p.tasks ?? []).map(hydrateTask),
            })),
          );
        }
      }
    })();
  }, []);

  // 持久化（去掉运行时字段），防抖 400ms
  const persistTimer = useRef<number | null>(null);
  const schedulePersist = useCallback(() => {
    if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      const strip = (t: Task) => ({
        id: t.id,
        source: t.source,
        destination: t.destination,
        mode: t.mode,
        createSubfolder: t.createSubfolder,
      });
      const cur = latest.current;
      void saveState({
        tasks: cur.tasks.map(strip),
        options: cur.options,
        presets: cur.presets.map((p) => ({ ...p, tasks: p.tasks.map(strip) })),
      });
    }, 400);
  }, []);

  // 订阅后端事件
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    let mounted = true;
    const keep = (u: () => void) => (mounted ? unsubs.push(u) : u());

    void onProgress((e) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === e.id
            ? {
                ...t,
                rtStatus: e.status,
                rtPercent: e.percent,
                rtSpeedBps: e.speedBps,
                rtEtaSecs: e.etaSecs,
                rtMessage: e.message,
                rtTotalFiles: e.totalFiles,
                rtProcessedFiles: e.processedFiles,
              }
            : t,
        ),
      );
    }).then(keep);

    void onLog((e) => {
      const short = e.id.length > 12 ? e.id.slice(-6) : e.id;
      setLogs((prev) => {
        const next = [...prev, `[${short}] ${e.line}`];
        return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
      });
    }).then(keep);

    void onBatchDone((e) => {
      setRunning(false);
      if (startedAt.current !== null) setElapsedMs(Date.now() - startedAt.current);
      const elapsed =
        startedAt.current !== null ? `，耗时 ${formatDuration(Date.now() - startedAt.current)}` : "";
      const msg = e.canceled
        ? `任务已取消${elapsed}`
        : `全部完成：成功 ${e.succeeded} 个，失败 ${e.failed} 个${elapsed}`;
      setToast(msg);
      void notify(msg);
      beep();
    }).then(keep);

    return () => {
      mounted = false;
      unsubs.forEach((u) => u());
    };
  }, []);

  // 运行中每秒刷新一次已用时间
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      if (startedAt.current !== null) setElapsedMs(Date.now() - startedAt.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const pick = async (setter: (v: string) => void, current: string) => {
    const selected = await open({ directory: true, defaultPath: current || undefined });
    if (typeof selected === "string") setter(selected);
  };

  // 把若干源追加到“待批量”列表（去重，保留顺序）
  const appendMultiSources = (incoming: string[]) => {
    const cleaned = incoming.map((s) => s.trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    setMultiSources((prev) => {
      const merged = [...prev];
      let added = 0;
      for (const s of cleaned) {
        if (!merged.includes(s)) {
          merged.push(s);
          added++;
        }
      }
      setToast(
        added > 0
          ? `已加入 ${added} 个源，共 ${merged.length} 个待批量。可继续到其他盘选，设置好目标后点「批量添加到目标」`
          : "这些源已在列表中",
      );
      return merged;
    });
  };

  // 选择多个源文件夹（可跨盘多次选，累加；不同盘分多次选即可）
  const pickMultiSources = async () => {
    const selected = await open({
      directory: true,
      multiple: true,
      defaultPath: source || undefined,
    });
    if (Array.isArray(selected)) {
      appendMultiSources(selected);
    } else if (typeof selected === "string") {
      appendMultiSources([selected]);
    }
  };

  // 选择一个或多个文件（不是文件夹），加入待批量列表，复制到同一目标目录
  const pickFiles = async () => {
    const selected = await open({
      directory: false,
      multiple: true,
      defaultPath: source || undefined,
    });
    if (Array.isArray(selected)) {
      appendMultiSources(selected);
    } else if (typeof selected === "string") {
      appendMultiSources([selected]);
    }
  };

  const removeMultiSource = (s: string) => {
    setMultiSources((prev) => prev.filter((x) => x !== s));
  };

  const addTask = () => {
    if (!source.trim() || !dest.trim()) {
      setToast("请先选择源和目标文件夹");
      return;
    }
    setTasks((prev) => [
      ...prev,
      hydrateTask({
        source: source.trim(),
        destination: dest.trim(),
        mode: "incremental",
        createSubfolder,
      }),
    ]);
    schedulePersist();
  };

  // 把已选的多个源，全部添加为指向同一目标的任务
  const addMultiToDest = () => {
    if (multiSources.length === 0) return;
    if (!dest.trim()) {
      setToast("请先选择目标文件夹");
      return;
    }
    const target = dest.trim();
    setTasks((prev) => [
      ...prev,
      ...multiSources.map((s) =>
        hydrateTask({
          source: s,
          destination: target,
          mode: "incremental",
          createSubfolder: true, // 多源汇入同一目标，必须各自成子文件夹，否则会互相覆盖
        }),
      ),
    ]);
    const n = multiSources.length;
    setMultiSources([]);
    schedulePersist();
    setToast(`已添加 ${n} 个任务 → ${target}（各自成为子文件夹）`);
  };

  const patchTask = (id: string, patch: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    schedulePersist();
  };

  const deleteTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    schedulePersist();
  };

  const reorder = (fromId: string, toId: string) => {
    setTasks((prev) => {
      const from = prev.findIndex((t) => t.id === fromId);
      const to = prev.findIndex((t) => t.id === toId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    schedulePersist();
  };

  // 清空未完成任务（保留已完成，方便回看）
  const clearActive = () => {
    const n = tasks.filter((t) => t.rtStatus !== "done").length;
    if (n === 0) return;
    if (!window.confirm(`确认清空 ${n} 个未完成任务？已完成的会保留在「已完成」标签里。`)) return;
    setTasks((prev) => prev.filter((t) => t.rtStatus === "done"));
    schedulePersist();
  };

  // 清空已完成列表
  const clearCompleted = () => {
    setTasks((prev) => prev.filter((t) => t.rtStatus !== "done"));
    schedulePersist();
  };

  const saveEdit = (task: Task) => {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
    setEditing(null);
    schedulePersist();
  };

  const updateOptions = (next: GlobalOptions) => {
    setOptions(next);
    schedulePersist();
  };

  const start = async () => {
    if (tasks.length === 0) {
      setToast("没有任务可执行");
      return;
    }
    const hasMirror = tasks.some((t) => t.mode === "mirror");
    if (
      hasMirror &&
      !window.confirm("有任务使用「镜像」模式，会删除目标里源没有的文件。确认继续？")
    ) {
      return;
    }
    setLogs([]);
    setTasks((prev) => prev.map((t) => ({ ...t, ...freshRuntime() })));
    startedAt.current = Date.now();
    setElapsedMs(0);
    setRunning(true);
    setToast("");
    try {
      await startBatch(tasks, options);
    } catch (err) {
      setRunning(false);
      setToast(`启动失败：${String(err)}`);
    }
  };

  const stop = async () => {
    try {
      await stopBatch();
    } catch (err) {
      setToast(`停止失败：${String(err)}`);
    }
  };

  // 预设
  const saveAsPreset = (name: string) => {
    const preset: Preset = { name, tasks: tasks.map((t) => ({ ...t })), options };
    setPresets((prev) => [...prev.filter((p) => p.name !== name), preset]);
    schedulePersist();
    setToast(`已保存预设「${name}」`);
  };

  const loadPreset = (preset: Preset) => {
    setTasks(preset.tasks.map((t) => hydrateTask(t)));
    setOptions({ ...DEFAULT_OPTIONS, ...preset.options });
    schedulePersist();
    setToast(`已载入预设「${preset.name}」`);
  };

  const deletePreset = (name: string) => {
    setPresets((prev) => prev.filter((p) => p.name !== name));
    schedulePersist();
  };

  // 总体进度统计
  const totalTasks = tasks.length;
  const finishedTasks = tasks.filter(
    (t) => t.rtStatus === "done" || t.rtStatus === "failed" || t.rtStatus === "canceled",
  ).length;
  const overallPercent =
    totalTasks === 0
      ? 0
      : tasks.reduce((sum, t) => sum + Math.max(0, Math.min(100, t.rtPercent)), 0) / totalTasks;
  const showSummary = running || elapsedMs > 0;

  const activeTasks = tasks.filter((t) => t.rtStatus !== "done");
  const doneTasks = tasks.filter((t) => t.rtStatus === "done");
  const shownTasks = view === "done" ? doneTasks : activeTasks;

  const inputCls =
    "flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none disabled:opacity-50";
  const ghostBtn =
    "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40";

  return (
    <div className="flex h-screen flex-col gap-3 p-4 text-slate-800">
      {/* 顶部：标题 + 预设 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Smart Copy Tool</h1>
          <p className="text-xs text-slate-500">
            基于 robocopy 的稳定文件迁移 · 多任务并行 · 实时进度 · 复制后校验
          </p>
        </div>
        <PresetBar
          presets={presets}
          disabled={running}
          onLoad={loadPreset}
          onSaveAs={saveAsPreset}
          onDelete={deletePreset}
        />
      </div>

      {/* 顶部配置区：内容过高时自身滚动，不挤占下方任务列表 */}
      <div
        className="flex shrink-0 flex-col gap-3 overflow-y-auto"
        style={{ maxHeight: "42vh" }}
      >
      {/* 新增任务卡片 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-semibold text-slate-700">新增任务</div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-sm text-slate-500">源</span>
            <input
              className={inputCls}
              value={source}
              disabled={running}
              placeholder="例如 D:\ai_work\desktop"
              onChange={(e) => setSource(e.target.value)}
            />
            <button
              className={ghostBtn}
              disabled={running}
              title="选择一个或多个文件夹，加入待批量列表（各自作为子目录复制到目标下）"
              onClick={pickMultiSources}
            >
              选择文件夹…
            </button>
            <button
              className={ghostBtn}
              disabled={running}
              title="选择一个或多个文件（而非文件夹），加入待批量列表，直接复制到目标目录"
              onClick={pickFiles}
            >
              选择文件…
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-sm text-slate-500">目标</span>
            <input
              className={inputCls}
              value={dest}
              disabled={running}
              placeholder="例如 D:\work_files"
              onChange={(e) => setDest(e.target.value)}
            />
            <button className={ghostBtn} disabled={running} onClick={() => pick(setDest, dest)}>
              选择…
            </button>
          </div>
        </div>

        {/* 多源待添加提示条 */}
        {multiSources.length > 0 && (
          <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-sky-800">
                待批量 {multiSources.length} 项（可跨盘继续添加）：文件夹会作为子目录，文件直接复制到目标目录
              </span>
              <button
                className="text-xs text-slate-500 hover:text-slate-700"
                disabled={running}
                onClick={() => setMultiSources([])}
              >
                全部清除
              </button>
            </div>
            <div className="mb-2 flex max-h-24 flex-wrap gap-1.5 overflow-auto">
              {multiSources.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200"
                  title={s}
                >
                  {leafName(s)}
                  <button
                    className="text-slate-400 hover:text-rose-600 disabled:opacity-40"
                    disabled={running}
                    title="移除"
                    onClick={() => removeMultiSource(s)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <button
              className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
              disabled={running || !dest.trim()}
              onClick={addMultiToDest}
            >
              批量添加到目标（{multiSources.length} 个 → {dest.trim() || "请先选目标"}）
            </button>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600 select-none">
            <input
              type="checkbox"
              className="size-4 accent-sky-600"
              checked={createSubfolder}
              disabled={running}
              onChange={(e) => setCreateSubfolder(e.target.checked)}
            />
            <span>在目标下创建源同名文件夹（推荐）</span>
          </label>
          <button
            className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
            disabled={running}
            onClick={addTask}
          >
            添加任务
          </button>
          <span className="text-xs text-slate-400">
            源 D:\ai_work\desktop + 目标 D:\work_files → 复制成 D:\work_files\desktop
          </span>
        </div>
      </section>

      <OptionsPanel options={options} disabled={running} onChange={updateOptions} />
      </div>

      {/* 操作行 */}
      <div className="flex items-center gap-3">
        {!running ? (
          <button
            className="rounded-md bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            disabled={tasks.length === 0}
            onClick={start}
          >
            ▶ 开始复制（{tasks.length} 个任务 · 并行 {options.concurrency}）
          </button>
        ) : (
          <button
            className="rounded-md bg-rose-600 px-5 py-2 text-sm font-semibold text-white hover:bg-rose-500"
            onClick={stop}
          >
            ■ 停止
          </button>
        )}
        {toast && <span className="text-sm text-amber-600">{toast}</span>}
      </div>

      {/* 总体进度条 */}
      {showSummary && (
        <div className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700">
              总进度 {finishedTasks}/{totalTasks} 个任务 · {overallPercent.toFixed(0)}%
            </span>
            <span className="text-slate-500">
              {running ? "已用时" : "总耗时"} {formatDuration(elapsedMs)}
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full rounded-full transition-all duration-300 ${running ? "bg-sky-500" : "bg-emerald-500"}`}
              style={{ width: `${overallPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* 任务列表标签 + 清空 */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <button
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              view === "active"
                ? "bg-slate-800 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-100"
            }`}
            onClick={() => setView("active")}
          >
            任务（{activeTasks.length}）
          </button>
          <button
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              view === "done"
                ? "bg-slate-800 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-100"
            }`}
            onClick={() => setView("done")}
          >
            已完成（{doneTasks.length}）
          </button>
        </div>
        {view === "active" ? (
          <button
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-40"
            disabled={running || activeTasks.length === 0}
            onClick={clearActive}
            title="清空未完成任务，已完成的保留在「已完成」标签"
          >
            清空任务
          </button>
        ) : (
          <button
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-40"
            disabled={doneTasks.length === 0}
            onClick={clearCompleted}
            title="清空已完成记录"
          >
            清空已完成
          </button>
        )}
      </div>

      {/* 任务表（可滚动），最小高度保证永不被挤没 */}
      <div className="flex-1" style={{ minHeight: 180 }}>
        <TaskTable
          tasks={shownTasks}
          disabled={running}
          onReorder={reorder}
          onEdit={setEditing}
          onDelete={deleteTask}
          onPatch={patchTask}
        />
      </div>

      {/* 日志 */}
      <div className="h-44 shrink-0">
        <LogPanel lines={logs} onClear={() => setLogs([])} onOpenLogDir={() => void openLogDir()} />
      </div>

      {editing && <EditTaskModal task={editing} onSave={saveEdit} onClose={() => setEditing(null)} />}
    </div>
  );
}

async function notify(message: string) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (granted) {
      sendNotification({ title: "Smart Copy Tool", body: message });
    }
  } catch {
    // 通知失败不影响主流程
  }
}

function beep() {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
  } catch {
    // 忽略
  }
}
