//! 复制后校验：与语言环境无关，完全自己遍历源/目标对比，
//! 不依赖解析 robocopy 的本地化输出。
//!
//! - quick：对比“是否存在 + 文件大小”
//! - full ：在 quick 基础上再对比 sha256

use crate::model::VerifyResult;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const MAX_SAMPLES: usize = 30;

/// 根据 create_subfolder 规则推导出真正的目标目录。
pub fn effective_destination(source: &str, destination: &str, create_subfolder: bool) -> PathBuf {
    let dest = PathBuf::from(destination);
    if create_subfolder {
        if let Some(leaf) = leaf_name(source) {
            return dest.join(leaf);
        }
    }
    dest
}

/// 取路径的最后一段（盘符根目录返回 None）。
pub fn leaf_name(path: &str) -> Option<String> {
    let trimmed = path.trim_end_matches(['\\', '/']);
    Path::new(trimmed)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
}

fn sha256_of(path: &Path) -> std::io::Result<[u8; 32]> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().into())
}

/// 遍历源目录中的每个文件，确认目标存在且一致。
pub fn verify_task(
    source: &str,
    destination: &str,
    create_subfolder: bool,
    full: bool,
) -> VerifyResult {
    let mut result = VerifyResult::default();
    let source_root = PathBuf::from(source);
    let dest_root = effective_destination(source, destination, create_subfolder);

    for entry in WalkDir::new(&source_root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let src_path = entry.path();
        let rel = match src_path.strip_prefix(&source_root) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let dst_path = dest_root.join(rel);
        result.checked += 1;

        let src_meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let dst_meta = match std::fs::metadata(&dst_path) {
            Ok(m) => m,
            Err(_) => {
                result.missing += 1;
                push_sample(&mut result, "缺失", rel);
                continue;
            }
        };

        if src_meta.len() != dst_meta.len() {
            result.size_mismatch += 1;
            push_sample(&mut result, "大小不一致", rel);
            continue;
        }

        if full {
            let same = match (sha256_of(src_path), sha256_of(&dst_path)) {
                (Ok(a), Ok(b)) => a == b,
                _ => false,
            };
            if !same {
                result.hash_mismatch += 1;
                push_sample(&mut result, "内容不一致", rel);
            }
        }
    }

    result.ok = result.missing == 0 && result.size_mismatch == 0 && result.hash_mismatch == 0;
    result
}

fn push_sample(result: &mut VerifyResult, kind: &str, rel: &Path) {
    if result.samples.len() < MAX_SAMPLES {
        result
            .samples
            .push(format!("[{}] {}", kind, rel.to_string_lossy()));
    }
}
