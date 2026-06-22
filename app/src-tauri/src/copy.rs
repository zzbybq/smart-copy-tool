//! 复制引擎：预扫描总量 -> 调用 robocopy -> 解析实时输出估算进度/速度/ETA -> 可选校验。
//!
//! 进度策略（与语言环境无关）：
//! - 预先遍历源目录得到 total_files / total_bytes。
//! - robocopy 加 /NDL，使每个被处理的文件输出一行；行内含一个纯数字（字节数，靠 /BYTES）
//!   和一个路径（含反斜杠）。据此累加 processed_files / copied_bytes。
//! - percent 以文件数为准（即使有跳过也能走到 100%）；speed/eta 以字节与耗时估算。

use crate::model::{GlobalOptions, LogPayload, ProgressPayload, TaskInput};
use crate::verify;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 预扫描源（目录或单个文件），返回 (总字节数, 文件数)。
pub fn scan_source(path: &str) -> (u64, u64) {
    let p = Path::new(path);
    if p.is_file() {
        let bytes = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
        return (bytes, 1);
    }
    let mut bytes = 0u64;
    let mut files = 0u64;
    for entry in walkdir::WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            if let Ok(meta) = entry.metadata() {
                bytes += meta.len();
                files += 1;
            }
        }
    }
    (bytes, files)
}

/// 把分号/逗号分隔的排除项拆成列表。
fn split_patterns(items: &[String]) -> Vec<String> {
    items
        .iter()
        .flat_map(|s| s.split([';', ',']))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// 构造 robocopy 参数。`dest` 已是“最终目标目录”（含可能追加的同名子目录）。
///
/// robocopy 没有“复制单个文件”的直接形态，它的命令是
/// `robocopy <源目录> <目标目录> <文件名…>`。所以当源是一个文件时，
/// 把它的父目录作为源目录、文件名作为筛选项，并且不能用 /E /S /MIR 这些递归/镜像开关
/// （/MIR 用在单文件上会把目标目录里其它文件删掉，非常危险）。
pub fn build_args(
    source: &str,
    dest: &Path,
    options: &GlobalOptions,
    mirror: bool,
    log_file: &Path,
) -> Vec<String> {
    let src_path = Path::new(source);
    let is_file = src_path.is_file();

    let mut args: Vec<String> = Vec::new();

    if is_file {
        let parent = src_path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string());
        let fname = src_path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| source.to_string());
        args.push(parent);
        args.push(dest.to_string_lossy().to_string());
        args.push(fname);
        // 单文件：不加任何递归/镜像开关。
    } else {
        args.push(source.to_string());
        args.push(dest.to_string_lossy().to_string());
        args.push("*".to_string());

        if mirror {
            args.push("/MIR".to_string());
        } else if options.include_empty {
            args.push("/E".to_string());
        } else {
            args.push("/S".to_string());
        }
    }

    args.push("/COPY:DAT".to_string());
    args.push("/DCOPY:DAT".to_string());
    args.push("/FFT".to_string());
    args.push("/XJ".to_string());
    args.push(format!("/R:{}", options.retry));
    args.push(format!("/W:{}", options.wait));
    args.push(format!("/MT:{}", options.threads.max(1)));
    args.push("/BYTES".to_string());
    args.push("/NP".to_string());
    args.push("/NDL".to_string());
    args.push("/TEE".to_string());
    args.push(format!("/LOG+:{}", log_file.to_string_lossy()));

    if options.restartable {
        args.push("/Z".to_string());
    }
    if options.unbuffered {
        args.push("/J".to_string());
    }
    if options.skip_older {
        args.push("/XO".to_string());
    }
    if options.dry_run {
        args.push("/L".to_string());
    }

    let exclude_dirs = split_patterns(&options.exclude_dirs);
    if !exclude_dirs.is_empty() {
        args.push("/XD".to_string());
        args.extend(exclude_dirs);
    }
    let exclude_files = split_patterns(&options.exclude_files);
    if !exclude_files.is_empty() {
        args.push("/XF".to_string());
        args.extend(exclude_files);
    }

    args
}

