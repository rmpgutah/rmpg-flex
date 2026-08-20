use hmac::{Hmac, Mac};
use rusqlite::Connection;
use serde::Serialize;
use sha2::Sha256;
use std::sync::Mutex;

type HmacSha256 = Hmac<Sha256>;

static DB: std::sync::LazyLock<Mutex<Option<Connection>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));

const MIRRORED_TABLES: &[&str] = &[
    "users", "clients", "properties", "units", "calls_for_service",
    "incidents", "time_entries", "persons", "vehicles_records",
];

const PIN_VALIDITY_SECS: u64 = 86400; // 24 hours
const PIN_MAX_ATTEMPTS: u32 = 5;
const PIN_LOCKOUT_SECS: u64 = 900; // 15 minutes

fn db_path() -> Option<std::path::PathBuf> {
    dirs::data_local_dir().map(|d| d.join("com.rmpg.flex").join("offline.db"))
}

fn ensure_db() -> Result<(), String> {
    let mut guard = DB.lock().unwrap();
    if guard.is_some() { return Ok(()); }

    let path = db_path().ok_or("Cannot determine data directory")?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS sync_metadata (
            table_name TEXT PRIMARY KEY,
            last_pull_at TEXT,
            last_push_at TEXT,
            row_count INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS sync_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            method TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            body TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            status TEXT DEFAULT 'pending',
            attempts INTEGER DEFAULT 0,
            last_error TEXT
        );
        CREATE TABLE IF NOT EXISTS pin_sessions (
            user_id INTEGER PRIMARY KEY,
            pin_hash TEXT NOT NULL,
            device_id TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            expires_at TEXT NOT NULL,
            attempts INTEGER DEFAULT 0,
            locked_until TEXT
        );
        CREATE TABLE IF NOT EXISTS gps_breadcrumbs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            latitude REAL,
            longitude REAL,
            accuracy REAL,
            heading REAL,
            speed REAL,
            timestamp TEXT DEFAULT (datetime('now')),
            synced INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS cached_users (
            id INTEGER PRIMARY KEY,
            username TEXT,
            password_hash TEXT,
            role TEXT,
            org_id INTEGER,
            cached_at TEXT DEFAULT (datetime('now'))
        );
    ").map_err(|e| e.to_string())?;

    *guard = Some(conn);
    Ok(())
}

#[derive(Serialize)]
pub struct OfflineState {
    pub online: bool,
    pub authorized: bool,
    pub pin_active: bool,
}

#[tauri::command]
pub fn get_offline_state() -> OfflineState {
    OfflineState { online: true, authorized: false, pin_active: false }
}

#[derive(Serialize)]
pub struct SyncStatus {
    pub last_pull: Option<String>,
    pub last_push: Option<String>,
    pub queue_depth: u32,
}

#[tauri::command]
pub fn get_sync_status() -> SyncStatus {
    if ensure_db().is_err() {
        return SyncStatus { last_pull: None, last_push: None, queue_depth: 0 };
    }
    let guard = DB.lock().unwrap();
    let conn = match guard.as_ref() {
        Some(c) => c,
        None => return SyncStatus { last_pull: None, last_push: None, queue_depth: 0 },
    };

    let queue_depth: u32 = conn
        .query_row("SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'", [], |r| r.get(0))
        .unwrap_or(0);

    let last_pull: Option<String> = conn
        .query_row("SELECT MAX(last_pull_at) FROM sync_metadata", [], |r| r.get(0))
        .unwrap_or(None);

    let last_push: Option<String> = conn
        .query_row("SELECT MAX(last_push_at) FROM sync_metadata", [], |r| r.get(0))
        .unwrap_or(None);

    SyncStatus { last_pull, last_push, queue_depth }
}

#[derive(Serialize)]
pub struct PinResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pin: Option<String>,
}

