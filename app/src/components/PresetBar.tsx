import { useState } from "react";
import type { Preset } from "../types";

interface Props {
  presets: Preset[];
  disabled: boolean;
  onLoad: (preset: Preset) => void;
  onSaveAs: (name: string) => void;
  onDelete: (name: string) => void;
}

export default function PresetBar({ presets, disabled, onLoad, onSaveAs, onDelete }: Props) {
  const [selected, setSelected] = useState<string>("");

  const current = presets.find((p) => p.name === selected);

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-slate-500">预设</span>
      {presets.length === 0 ? (
        <span className="text-xs text-slate-400">
          还没有预设，配好任务后点「另存为」保存，以后可一键载入
        </span>
      ) : (
        <select
          className="min-w-40 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none disabled:opacity-50"
          value={selected}
          disabled={disabled}
          onChange={(e) => {
            const name = e.target.value;
            setSelected(name);
            const p = presets.find((x) => x.name === name);
            if (p) onLoad(p); // 选中即自动载入
          }}
        >
          <option value="">— 选择预设 —</option>
          {presets.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <button
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40"
        disabled={disabled}
        onClick={() => {
          const name = window.prompt("预设名称（同名会覆盖）：", selected || "");
          if (name && name.trim()) {
            onSaveAs(name.trim());
            setSelected(name.trim());
          }
        }}
      >
        另存为
      </button>
      <button
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-rose-600 hover:bg-slate-100 disabled:opacity-40"
        disabled={disabled || !current}
        onClick={() => {
          if (current && window.confirm(`删除预设「${current.name}」？`)) {
            onDelete(current.name);
            setSelected("");
          }
        }}
      >
        删除
      </button>
    </div>
  );
}
