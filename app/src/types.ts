export type Mode = "incremental" | "mirror";
export type VerifyMode = "off" | "quick" | "full";
export type TaskStatus =
  | "idle"
  | "scanning"
  | "running"
  | "verifying"
  | "done"
  | "failed"
  | "canceled";

/** 一个复制任务。前缀 rt* 的是运行时状态，不持久化。 */
export interface Task {
  id: string;
  source: string;
  destination: string;
  mode: Mode;
  createSubfolder: boolean;
  // 运行时
  rtStatus: TaskStatus;
  rtPercent: number;
  rtSpeedBps: number;
  rtEtaSecs: number;
  rtMessage: string;
  rtTotalFiles: number;
  rtProcessedFiles: number;
}

export interface GlobalOptions {
  concurrency: number;
  threads: number;
  retry: number;
  wait: number;
  includeEmpty: boolean;
  restartable: boolean;
  unbuffered: boolean;
  skipOlder: boolean;
  dryRun: boolean;
  excludeDirs: string[];
  excludeFiles: string[];
  verify: VerifyMode;
}

export interface Preset {
  name: string;
  tasks: Task[];
  options: GlobalOptions;
}

export interface PersistState {
  tasks: Task[];
  options: GlobalOptions;
  presets: Preset[];
}

export interface ProgressEvent {
  id: string;
  status: TaskStatus;
  totalBytes: number;
  totalFiles: number;
  copiedBytes: number;
  processedFiles: number;
  percent: number;
  speedBps: number;
  etaSecs: number;
  exitCode: number;
  message: string;
}

export interface LogEvent {
  id: string;
  line: string;
}

export interface BatchDoneEvent {
  succeeded: number;
  failed: number;
  canceled: boolean;
}

export const DEFAULT_OPTIONS: GlobalOptions = {
  concurrency: 2,
  threads: 16,
  retry: 3,
  wait: 5,
  includeEmpty: true,
  restartable: true,
  unbuffered: true,
  skipOlder: true,
  dryRun: false,
  excludeDirs: ["$RECYCLE.BIN", "System Volume Information", ".git", "node_modules"],
  excludeFiles: ["thumbs.db", "desktop.ini"],
  verify: "off",
};

export function freshRuntime(): Pick<
  Task,
  | "rtStatus"
  | "rtPercent"
  | "rtSpeedBps"
  | "rtEtaSecs"
  | "rtMessage"
  | "rtTotalFiles"
  | "rtProcessedFiles"
> {
  return {
    rtStatus: "idle",
    rtPercent: 0,
    rtSpeedBps: 0,
    rtEtaSecs: 0,
    rtMessage: "",
    rtTotalFiles: 0,
    rtProcessedFiles: 0,
  };
}
