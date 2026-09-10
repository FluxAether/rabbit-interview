use std::{fs::OpenOptions, io::Write, path::Path, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Manager};

fn write_docx(directory: &Path, file_name: &str, bytes: &[u8]) -> Result<String, String> {
    if file_name.is_empty() || file_name.contains(['/', '\\']) || !file_name.ends_with(".docx")
        || bytes.len() > 10 * 1024 * 1024 || !bytes.starts_with(b"PK\x03\x04") {
        return Err("Invalid DOCX export".into());
    }
    std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_nanos();
    let stem = file_name.trim_end_matches(".docx");
    let path = directory.join(format!("{stem}-{stamp}.docx"));
    let mut file = OpenOptions::new().write(true).create_new(true).open(&path).map_err(|error| error.to_string())?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = std::fs::remove_file(&path);
        return Err(error.to_string());
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn export_resume_docx(app: AppHandle, file_name: String, bytes: Vec<u8>) -> Result<String, String> {
    let directory = app.path().download_dir().map_err(|error| error.to_string())?;
    tokio::task::spawn_blocking(move || write_docx(&directory, &file_name, &bytes))
        .await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_confirms_bytes_without_overwriting_or_escaping_directory() {
        let dir = std::env::temp_dir().join(format!("oncue-resume-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let bytes = b"PK\x03\x04sample";
        assert!(write_docx(&dir, "../escape.docx", bytes).is_err());
        assert!(write_docx(&dir, "resume.docx", b"invalid").is_err());
        let first = write_docx(&dir, "resume.docx", bytes).unwrap();
        let second = write_docx(&dir, "resume.docx", bytes).unwrap();
        assert_ne!(first, second);
        assert_eq!(std::fs::read(first).unwrap(), bytes);
        assert!(write_docx(Path::new(&second), "resume.docx", bytes).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
