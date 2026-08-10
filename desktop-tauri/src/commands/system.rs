use serde::Serialize;
use sysinfo::System;
use std::path::PathBuf;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub hostname: String,
    pub platform: String,
    pub arch: String,
    pub os_version: String,
    pub total_memory_mb: u64,
    pub free_memory_mb: u64,
    pub cpu_count: usize,
    pub uptime_seconds: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskSpace {
    pub total_gb: f64,
    pub free_gb: f64,
    pub used_percent: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterface {
    pub name: String,
    pub mac: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatteryStatus {
    pub is_charging: bool,
    pub level: f64,
    pub has_battery: bool,
}

#[tauri::command]
pub fn get_system_info() -> SystemInfo {
    let mut sys = System::new_all();
    sys.refresh_all();

    SystemInfo {
        hostname: System::host_name().unwrap_or_default(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        os_version: System::os_version().unwrap_or_default(),
        total_memory_mb: sys.total_memory() / 1_048_576,
        free_memory_mb: sys.available_memory() / 1_048_576,
        cpu_count: sys.cpus().len(),
        uptime_seconds: System::uptime(),
    }
}

#[tauri::command]
pub fn check_disk_space() -> Result<DiskSpace, String> {
    let mut sys = System::new();
    sys.refresh_all();

    let disks = sysinfo::Disks::new_with_refreshed_list();
    let root = disks.list().iter().find(|d| {
        let mount = d.mount_point();
        mount == PathBuf::from("/") || mount == PathBuf::from("C:\\")
    });

    match root {
        Some(disk) => {
            let total = disk.total_space() as f64 / 1_073_741_824.0;
            let free = disk.available_space() as f64 / 1_073_741_824.0;
            let used = if total > 0.0 { ((total - free) / total) * 100.0 } else { 0.0 };
            Ok(DiskSpace {
                total_gb: total,
                free_gb: free,
                used_percent: used,
            })
        }
        None => Err("Could not find root disk".into()),
    }
}

#[tauri::command]
pub fn get_network_interfaces() -> Vec<NetworkInterface> {
    let networks = sysinfo::Networks::new_with_refreshed_list();
    networks
        .list()
        .iter()
        .map(|(name, data)| NetworkInterface {
            name: name.clone(),
            mac: data.mac_address().to_string(),
        })
        .collect()
}

#[tauri::command]
pub fn get_battery_status() -> BatteryStatus {
    // Platform-specific battery detection would go here.
    // For now return a safe default; Phase 2 adds the FZ-55 PowerShell CIM parser.
    BatteryStatus {
        is_charging: false,
        level: 100.0,
        has_battery: false,
    }
}

#[tauri::command]
pub fn get_idle_time() -> u64 {
    0
}
