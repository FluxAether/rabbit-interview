use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::path::Path;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LogStorageUsage {
    pub bytes: u64,
    pub file_count: usize,
}

pub fn log_storage_usage_in_dir(log_dir: &Path) -> Result<LogStorageUsage, String> {
    if !log_dir.exists() {
        return Ok(LogStorageUsage {
            bytes: 0,
            file_count: 0,
        });
    }
    let mut bytes = 0u64;
    let mut file_count = 0usize;
    for entry in fs::read_dir(log_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        if metadata.is_file() {
            bytes += metadata.len();
            file_count += 1;
        }
    }
    Ok(LogStorageUsage { bytes, file_count })
}

pub fn clear_logs_in_dir(log_dir: &Path) -> Result<LogStorageUsage, String> {
    if !log_dir.exists() {
        return Ok(LogStorageUsage {
            bytes: 0,
            file_count: 0,
        });
    }
    for entry in fs::read_dir(log_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() {
            let _ = OpenOptions::new().write(true).truncate(true).open(&path);
            let _ = fs::remove_file(&path);
        }
    }
    log_storage_usage_in_dir(log_dir)
}

#[tauri::command]
pub fn get_log_storage_usage(app: AppHandle) -> Result<LogStorageUsage, String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    log_storage_usage_in_dir(&dir)
}

#[tauri::command]
pub fn clear_logs(app: AppHandle) -> Result<LogStorageUsage, String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    clear_logs_in_dir(&dir)
}

#[tauri::command]
pub fn open_log_dir(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    app.opener()
        .open_path(dir.to_string_lossy().as_ref(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    #[test]
    fn calculates_usage_and_clears_logs_correctly() {
        let temp_dir = std::env::temp_dir().join(format!("test_logs_{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        // Empty dir
        let empty = log_storage_usage_in_dir(&temp_dir).unwrap();
        assert_eq!(empty.bytes, 0);
        assert_eq!(empty.file_count, 0);

        // Add 2 log files
        let file1 = temp_dir.join("app.log");
        let mut f1 = File::create(&file1).unwrap();
        f1.write_all(b"hello log 1").unwrap();

        let file2 = temp_dir.join("app-1.log");
        let mut f2 = File::create(&file2).unwrap();
        f2.write_all(b"hello log 2!").unwrap();

        let usage = log_storage_usage_in_dir(&temp_dir).unwrap();
        assert_eq!(usage.file_count, 2);
        assert_eq!(usage.bytes, 11 + 12);

        // Clear logs
        let cleared = clear_logs_in_dir(&temp_dir).unwrap();
        assert_eq!(cleared.bytes, 0);
        assert_eq!(cleared.file_count, 0);

        let _ = fs::remove_dir_all(&temp_dir);
    }
}


