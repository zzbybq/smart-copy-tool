import type { GlobalOptions, VerifyMode } from "../types";

interface Props {
  options: GlobalOptions;
  disabled: boolean;
  onChange: (next: GlobalOptions) => void;
}

const numCls =
  "w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-sky-500 focus:outline-none disabled:opacity-50";
const textCls =
  "flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none disabled:opacity-50";

function Num(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <span className="whitespace-nowrap">{props.label}</span>
      <input
        type="number"
        className={numCls}
        min={props.min}
        max={props.max}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) props.onChange(Math.min(props.max, Math.max(props.min, v)));
        }}
      />
    </label>
  );
}

function Check(props: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600 select-none">
      <input
        type="checkbox"
        className="size-4 accent-sky-600"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

export default function OptionsPanel({ options, disabled, onChange }: Props) {
  const set = (patch: Partial<GlobalOptions>) => onChange({ ...options, ...patch });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-sm font-semibold text-slate-700">全局参数</div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
        <Num
          label="并行任务"
          value={options.concurrency}
          min={1}
          max={16}
          disabled={disabled}
          onChange={(v) => set({ concurrency: v })}
        />
        <Num
          label="线程/任务"
          value={options.threads}
          min={1}
          max={128}
          disabled={disabled}
          onChange={(v) => set({ threads: v })}
        />
        <Num
          label="重试次数"
          value={options.retry}
          min={0}
          max={999}
          disabled={disabled}
          onChange={(v) => set({ retry: v })}
        />
        <Num
          label="重试间隔(秒)"
          value={options.wait}
          min={0}
          max={3600}
          disabled={disabled}
          onChange={(v) => set({ wait: v })}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
        <Check
          label="复制空文件夹"
          checked={options.includeEmpty}
          disabled={disabled}
          onChange={(v) => set({ includeEmpty: v })}
        />
        <Check
          label="断点续传"
          checked={options.restartable}
          disabled={disabled}
          onChange={(v) => set({ restartable: v })}
        />
        <Check
          label="大文件优化"
          checked={options.unbuffered}
          disabled={disabled}
          onChange={(v) => set({ unbuffered: v })}
        />
        <Check
          label="目标较新不覆盖"
          checked={options.skipOlder}
          disabled={disabled}
          onChange={(v) => set({ skipOlder: v })}
        />
        <Check
          label="预演(不实际复制)"
          checked={options.dryRun}
          disabled={disabled}
          onChange={(v) => set({ dryRun: v })}
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span className="whitespace-nowrap">复制后校验</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-sky-500 focus:outline-none disabled:opacity-50"
            value={options.verify}
            disabled={disabled}
            onChange={(e) => set({ verify: e.target.value as VerifyMode })}
          >
            <option value="off">关闭</option>
            <option value="quick">快速(大小)</option>
            <option value="full">完整(哈希)</option>
          </select>
        </label>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-20 text-sm text-slate-500">排除目录</span>
          <input
            className={textCls}
            value={options.excludeDirs.join(";")}
            disabled={disabled}
            placeholder="用 ; 分隔，如 .git;node_modules"
            onChange={(e) => set({ excludeDirs: e.target.value.split(";").map((s) => s.trim()) })}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 text-sm text-slate-500">排除文件</span>
          <input
            className={textCls}
            value={options.excludeFiles.join(";")}
            disabled={disabled}
            placeholder="用 ; 分隔，如 thumbs.db;desktop.ini"
            onChange={(e) => set({ excludeFiles: e.target.value.split(";").map((s) => s.trim()) })}
          />
        </div>
      </div>
    </div>
  );
}
