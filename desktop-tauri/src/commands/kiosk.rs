use serde::Serialize;

#[derive(Serialize)]
pub struct KioskShellResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct KioskShellState {
    pub supported: bool,
    pub enabled: bool,
}

#[tauri::command]
pub fn set_kiosk_shell(enabled: bool) -> KioskShellResult {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        return KioskShellResult {
            ok: false,
            error: Some("Kiosk shell mode is only supported on Windows".into()),
        };
    }

    #[cfg(target_os = "windows")]
    {
        let winlogon_key = r"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon";
        let shell_value = if enabled {
            let exe = match std::env::current_exe() {
                Ok(p) => p.to_string_lossy().to_string(),
                Err(e) => return KioskShellResult { ok: false, error: Some(e.to_string()) },
            };
            format!("\"{}\"", exe)
        } else {
            "explorer.exe".to_string()
        };

        // Elevated reg.exe via PowerShell Start-Process -Verb RunAs
        let ps_cmd = format!(
            "Start-Process -FilePath reg.exe -ArgumentList 'add \"{}\" /v Shell /t REG_SZ /d \"{}\" /f' -Verb RunAs -Wait",
            winlogon_key, shell_value
        );

        match std::process::Command::new("powershell")
            .args(["-Command", &ps_cmd])
            .output()
        {
            Ok(out) if out.status.success() => KioskShellResult { ok: true, error: None },
            Ok(out) => KioskShellResult {
                ok: false,
                error: Some(String::from_utf8_lossy(&out.stderr).to_string()),
            },
            Err(e) => KioskShellResult { ok: false, error: Some(e.to_string()) },
        }
    }
}

#[tauri::command]
pub fn get_kiosk_shell_state() -> KioskShellState {
    #[cfg(not(target_os = "windows"))]
    {
        return KioskShellState { supported: false, enabled: false };
    }

    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("reg")
            .args(["query", r"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon", "/v", "Shell"])
            .output();

        let enabled = match output {
            Ok(out) if out.status.success() => {
                let text = String::from_utf8_lossy(&out.stdout);
                // `reg query /v Shell` output format (Windows):
                //   HKLM\...\Winlogon
                //       Shell    REG_SZ    <value>
                // Extract the value after the last "REG_SZ" token on the Shell line.
                // If the value IS exactly "explorer.exe" (case-insensitive), the
                // machine is in normal mode; anything else (our exe path) = kiosk.
                let shell_value = text
                    .lines()
                    .find(|l| l.trim_start().to_lowercase().starts_with("shell"))
                    .and_then(|l| {
                        // Columns are tab-separated: name \t type \t value
                        let parts: Vec<&str> = l.split_whitespace().collect();
                        // Expect at least 3 tokens: Shell REG_SZ <value...>
                        if parts.len() >= 3 {
                            // Value may contain spaces (quoted exe path); rejoin from index 2.
                            Some(parts[2..].join(" "))
                        } else {
                            None
                        }
                    });

                match shell_value {
                    // Default Windows shell → kiosk is NOT enabled
                    Some(ref v) if v.trim().eq_ignore_ascii_case("explorer.exe") => false,
                    // Any other value (our exe, or missing) → kiosk IS enabled
                    Some(_) => true,
                    // Could not parse the Shell line → conservatively report not enabled
                    None => false,
                }
            }
            // reg.exe failed or not found → conservatively report not enabled
            _ => false,
        };

        KioskShellState { supported: true, enabled }
    }
}
