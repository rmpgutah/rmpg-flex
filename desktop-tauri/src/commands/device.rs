use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize)]
pub struct DisplayInfo {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub is_primary: bool,
}

#[tauri::command]
pub fn get_displays(app: AppHandle) -> Vec<DisplayInfo> {
    let monitors = app.available_monitors().unwrap_or_default();
    let primary = app.primary_monitor().ok().flatten();
    let primary_name = primary.as_ref().and_then(|m| m.name().map(|s| s.to_string()));

    monitors
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let size = m.size();
            let name = m.name().map(|s| s.to_string());
            DisplayInfo {
                id: i as u32,
                width: size.width,
                height: size.height,
                scale_factor: m.scale_factor(),
                is_primary: name.is_some() && name == primary_name,
            }
        })
        .collect()
}

#[derive(Serialize)]
pub struct AutoLaunchState {
    pub enabled: bool,
}

#[tauri::command]
pub fn set_auto_launch(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // macOS: use `osascript` to add/remove login item
        let script = if enabled {
            r#"tell application "System Events" to make login item at end with properties {path:"/Applications/RMPG Flex.app", hidden:false}"#
        } else {
            r#"tell application "System Events" to delete login item "RMPG Flex""#
        };
        std::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        // Windows: HKCU\Software\Microsoft\Windows\CurrentVersion\Run
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let key_path = r"Software\Microsoft\Windows\CurrentVersion\Run";
        if enabled {
            let _ = std::process::Command::new("reg")
                .args(["add", &format!("HKCU\\{key_path}"), "/v", "RMPG Flex", "/t", "REG_SZ", "/d", &exe.to_string_lossy(), "/f"])
                .output();
        } else {
            let _ = std::process::Command::new("reg")
                .args(["delete", &format!("HKCU\\{key_path}"), "/v", "RMPG Flex", "/f"])
                .output();
        }
    }

    Ok(())
}

#[tauri::command]
pub fn get_auto_launch_state() -> AutoLaunchState {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg(r#"tell application "System Events" to get the name of every login item"#)
            .output();
        if let Ok(out) = output {
            let text = String::from_utf8_lossy(&out.stdout);
            return AutoLaunchState {
                enabled: text.contains("RMPG Flex"),
            };
        }
    }

    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("reg")
            .args(["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run", "/v", "RMPG Flex"])
            .output();
        if let Ok(out) = output {
            return AutoLaunchState {
                enabled: out.status.success(),
            };
        }
    }

    AutoLaunchState { enabled: false }
}
