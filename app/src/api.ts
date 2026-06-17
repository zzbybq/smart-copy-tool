import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  BatchDoneEvent,
  GlobalOptions,
  LogEvent,
  ProgressEvent,
  Task,
} from "./types";

/** 仅传后端需要的字段，丢掉运行时状态。 */
function toInput(t: Task) {
  return {
    id: t.id,
    source: t.source,
    destination: t.destination,
    mode: t.mode,
    createSubfolder: t.createSubfolder,
  };
}

export async function startBatch(tasks: Task[], options: GlobalOptions): Promise<void> {
  await invoke("start_batch", { tasks: tasks.map(toInput), options });
}

export async function stopBatch(): Promise<void> {
  await invoke("stop_batch");
}

export async function scanSize(path: string): Promise<{ bytes: number; files: number }> {
  return await invoke("scan_size", { path });
}

export interface VerifyResult {
  checked: number;
  missing: number;
  sizeMismatch: number;
  hashMismatch: number;
  samples: string[];
  ok: boolean;
}

export async function verifyNow(
  source: string,
  destination: string,
  createSubfolder: boolean,
  full: boolean,
): Promise<VerifyResult> {
  return await invoke("verify_now", { source, destination, createSubfolder, full });
}

export async function loadState(): Promise<unknown> {
  return await invoke("load_state");
}

export async function saveState(state: unknown): Promise<void> {
  await invoke("save_state", { state });
}

export async function openLogDir(): Promise<void> {
  await invoke("open_log_dir");
}

export function onProgress(cb: (e: ProgressEvent) => void): Promise<UnlistenFn> {
  return listen<ProgressEvent>("progress", (e) => cb(e.payload));
}

export function onLog(cb: (e: LogEvent) => void): Promise<UnlistenFn> {
  return listen<LogEvent>("log", (e) => cb(e.payload));
}

export function onBatchDone(cb: (e: BatchDoneEvent) => void): Promise<UnlistenFn> {
  return listen<BatchDoneEvent>("batch-done", (e) => cb(e.payload));
}