/// 从 robocopy 的一行输出里识别“单文件事件”，返回该文件字节数。
/// 规则：行内含反斜杠路径，且含一个纯数字 token（靠 /BYTES 输出精确字节）。
fn parse_file_bytes(line: &str) -> Option<u64> {
    if !line.contains('\\') {
        return None;
    }
    for tok in line.split_whitespace() {
        if !tok.is_empty() && tok.bytes().all(|b| b.is_ascii_digit()) {
            if let Ok(n) = tok.parse::<u64>() {
                return Some(n);
            }
        }
    }
    None
}

/// 运行单个任务，全程 emit 进度/日志事件。返回 true 表示成功（含校验通过）。
pub fn run_one_task(
    app: &AppHandle,
    cancel: &Arc<AtomicBool>,
    pids: &Arc<Mutex<Vec<u32>>>,
    task: &TaskInput,
    options: &GlobalOptions,
    log_dir: &Path,
) -> bool {
    let id = task.id.clone();

    // 1. 预扫描
    let mut p = ProgressPayload::new(&id, "scanning");
    p.message = "正在统计源目录大小...".into();
    let _ = app.emit("progress", &p);

    let (total_bytes, total_files) = scan_source(&task.source);
    let dest = verify::effective_destination(&task.source, &task.destination, task.create_subfolder);

    let mirror = task.mode == "mirror";
    let log_file = log_dir.join(format!("{}.log", sanitize(&id)));
    let args = build_args(&task.source, &dest, options, mirror, &log_file);

    let _ = std::fs::create_dir_all(&dest);

    let mut p = ProgressPayload::new(&id, "running");
    p.total_bytes = total_bytes;
    p.total_files = total_files;
    p.message = format!("{} -> {}", task.source, dest.to_string_lossy());
    let _ = app.emit("progress", &p);
    emit_log(app, &id, &format!("命令: robocopy {}", args.join(" ")));

    // 2. 启动 robocopy
    let mut child = match Command::new("robocopy")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            let mut p = ProgressPayload::new(&id, "failed");
            p.exit_code = 999;
            p.message = format!("无法启动 robocopy: {}", e);
            let _ = app.emit("progress", &p);
            return false;
        }
    };

    let pid = child.id();
    pids.lock().unwrap().push(pid);

    // 3. 读取输出、解析进度
    let start = Instant::now();
    let mut copied_bytes: u64 = 0;
    let mut processed_files: u64 = 0;
    let mut last_emit = Instant::now();

    if let Some(stdout) = child.stdout.take() {
        let mut reader = BufReader::new(stdout);
        let mut buf: Vec<u8> = Vec::with_capacity(512);
        loop {
            buf.clear();
            let n = match reader.read_until(b'\n', &mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            let _ = n;
            let line = String::from_utf8_lossy(&buf);
            let line = line.trim_end_matches(['\r', '\n']).to_string();
            if line.trim().is_empty() {
                continue;
            }
            emit_log(app, &id, &line);

            if let Some(bytes) = parse_file_bytes(&line) {
                processed_files += 1;
                copied_bytes = copied_bytes.saturating_add(bytes);
            }

            // 取消：杀掉本进程
            if cancel.load(Ordering::SeqCst) {
                let _ = child.kill();
                break;
            }

            if last_emit.elapsed().as_millis() >= 150 {
                emit_running(
                    app,
                    &id,
                    total_bytes,
                    total_files,
                    copied_bytes,
                    processed_files,
                    start,
                );
                last_emit = Instant::now();
            }
        }
    }

    // 排空 stderr 到日志
    if let Some(mut stderr) = child.stderr.take() {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        for line in s.lines() {
            if !line.trim().is_empty() {
                emit_log(app, &id, line);
            }
        }
    }

    let status = child.wait();
    remove_pid(pids, pid);

    let canceled = cancel.load(Ordering::SeqCst);
    let exit_code = status.ok().and_then(|s| s.code()).unwrap_or(-1);

    if canceled {
        let mut p = ProgressPayload::new(&id, "canceled");
        p.total_bytes = total_bytes;
        p.total_files = total_files;
        p.copied_bytes = copied_bytes;
        p.processed_files = processed_files;
        p.exit_code = exit_code;
        p.message = "已取消".into();
        let _ = app.emit("progress", &p);
        return false;
    }

    // robocopy 退出码 0-7 视为成功
    let copy_ok = exit_code >= 0 && exit_code <= 7;
    if !copy_ok {
        let mut p = ProgressPayload::new(&id, "failed");
        p.total_bytes = total_bytes;
        p.total_files = total_files;
        p.copied_bytes = copied_bytes;
        p.processed_files = processed_files;
        p.percent = 100.0;
        p.exit_code = exit_code;
        p.message = format!("robocopy 退出码 {}（8 及以上为失败）", exit_code);
        let _ = app.emit("progress", &p);
        return false;
    }

    // 4. 可选校验
    if options.verify != "off" && !options.dry_run {
        let mut p = ProgressPayload::new(&id, "verifying");
        p.total_bytes = total_bytes;
        p.total_files = total_files;
        p.copied_bytes = copied_bytes;
        p.processed_files = processed_files;
        p.percent = 100.0;
        p.exit_code = exit_code;
        p.message = if options.verify == "full" {
            "正在校验（大小 + 内容哈希）...".into()
        } else {
            "正在校验（大小）...".into()
        };
        let _ = app.emit("progress", &p);

        let full = options.verify == "full";
        let vr = verify::verify_task(&task.source, &task.destination, task.create_subfolder, full);
        for s in &vr.samples {
            emit_log(app, &id, &format!("校验问题 {}", s));
        }

        let mut p = ProgressPayload::new(&id, if vr.ok { "done" } else { "failed" });
        p.total_bytes = total_bytes;
        p.total_files = total_files;
        p.copied_bytes = copied_bytes;
        p.processed_files = processed_files;
        p.percent = 100.0;
        p.exit_code = exit_code;
        p.message = if vr.ok {
            format!("复制完成，校验通过（已核对 {} 个文件）", vr.checked)
        } else {
            format!(
                "复制完成，但校验未通过：缺失 {}，大小不符 {}，内容不符 {}",
                vr.missing, vr.size_mismatch, vr.hash_mismatch
            )
        };
        let _ = app.emit("progress", &p);
        return vr.ok;
    }

    // 5. 完成
    let mut p = ProgressPayload::new(&id, "done");
    p.total_bytes = total_bytes;
    p.total_files = total_files;
    p.copied_bytes = copied_bytes;
    p.processed_files = processed_files.max(total_files);
    p.percent = 100.0;
    p.exit_code = exit_code;
    p.message = format!("完成（退出码 {}）", exit_code);
    let _ = app.emit("progress", &p);
    true
}

