use serde::Serialize;
use sysinfo::System;

#[derive(Serialize)]
pub struct DiagnosticsBundle {
    pub system: DiagSystem,
    pub app_version: String,
    pub platform: String,
    pub arch: String,
    pub logs: String,
}

#[derive(Serialize)]
pub struct DiagSystem {
    pub os_name: String,
    pub os_version: String,
    pub hostname: String,
    pub cpu_count: usize,
    pub total_memory_mb: u64,
    pub used_memory_mb: u64,
    pub uptime_secs: u64,
}

#[tauri::command]
pub fn export_diagnostics_bundle() -> DiagnosticsBundle {
    let mut sys = System::new_all();
    sys.refresh_all();

    let os_name = System::name().unwrap_or_default();
    let os_version = System::os_version().unwrap_or_default();
    let hostname = System::host_name().unwrap_or_default();

    let logs = if let Some(dir) = dirs::data_local_dir() {
        let log_path = dir.join("com.rmpg.flex").join("logs");
        if log_path.exists() {
            std::fs::read_dir(&log_path)
                .ok()
                .map(|entries| {
                    let mut files: Vec<_> = entries
                        .filter_map(|e| e.ok())
                        .filter(|e| e.path().extension().is_some_and(|ext| ext == "log"))
                        .collect();
                    files.sort_by_key(|f| std::cmp::Reverse(f.metadata().ok().and_then(|m| m.modified().ok())));
                    files.first()
                        .and_then(|f| std::fs::read_to_string(f.path()).ok())
                        .unwrap_or_default()
                })
                .unwrap_or_default()
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    DiagnosticsBundle {
        system: DiagSystem {
            os_name,
            os_version,
            hostname,
            cpu_count: sys.cpus().len(),
            total_memory_mb: sys.total_memory() / 1_048_576,
            used_memory_mb: sys.used_memory() / 1_048_576,
            uptime_secs: System::uptime(),
        },
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        logs,
    }
}

#[derive(Serialize)]
pub struct CrashReport {
    pub timestamp: String,
    pub message: String,
}

#[tauri::command]
pub fn get_crash_reports() -> Vec<CrashReport> {
    // Tauri doesn't have a built-in crash reporter. Return empty for now.
    vec![]
}
