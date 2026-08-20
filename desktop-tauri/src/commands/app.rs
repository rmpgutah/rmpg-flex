use tauri::{AppHandle, Manager};
use std::fs;
use std::path::PathBuf;

fn log_file_path(app: &AppHandle) -> PathBuf {
    let data_dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    data_dir.join("rmpg-flex.log")
}

#[tauri::command]
pub fn get_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn force_refresh(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("window not found")?;
    window.eval("window.location.reload()").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restart_app(app: AppHandle) -> Result<(), String> {
    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}

#[tauri::command]
pub fn get_app_logs(app: AppHandle) -> Result<String, String> {
    let path = log_file_path(&app);
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
pub fn open_logs_folder(app: AppHandle) -> Result<(), String> {
    let path = log_file_path(&app);
    let dir = path.parent().unwrap_or(&path);
    open::that(dir).map_err(|e| e.to_string())
}