fn compute_pin_hash(pin: &str, user_id: i64) -> String {
    let key = format!("rmpg-pin-{user_id}");
    let mut mac = HmacSha256::new_from_slice(key.as_bytes()).unwrap();
    mac.update(pin.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

#[tauri::command]
pub fn generate_pin(user_id: i64) -> PinResult {
    if ensure_db().is_err() {
        return PinResult { ok: false, error: Some("Database unavailable".into()), pin: None };
    }

    let pin = format!("{:06}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default()
        .as_micros() % 1_000_000);

    let hash = compute_pin_hash(&pin, user_id);
    let expires = chrono_like_add_secs(PIN_VALIDITY_SECS);

    let guard = DB.lock().unwrap();
    if let Some(conn) = guard.as_ref() {
        let _ = conn.execute(
            "INSERT OR REPLACE INTO pin_sessions (user_id, pin_hash, expires_at, attempts, locked_until) VALUES (?1, ?2, ?3, 0, NULL)",
            rusqlite::params![user_id, hash, expires],
        );
    }

    PinResult { ok: true, error: None, pin: Some(pin) }
}

#[tauri::command]
pub fn enter_pin(pin: String) -> PinResult {
    if ensure_db().is_err() {
        return PinResult { ok: false, error: Some("Database unavailable".into()), pin: None };
    }

    let guard = DB.lock().unwrap();
    let conn = match guard.as_ref() {
        Some(c) => c,
        None => return PinResult { ok: false, error: Some("No database".into()), pin: None },
    };

    let mut stmt = match conn.prepare("SELECT user_id, pin_hash, expires_at, attempts, locked_until FROM pin_sessions") {
        Ok(s) => s,
        Err(_) => return PinResult { ok: false, error: Some("No PIN sessions".into()), pin: None },
    };

    let rows: Vec<(i64, String, String, u32, Option<String>)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let now = now_iso();

    for (user_id, stored_hash, expires_at, attempts, locked_until) in &rows {
        if expires_at < &now { continue; }
        if let Some(lock) = locked_until {
            if lock > &now { continue; }
        }
        if *attempts >= PIN_MAX_ATTEMPTS {
            let lockout = chrono_like_add_secs(PIN_LOCKOUT_SECS);
            let _ = conn.execute(
                "UPDATE pin_sessions SET locked_until = ?1 WHERE user_id = ?2",
                rusqlite::params![lockout, user_id],
            );
            continue;
        }

        let hash = compute_pin_hash(&pin, *user_id);
        if hash == *stored_hash {
            let _ = conn.execute(
                "UPDATE pin_sessions SET attempts = 0 WHERE user_id = ?1",
                rusqlite::params![user_id],
            );
            return PinResult { ok: true, error: None, pin: None };
        } else {
            let _ = conn.execute(
                "UPDATE pin_sessions SET attempts = attempts + 1 WHERE user_id = ?1",
                rusqlite::params![user_id],
            );
        }
    }

    PinResult { ok: false, error: Some("Invalid PIN".into()), pin: None }
}

#[tauri::command]
pub fn store_auth_session(token: String, refresh_token: Option<String>) -> Result<(), String> {
    if ensure_db().is_err() { return Err("Database unavailable".into()); }
    // In the full implementation, decode the JWT and cache the user record.
    // For now, store the tokens in a simple key-value table.
    let guard = DB.lock().unwrap();
    if let Some(conn) = guard.as_ref() {
        conn.execute_batch("CREATE TABLE IF NOT EXISTS auth_cache (key TEXT PRIMARY KEY, value TEXT)").map_err(|e| e.to_string())?;
        conn.execute("INSERT OR REPLACE INTO auth_cache (key, value) VALUES ('token', ?1)", [&token]).map_err(|e| e.to_string())?;
        if let Some(rt) = refresh_token {
            conn.execute("INSERT OR REPLACE INTO auth_cache (key, value) VALUES ('refresh_token', ?1)", [&rt]).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[derive(Serialize)]
pub struct CachedUser {
    pub id: i64,
    pub username: String,
    pub role: String,
}

#[tauri::command]
pub fn get_cached_user(username: String) -> Option<CachedUser> {
    if ensure_db().is_err() { return None; }
    let guard = DB.lock().unwrap();
    let conn = guard.as_ref()?;
    conn.query_row(
        "SELECT id, username, role FROM cached_users WHERE username = ?1",
        [&username],
        |r| Ok(CachedUser { id: r.get(0)?, username: r.get(1)?, role: r.get(2)? }),
    ).ok()
}

#[tauri::command]
pub fn trigger_sync() -> Result<(), String> {
    // Full sync implementation requires an HTTP client + auth token to pull from the API.
    // Placeholder: sync is triggered but the actual pull/push runs on a background timer.
    Ok(())
}

#[tauri::command]
pub fn pause_sync() -> Result<(), String> { Ok(()) }

#[tauri::command]
pub fn resume_sync() -> Result<(), String> { Ok(()) }

#[derive(Serialize)]
pub struct SyncQueueDetail {
    pub pending: Vec<SyncQueueItem>,
    pub failed: Vec<SyncQueueItem>,
}

#[derive(Serialize)]
pub struct SyncQueueItem {
    pub id: i64,
    pub method: String,
    pub endpoint: String,
    pub status: String,
    pub attempts: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[tauri::command]
pub fn get_sync_queue_detail() -> SyncQueueDetail {
    if ensure_db().is_err() {
        return SyncQueueDetail { pending: vec![], failed: vec![] };
    }
    let guard = DB.lock().unwrap();
    let conn = match guard.as_ref() {
        Some(c) => c,
        None => return SyncQueueDetail { pending: vec![], failed: vec![] },
    };

    let query = |status: &str| -> Vec<SyncQueueItem> {
        conn.prepare("SELECT id, method, endpoint, status, attempts, last_error FROM sync_queue WHERE status = ?1 ORDER BY id")
            .ok()
            .map(|mut stmt| {
                stmt.query_map([status], |r| Ok(SyncQueueItem {
                    id: r.get(0)?, method: r.get(1)?, endpoint: r.get(2)?,
                    status: r.get(3)?, attempts: r.get(4)?, last_error: r.get(5)?,
                })).unwrap().filter_map(|r| r.ok()).collect()
            })
            .unwrap_or_default()
    };

    SyncQueueDetail { pending: query("pending"), failed: query("failed") }
}

#[tauri::command]
pub fn get_offline_write_queue_size() -> u32 {
    if ensure_db().is_err() { return 0; }
    let guard = DB.lock().unwrap();
    guard.as_ref()
        .and_then(|c| c.query_row("SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'", [], |r| r.get(0)).ok())
        .unwrap_or(0)
}

#[tauri::command]
pub fn retry_failed_sync_item(id: i64) -> Result<(), String> {
    if ensure_db().is_err() { return Err("Database unavailable".into()); }
    let guard = DB.lock().unwrap();
    if let Some(conn) = guard.as_ref() {
        conn.execute("UPDATE sync_queue SET status = 'pending', attempts = 0 WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_failed_sync_items() -> Result<(), String> {
    if ensure_db().is_err() { return Err("Database unavailable".into()); }
    let guard = DB.lock().unwrap();
    if let Some(conn) = guard.as_ref() {
        conn.execute("DELETE FROM sync_queue WHERE status = 'failed'", [])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_last_sync_error() -> Option<String> {
    if ensure_db().is_err() { return None; }
    let guard = DB.lock().unwrap();
    guard.as_ref()?.query_row(
        "SELECT last_error FROM sync_queue WHERE status = 'failed' ORDER BY id DESC LIMIT 1",
        [], |r| r.get(0),
    ).ok()
}

#[derive(Serialize)]
pub struct CacheStats {
    pub table: String,
    pub rows: u32,
}

#[tauri::command]
pub fn get_local_cache_stats() -> Vec<CacheStats> {
    if ensure_db().is_err() { return vec![]; }
    let guard = DB.lock().unwrap();
    let conn = match guard.as_ref() {
        Some(c) => c,
        None => return vec![],
    };

    MIRRORED_TABLES.iter().filter_map(|t| {
        let sql = format!("SELECT COUNT(*) FROM {t}");
        let rows: u32 = conn.query_row(&sql, [], |r| r.get(0)).unwrap_or(0);
        Some(CacheStats { table: t.to_string(), rows })
    }).collect()
}

#[tauri::command]
pub fn clear_local_cache(table: String) -> Result<(), String> {
    if !MIRRORED_TABLES.contains(&table.as_str()) {
        return Err(format!("Table '{table}' is not in the allowlist"));
    }
    if ensure_db().is_err() { return Err("Database unavailable".into()); }
    let guard = DB.lock().unwrap();
    if let Some(conn) = guard.as_ref() {
        conn.execute(&format!("DELETE FROM {table}"), []).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM sync_metadata WHERE table_name = ?1", [&table]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn force_full_resync() -> Result<(), String> {
    if ensure_db().is_err() { return Err("Database unavailable".into()); }
    let guard = DB.lock().unwrap();
    if let Some(conn) = guard.as_ref() {
        for t in MIRRORED_TABLES {
            let _ = conn.execute(&format!("DELETE FROM {t}"), []);
        }
        conn.execute("DELETE FROM sync_metadata", []).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn local_api(_method: String, _path: String, _body: Option<String>) -> serde_json::Value {
    serde_json::json!({ "ok": false, "error": "Offline API routing not yet implemented" })
}

fn now_iso() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs();
    let hours = (secs / 3600) % 24;
    let mins = (secs / 60) % 60;
    let s = secs % 60;
    let days = secs / 86400;
    // Approximate date — good enough for comparison ordering
    let year = 1970 + days / 365;
    let day_of_year = days % 365;
    let month = day_of_year / 30 + 1;
    let day = day_of_year % 30 + 1;
    format!("{year:04}-{month:02}-{day:02}T{hours:02}:{mins:02}:{s:02}Z")
}

fn chrono_like_add_secs(secs: u64) -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let total = d.as_secs() + secs;
    let hours = (total / 3600) % 24;
    let mins = (total / 60) % 60;
    let s = total % 60;
    let days = total / 86400;
    let year = 1970 + days / 365;
    let day_of_year = days % 365;
    let month = day_of_year / 30 + 1;
    let day = day_of_year % 30 + 1;
    format!("{year:04}-{month:02}-{day:02}T{hours:02}:{mins:02}:{s:02}Z")
}