fn emit_running(
    app: &AppHandle,
    id: &str,
    total_bytes: u64,
    total_files: u64,
    copied_bytes: u64,
    processed_files: u64,
    start: Instant,
) {
    let elapsed = start.elapsed().as_secs_f64().max(0.001);
    let speed = copied_bytes as f64 / elapsed;
    let percent = if total_files > 0 {
        (processed_files as f64 / total_files as f64 * 100.0).min(100.0)
    } else if total_bytes > 0 {
        (copied_bytes as f64 / total_bytes as f64 * 100.0).min(100.0)
    } else {
        0.0
    };
    let remaining = total_bytes.saturating_sub(copied_bytes) as f64;
    let eta = if speed > 1.0 { remaining / speed } else { 0.0 };

    let mut p = ProgressPayload::new(id, "running");
    p.total_bytes = total_bytes;
    p.total_files = total_files;
    p.copied_bytes = copied_bytes;
    p.processed_files = processed_files;
    p.percent = percent;
    p.speed_bps = speed;
    p.eta_secs = eta;
    let _ = app.emit("progress", &p);
}

fn emit_log(app: &AppHandle, id: &str, line: &str) {
    let _ = app.emit(
        "log",
        LogPayload {
            id: id.to_string(),
            line: line.to_string(),
        },
    );
}

fn remove_pid(pids: &Arc<Mutex<Vec<u32>>>, pid: u32) {
    if let Ok(mut guard) = pids.lock() {
        guard.retain(|&p| p != pid);
    }
}

/// 把任务 id 变成安全的文件名片段。
fn sanitize(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

/// 杀掉一组进程（连同子进程树）。
pub fn kill_pids(pids: &[u32]) {
    for &pid in pids {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
}

/// 把字符串写到文件（用于把命令快照写进日志）。
#[allow(dead_code)]
pub fn append_line(path: &Path, line: &str) {
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{}", line);
    }
}
