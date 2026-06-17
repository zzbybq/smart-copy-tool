import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { Mode, Task } from "../types";

interface Props {
  task: Task;
  onSave: (task: Task) => void;
  onClose: () => void;
}

export default function EditTaskModal({ task, onSave, onClose }: Props) {
  const [source, setSource] = useState(task.source);
  const [destination, setDestination] = useState(task.destination);
  const [mode, setMode] = useState<Mode>(task.mode);
  const [createSubfolder, setCreateSubfolder] = useState(task.createSubfolder);

  const pick = async (setter: (v: string) => void, current: string) => {
    const selected = await open({ directory: true, defaultPath: current || undefined });
    if (typeof selected === "string") setter(selected);
  };

  const inputCls =
    "flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none";
  const btnCls =
    "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100";

  const valid = source.trim() !== "" && destination.trim() !== "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[640px] max-w-[92vw] rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="mb-4 text-base font-semibold text-slate-900">编辑任务</div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-16 text-sm text-slate-500">源</span>
            <input className={inputCls} value={source} onChange={(e) => setSource(e.target.value)} />
            <button className={btnCls} onClick={() => pick(setSource, source)}>
              选择…
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-sm text-slate-500">目标</span>
            <input
              className={inputCls}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
            <button className={btnCls} onClick={() => pick(setDestination, destination)}>
              选择…
            </button>
          </div>
          <div className="flex items-center gap-6 pt-1">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <span>模式</span>
              <select
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-sky-500 focus:outline-none"
                value={mode}
                onChange={(e) => setMode(e.target.value as Mode)}
              >
                <option value="incremental">增量复制</option>
                <option value="mirror">镜像同步（删除目标多余文件）</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 select-none">
              <input
                type="checkbox"
                className="size-4 accent-sky-600"
                checked={createSubfolder}
                onChange={(e) => setCreateSubfolder(e.target.checked)}
              />
              <span>在目标下创建源同名文件夹</span>
            </label>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button className={btnCls} onClick={onClose}>
            取消
          </button>
          <button
            className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
            disabled={!valid}
            onClick={() =>
              onSave({
                ...task,
                source: source.trim(),
                destination: destination.trim(),
                mode,
                createSubfolder,
              })
            }
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
