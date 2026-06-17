//! Smart Copy Tool - Tauri 后端入口。
//!
//! 通过 robocopy 执行稳定的文件迁移，提供：任务级参数、有限并行、实时进度/速度/ETA、
//! 复制后校验、命名预设持久化。

mod copy;
mod model;
mod verify;

use model::{BatchDonePayload, GlobalOptions, TaskInput, VerifyResult};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

/// 全局运行引擎状态。
#[derive(Clone)]
struct Engine {
    cancel: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    pids: Arc<Mutex<Vec<u32>>>,
}

impl Engine {
    fn new() -> Self {
        Engine {
            cancel: Arc::new(AtomicBool::new(false)),
            running: Arc::new(AtomicBool::new(false)),
            pids: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

/// 解析并创建日志目录（应用配置目录下的 logs/）。
fn log_dir(app: &AppHandle) -> std::path::PathBuf {
    let base = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let dir = base.join("logs");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// 启动一批任务（立即返回，进度通过事件推送）。
#[tauri::command]
fn start_batch(
    app: AppHandle,
    engine: State<Engine>,
    tasks: Vec<TaskInput>,
    options: GlobalOptions,
) -> Result<(), String> {
    if engine.running.load(Ordering::SeqCst) {
        return Err("已有任务在运行中".into());
    }
    if tasks.is_empty() {
        return Err("没有可执行的任务".into());
    }

    engine.cancel.store(false, Ordering::SeqCst);
    engine.running.store(true, Ordering::SeqCst);
    engine.pids.lock().unwrap().clear();

    let cancel = engine.cancel.clone();
    let running = engine.running.clone();
    let pids = engine.pids.clone();
    let dir = log_dir(&app);
    let concurrency = options.concurrency.max(1) as usize;

    // 协调线程：用 N 个 worker 共享一个队列，天然限制并行度。
    std::thread::spawn(move || {
        let queue: Arc<Mutex<VecDeque<TaskInput>>> = Arc::new(Mutex::new(VecDeque::from(tasks)));
        let succeeded = Arc::new(Mutex::new(0u32));
        let failed = Arc::new(Mutex::new(0u32));

        let mut handles = Vec::new();
        for _ in 0..concurrency {
            let app = app.clone();
            let cancel = cancel.clone();
            let pids = pids.clone();
            let options = options.clone();
            let dir = dir.clone();
            let queue = queue.clone();
            let succeeded = succeeded.clone();
            let failed = failed.clone();

            handles.push(std::thread::spawn(move || loop {
                if cancel.load(Ordering::SeqCst) {
                    break;
                }
                let task = {
                    let mut q = queue.lock().unwrap();
                    q.pop_front()
                };
                let Some(task) = task else { break };

                let ok = copy::run_one_task(&app, &cancel, &pids, &task, &options, &dir);
                if ok {
                    *succeeded.lock().unwrap() += 1;
                } else {
                    *failed.lock().unwrap() += 1;
                }
            }));
        }

        for h in handles {
            let _ = h.join();
        }

        let canceled = cancel.load(Ordering::SeqCst);
        running.store(false, Ordering::SeqCst);
        let _ = app.emit(
            "batch-done",
            BatchDonePayload {
                succeeded: *succeeded.lock().unwrap(),
                failed: *failed.lock().unwrap(),
                canceled,
            },
        );
    });

    Ok(())
}

/// 停止当前批次：设置取消标志并杀掉所有 robocopy 进程。
#[tauri::command]
fn stop_batch(engine: State<Engine>) -> Result<(), String> {
    engine.cancel.store(true, Ordering::SeqCst);
    let pids: Vec<u32> = engine.pids.lock().unwrap().clone();
    copy::kill_pids(&pids);
    Ok(())
}

/// 预扫描一个目录，返回 { bytes, files }。
#[tauri::command]
fn scan_size(path: String) -> serde_json::Value {
    let (bytes, files) = copy::scan_source(&path);
    serde_json::json!({ "bytes": bytes, "files": files })
}

/// 手动对单个任务做校验。
#[tauri::command]
fn verify_now(
    source: String,
    destination: String,
    create_subfolder: bool,
    full: bool,
) -> VerifyResult {
    verify::verify_task(&source, &destination, create_subfolder, full)
}

/// 读取持久化状态（任务、参数、预设）。
#[tauri::command]
fn load_state(app: AppHandle) -> serde_json::Value {
    let path = app
        .path()
        .app_config_dir()
        .map(|d| d.join("state.json"))
        .ok();
    if let Some(path) = path {
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                return value;
            }
        }
    }
    serde_json::Value::Null
}

/// 保存持久化状态。
#[tauri::command]
fn save_state(app: AppHandle, state: serde_json::Value) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("state.json");
    let text = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(())
}

/// 打开日志目录（资源管理器）。
#[tauri::command]
fn open_log_dir(app: AppHandle) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let dir = log_dir(&app);
    // explorer 即使成功也可能返回非零退出码，这里只关心是否能启动。
    std::process::Command::new("explorer")
        .arg(dir)
        .creation_flags(0x0800_0000)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Engine::new())
        .invoke_handler(tauri::generate_handler![
            start_batch,
            stop_batch,
            scan_size,
            verify_now,
            load_state,
            save_state,
            open_log_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
