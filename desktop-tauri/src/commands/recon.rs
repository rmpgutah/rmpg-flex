use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

static SESSIONS: std::sync::LazyLock<Mutex<HashMap<String, Child>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize)]
pub struct ReconResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct ReconCheckResult {
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Serialize)]
pub struct ReconInstallState {
    pub installed: bool,
}

fn recon_dir() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join("recon-connect"))
}

fn recon_installed() -> Option<String> {
    let dir = recon_dir()?;
    if dir.exists() { Some(dir.to_string_lossy().to_string()) } else { None }
}

#[tauri::command]
pub fn check_recon_connect() -> ReconCheckResult {
    match recon_installed() {
        Some(path) => ReconCheckResult { installed: true, path: Some(path) },
        None => ReconCheckResult { installed: false, path: None },
    }
}

#[tauri::command]
pub fn launch_recon_connect() -> ReconResult {
    let Some(dir) = recon_dir() else {
        return ReconResult { ok: false, error: Some("Cannot determine home directory".into()) };
    };

    if !dir.exists() {
        return ReconResult { ok: false, error: Some("Recon Connect not installed".into()) };
    }

    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "tell application \"Terminal\" to do script \"cd {} && source venv/bin/activate && python main.py\"",
            dir.to_string_lossy()
        );
        match Command::new("osascript").arg("-e").arg(&script).spawn() {
            Ok(_) => ReconResult { ok: true, error: None },
            Err(e) => ReconResult { ok: false, error: Some(e.to_string()) },
        }
    }

    #[cfg(target_os = "windows")]
    {
        let cmd = format!(
            "cd /d \"{}\" && venv\\Scripts\\activate && python main.py",
            dir.to_string_lossy()
        );
        match Command::new("cmd").args(["/c", "start", "cmd.exe", "/k", &cmd]).spawn() {
            Ok(_) => ReconResult { ok: true, error: None },
            Err(e) => ReconResult { ok: false, error: Some(e.to_string()) },
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        ReconResult { ok: false, error: Some("Unsupported platform".into()) }
    }
}

#[tauri::command]
pub fn install_recon_connect() -> ReconResult {
    let Some(dir) = recon_dir() else {
        return ReconResult { ok: false, error: Some("Cannot determine home directory".into()) };
    };

    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "tell application \"Terminal\" to do script \"git clone https://github.com/rmpgutah/recon-connect.git {} && cd {} && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt\"",
            dir.to_string_lossy(), dir.to_string_lossy()
        );
        match Command::new("osascript").arg("-e").arg(&script).spawn() {
            Ok(_) => ReconResult { ok: true, error: None },
            Err(e) => ReconResult { ok: false, error: Some(e.to_string()) },
        }
    }

    #[cfg(target_os = "windows")]
    {
        let cmd = format!(
            "git clone https://github.com/rmpgutah/recon-connect.git \"{}\" && cd /d \"{}\" && python -m venv venv && venv\\Scripts\\activate && pip install -r requirements.txt",
            dir.to_string_lossy(), dir.to_string_lossy()
        );
        match Command::new("cmd").args(["/c", "start", "cmd.exe", "/k", &cmd]).spawn() {
            Ok(_) => ReconResult { ok: true, error: None },
            Err(e) => ReconResult { ok: false, error: Some(e.to_string()) },
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        ReconResult { ok: false, error: Some("Unsupported platform".into()) }
    }
}

#[tauri::command]
pub fn recon_spawn(app: AppHandle, _opts: Option<serde_json::Value>) -> Result<String, String> {
    let dir = recon_dir().ok_or("Cannot determine home directory")?;
    if !dir.exists() { return Err("Recon Connect not installed".into()); }

    let session_id = format!("recon-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis());

    #[cfg(target_os = "macos")]
    let mut child = Command::new("bash")
        .args(["-c", &format!("cd '{}' && source venv/bin/activate && python main.py", dir.to_string_lossy())])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    let mut child = Command::new("cmd")
        .args(["/c", &format!("cd /d \"{}\" && venv\\Scripts\\activate && python main.py", dir.to_string_lossy())])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let sid = session_id.clone();
    let app2 = app.clone();

    if let Some(stdout) = child.stdout.take() {
        let sid2 = sid.clone();
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines().flatten() {
                let _ = app2.emit("recon:term-data", serde_json::json!({
                    "sessionId": sid2, "data": line + "\n"
                }));
            }
            let _ = app2.emit("recon:term-exit", serde_json::json!({
                "sessionId": sid2, "code": 0
            }));
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let sid3 = sid.clone();
        let app3 = app.clone();
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines().flatten() {
                let _ = app3.emit("recon:term-data", serde_json::json!({
                    "sessionId": sid3, "data": line + "\n"
                }));
            }
        });
    }

    SESSIONS.lock().unwrap().insert(sid.clone(), child);
    Ok(sid)
}

#[tauri::command]
pub fn recon_input(session_id: String, data: String) {
    if let Some(child) = SESSIONS.lock().unwrap().get_mut(&session_id) {
        if let Some(stdin) = child.stdin.as_mut() {
            let _ = stdin.write_all(data.as_bytes());
            let _ = stdin.flush();
        }
    }
}

#[tauri::command]
pub fn recon_kill(session_id: String) {
    if let Some(mut child) = SESSIONS.lock().unwrap().remove(&session_id) {
        let _ = child.kill();
    }
}

#[tauri::command]
pub fn recon_kill_all() {
    let mut sessions = SESSIONS.lock().unwrap();
    for (_, mut child) in sessions.drain() {
        let _ = child.kill();
    }
}

#[tauri::command]
pub fn recon_install_state() -> ReconInstallState {
    ReconInstallState { installed: recon_installed().is_some() }
}

#[tauri::command]
pub fn recon_update() -> ReconResult {
    let Some(dir) = recon_dir() else {
        return ReconResult { ok: false, error: Some("Cannot determine home directory".into()) };
    };
    match Command::new("git").args(["-C", &dir.to_string_lossy(), "pull"]).output() {
        Ok(out) if out.status.success() => ReconResult { ok: true, error: None },
        Ok(out) => ReconResult { ok: false, error: Some(String::from_utf8_lossy(&out.stderr).to_string()) },
        Err(e) => ReconResult { ok: false, error: Some(e.to_string()) },
    }
}
