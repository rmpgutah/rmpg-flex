use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

#[derive(Clone, Serialize)]
struct UpdateStatus {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<(), String> {
    let _ = app.emit("update-status", UpdateStatus {
        status: "checking".into(),
        version: None,
        error: None,
    });

    let updater = app.updater().map_err(|e| e.to_string())?;

    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            let _ = app.emit("update-status", UpdateStatus {
                status: "available".into(),
                version: Some(version.clone()),
                error: None,
            });

            let _ = app.emit("update-status", UpdateStatus {
                status: "downloading".into(),
                version: Some(version.clone()),
                error: None,
            });

            match update.download_and_install(|_, _| {}, || {}).await {
                Ok(_) => {
                    let _ = app.emit("update-status", UpdateStatus {
                        status: "downloaded".into(),
                        version: Some(version),
                        error: None,
                    });
                }
                Err(e) => {
                    let _ = app.emit("update-status", UpdateStatus {
                        status: "error".into(),
                        version: Some(version),
                        error: Some(e.to_string()),
                    });
                }
            }
        }
        Ok(None) => {
            let _ = app.emit("update-status", UpdateStatus {
                status: "up-to-date".into(),
                version: None,
                error: None,
            });
        }
        Err(e) => {
            let _ = app.emit("update-status", UpdateStatus {
                status: "error".into(),
                version: None,
                error: Some(e.to_string()),
            });
        }
    }

    Ok(())
}

#[tauri::command]
pub fn install_update(app: AppHandle) -> Result<(), String> {
    app.restart();
}
