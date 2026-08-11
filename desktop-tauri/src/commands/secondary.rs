use serde::Serialize;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Manager, webview::WebviewWindowBuilder};

static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(0);

#[derive(Serialize)]
pub struct WindowOpenResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub fn open_secondary_window(
    app: AppHandle,
    path: String,
    width: Option<f64>,
    height: Option<f64>,
) -> WindowOpenResult {
    if !path.starts_with('/') {
        return WindowOpenResult {
            ok: false,
            id: None,
            error: Some("Path must start with /".into()),
        };
    }

    let n = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    let label = format!("secondary-{n}");
    let url_str = format!("https://rmpgutah.us{path}");

    let url = match tauri::Url::parse(&url_str) {
        Ok(u) => u,
        Err(e) => {
            return WindowOpenResult {
                ok: false,
                id: None,
                error: Some(format!("Invalid URL: {e}")),
            };
        }
    };

    let bridge_js = include_str!("../../scripts/electron-compat-bridge.js");

    match WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(url))
        .title("RMPG Flex")
        .inner_size(width.unwrap_or(1024.0), height.unwrap_or(768.0))
        .center()
        .initialization_script(bridge_js)
        .build()
    {
        Ok(_) => WindowOpenResult {
            ok: true,
            id: Some(label),
            error: None,
        },
        Err(e) => WindowOpenResult {
            ok: false,
            id: None,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
pub fn close_secondary_window(app: AppHandle, id: String) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(&id) {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_company_browser(app: AppHandle, _role: Option<String>) -> WindowOpenResult {
    let label = "company-browser";

    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return WindowOpenResult {
            ok: true,
            id: Some(label.into()),
            error: None,
        };
    }

    let url = match tauri::Url::parse("https://rmpgutah.us/desktop-company-browser") {
        Ok(u) => u,
        Err(e) => {
            return WindowOpenResult {
                ok: false,
                id: None,
                error: Some(format!("Invalid URL: {e}")),
            };
        }
    };

    let bridge_js = include_str!("../../scripts/electron-compat-bridge.js");

    match WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::External(url))
        .title("RMPG Flex — Company Browser")
        .inner_size(1200.0, 850.0)
        .center()
        .initialization_script(bridge_js)
        .build()
    {
        Ok(_) => WindowOpenResult {
            ok: true,
            id: Some(label.into()),
            error: None,
        },
        Err(e) => WindowOpenResult {
            ok: false,
            id: None,
            error: Some(e.to_string()),
        },
    }
}
