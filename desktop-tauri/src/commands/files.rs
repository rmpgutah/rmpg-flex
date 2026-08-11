use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct ExportResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub fn write_export_file(path: String, data: String) -> ExportResult {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        if !parent.exists() {
            return ExportResult {
                ok: false,
                error: Some("Parent directory does not exist".into()),
            };
        }
    }
    match std::fs::write(&p, data.as_bytes()) {
        Ok(_) => ExportResult { ok: true, error: None },
        Err(e) => ExportResult {
            ok: false,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
pub fn read_import_file(path: String) -> Result<Option<String>, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Ok(None);
    }
    match std::fs::read_to_string(&p) {
        Ok(contents) => Ok(Some(contents)),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("Path does not exist".into());
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn();
    }
    Ok(())
}

#[tauri::command]
pub fn get_downloads_path() -> Result<String, String> {
    dirs::download_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine downloads directory".into())
}

#[derive(Serialize)]
pub struct PrinterInfo {
    pub name: String,
}

#[tauri::command]
pub fn get_printers() -> Vec<PrinterInfo> {
    vec![]
}

#[tauri::command]
pub fn print_silent(_printer_name: String) -> Result<(), String> {
    Err("Silent printing not yet implemented in Tauri build".into())
}

#[tauri::command]
pub fn print_to_pdf(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval("window.print()");
    }
    Ok(())
}
