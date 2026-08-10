use serde::Serialize;

#[derive(Serialize)]
pub struct IpLocation {
    pub latitude: f64,
    pub longitude: f64,
    pub accuracy: f64,
    pub source: String,
}

#[tauri::command]
pub async fn get_ip_location() -> Result<IpLocation, String> {
    // ip-api.com is free, no key required, returns JSON with lat/lon.
    // Rate limit: 45 req/min (plenty for a desktop fallback).
    let resp = reqwest::get("http://ip-api.com/json/?fields=lat,lon,status,message")
        .await
        .map_err(|e| format!("IP geolocation request failed: {e}"))?;

    let body: serde_json::Value = resp.json()
        .await
        .map_err(|e| format!("Failed to parse IP geolocation response: {e}"))?;

    if body.get("status").and_then(|s| s.as_str()) == Some("fail") {
        let msg = body.get("message").and_then(|m| m.as_str()).unwrap_or("unknown error");
        return Err(format!("IP geolocation failed: {msg}"));
    }

    let lat = body.get("lat").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let lon = body.get("lon").and_then(|v| v.as_f64()).unwrap_or(0.0);

    Ok(IpLocation {
        latitude: lat,
        longitude: lon,
        accuracy: 5000.0, // IP-based: ~5 km accuracy
        source: "ip-api".into(),
    })
}
