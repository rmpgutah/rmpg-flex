use tauri::AppHandle;

#[tauri::command]
pub fn set_tray_status(app: AppHandle, state: String) -> Result<(), String> {
    let tooltip = match state.as_str() {
        "on-shift" => "RMPG Flex — On Shift",
        "off-shift" => "RMPG Flex — Off Shift",
        "alert" => "RMPG Flex — ALERT",
        _ => "RMPG Flex",
    };

    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(tooltip));
    }

    Ok(())
}
