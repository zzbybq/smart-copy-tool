import { useEffect, useRef } from "react";

interface Props {
  lines: string[];
  onClear: () => void;
  onOpenLogDir: () => void;
}

export default function LogPanel({ lines, onClear, onOpenLogDir }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = boxRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <span className="text-sm font-medium text-slate-700">运行日志</span>
        <div className="flex gap-2">
          <button
            className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
            onClick={onOpenLogDir}
          >
            打开日志目录
          </button>
          <button
            className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
            onClick={onClear}
          >
            清空
          </button>
        </div>
      </div>
      <div
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex-1 overflow-auto rounded-b-xl bg-slate-50 px-3 py-2 font-mono text-[12px] leading-5 text-slate-700"
      >
        {lines.length === 0 ? (
          <div className="text-slate-400">（暂无日志）</div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {l}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
