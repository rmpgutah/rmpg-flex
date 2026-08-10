use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn minimize_window(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("window not found")?;
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn maximize_window(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("window not found")?;
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn close_window(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("window not found")?;
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_fullscreen(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("window not found")?;
    let is_full = window.is_fullscreen().unwrap_or(false);
    window.set_fullscreen(!is_full).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_dock_badge(count: u32) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let label = if count > 0 {
            count.to_string()
        } else {
            String::new()
        };
        let _ = label; // macOS dock badge requires cocoa APIs — deferred to Phase 2
    }
    Ok(())
}

#[tauri::command]
pub fn flash_frame(app: AppHandle, flash: bool) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("window not found")?;
    window.request_user_attention(
        if flash { Some(tauri::UserAttentionType::Critical) } else { None }
    ).map_err(|e| e.to_string())
}
