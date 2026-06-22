import { useRef } from "react";
import type { Mode, Task, TaskStatus } from "../types";
import { formatEta, formatSpeed } from "../format";

interface Props {
  tasks: Task[];
  disabled: boolean;
  onReorder: (fromId: string, toId: string) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onPatch: (id: string, patch: Partial<Task>) => void;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  idle: "待运行",
  scanning: "扫描中",
  running: "复制中",
  verifying: "校验中",
  done: "完成",
  failed: "失败",
  canceled: "已取消",
};

const STATUS_CLS: Record<TaskStatus, string> = {
  idle: "bg-slate-200 text-slate-700",
  scanning: "bg-amber-500 text-white",
  running: "bg-sky-600 text-white",
  verifying: "bg-violet-600 text-white",
  done: "bg-emerald-600 text-white",
  failed: "bg-rose-600 text-white",
  canceled: "bg-slate-300 text-slate-600",
};

function ProgressBar({ task }: { task: Task }) {
  const pct = Math.max(0, Math.min(100, task.rtPercent));
  const barColor =
    task.rtStatus === "failed"
      ? "bg-rose-500"
      : task.rtStatus === "done"
        ? "bg-emerald-500"
        : task.rtStatus === "verifying"
          ? "bg-violet-500"
          : "bg-sky-500";
  return (
    <div className="w-full">
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full transition-all duration-200 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate-500">
        <span>{pct.toFixed(0)}%</span>
        <span>
          {task.rtProcessedFiles}/{task.rtTotalFiles} 个
        </span>
      </div>
    </div>
  );
}

export default function TaskTable({
  tasks,
  disabled,
  onReorder,
  onEdit,
  onDelete,
  onPatch,
}: Props) {
  const dragFrom = useRef<string | null>(null);

  if (tasks.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-sm text-slate-400">
        还没有任务。上面选择“源 / 目标”后点击「添加任务」。
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="w-8 px-2 py-2"></th>
            <th className="px-3 py-2">源 / 目标</th>
            <th className="w-28 px-2 py-2">模式</th>
            <th className="w-20 px-2 py-2 text-center">同名子目录</th>
            <th className="w-56 px-3 py-2">进度</th>
            <th className="w-24 px-2 py-2">速度</th>
            <th className="w-24 px-2 py-2">剩余</th>
            <th className="w-20 px-2 py-2 text-center">状态</th>
            <th className="w-20 px-2 py-2 text-center">操作</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr
              key={task.id}
              draggable={!disabled}
              onDragStart={() => (dragFrom.current = task.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragFrom.current !== null && dragFrom.current !== task.id) {
                  onReorder(dragFrom.current, task.id);
                }
                dragFrom.current = null;
              }}
              className="border-t border-slate-200 align-middle hover:bg-slate-50"
            >
              <td className="cursor-grab px-2 py-3 text-center text-slate-400 select-none">⋮⋮</td>
              <td className="px-3 py-3">
                <div className="truncate font-medium text-slate-900" title={task.source}>
                  {task.source}
                </div>
                <div className="truncate text-xs text-slate-500" title={task.destination}>
                  → {task.destination}
                </div>
                {task.rtMessage && (
                  <div className="mt-0.5 truncate text-[11px] text-slate-400" title={task.rtMessage}>
                    {task.rtMessage}
                  </div>
                )}
              </td>
              <td className="px-2 py-3">
                <select
                  className="w-full rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-900 focus:border-sky-500 focus:outline-none disabled:opacity-50"
                  value={task.mode}
                  disabled={disabled}
                  onChange={(e) => onPatch(task.id, { mode: e.target.value as Mode })}
                >
                  <option value="incremental">增量</option>
                  <option value="mirror">镜像</option>
                </select>
              </td>
              <td className="px-2 py-3 text-center">
                <input
                  type="checkbox"
                  className="size-4 accent-sky-600"
                  checked={task.createSubfolder}
                  disabled={disabled}
                  onChange={(e) => onPatch(task.id, { createSubfolder: e.target.checked })}
                />
              </td>
              <td className="px-3 py-3">
                <ProgressBar task={task} />
              </td>
              <td className="px-2 py-3 text-xs text-slate-600">{formatSpeed(task.rtSpeedBps)}</td>
              <td className="px-2 py-3 text-xs text-slate-600">{formatEta(task.rtEtaSecs)}</td>
              <td className="px-2 py-3 text-center">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-[11px] ${STATUS_CLS[task.rtStatus]}`}
                >
                  {STATUS_LABEL[task.rtStatus]}
                </span>
              </td>
              <td className="px-2 py-3">
                <div className="flex justify-center gap-1">
                  <button
                    className="rounded px-1.5 py-0.5 text-xs text-sky-600 hover:bg-slate-100 disabled:opacity-40"
                    disabled={disabled}
                    onClick={() => onEdit(task)}
                    title="编辑"
                  >
                    改
                  </button>
                  <button
                    className="rounded px-1.5 py-0.5 text-xs text-rose-600 hover:bg-slate-100 disabled:opacity-40"
                    disabled={disabled}
                    onClick={() => onDelete(task.id)}
                    title="删除"
                  >
                    删
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
