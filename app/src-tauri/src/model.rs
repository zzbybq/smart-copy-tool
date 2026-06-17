//! 前后端共享的数据结构（serde camelCase 与 TypeScript 对齐）。

use serde::{Deserialize, Serialize};

/// 单个复制任务的输入。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub id: String,
    pub source: String,
    pub destination: String,
    /// "incremental" | "mirror"
    pub mode: String,
    /// 是否在目标下创建“源同名子目录”。
    pub create_subfolder: bool,
}

/// 一批任务共享的全局参数。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalOptions {
    /// 同时运行的任务数（并行度）。
    pub concurrency: u32,
    /// robocopy /MT 线程数。
    pub threads: u32,
    pub retry: u32,
    pub wait: u32,
    pub include_empty: bool,
    pub restartable: bool,
    pub unbuffered: bool,
    pub skip_older: bool,
    pub dry_run: bool,
    pub exclude_dirs: Vec<String>,
    pub exclude_files: Vec<String>,
    /// "off" | "quick" | "full"
    pub verify: String,
}

/// 进度/状态事件，emit 到前端 "progress" 频道。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressPayload {
    pub id: String,
    /// scanning | running | verifying | done | failed | canceled
    pub status: String,
    pub total_bytes: u64,
    pub total_files: u64,
    pub copied_bytes: u64,
    pub processed_files: u64,
    pub percent: f64,
    pub speed_bps: f64,
    pub eta_secs: f64,
    pub exit_code: i32,
    pub message: String,
}

impl ProgressPayload {
    pub fn new(id: &str, status: &str) -> Self {
        ProgressPayload {
            id: id.to_string(),
            status: status.to_string(),
            total_bytes: 0,
            total_files: 0,
            copied_bytes: 0,
            processed_files: 0,
            percent: 0.0,
            speed_bps: 0.0,
            eta_secs: 0.0,
            exit_code: 0,
            message: String::new(),
        }
    }
}

/// 单行实时日志，emit 到 "log" 频道。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogPayload {
    pub id: String,
    pub line: String,
}

/// 整批结束汇总，emit 到 "batch-done" 频道。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchDonePayload {
    pub succeeded: u32,
    pub failed: u32,
    pub canceled: bool,
}

/// 校验结果。
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResult {
    pub checked: u64,
    pub missing: u64,
    pub size_mismatch: u64,
    pub hash_mismatch: u64,
    /// 抽样列出的问题文件（最多若干条），便于排查。
    pub samples: Vec<String>,
    pub ok: bool,
}
