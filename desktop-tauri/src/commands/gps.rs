use serde::Serialize;
use std::io::BufRead;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static GPS_RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static GPS_STOP: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

const UBLOX_VID: u16 = 0x1546;
const BRIDGE_VIDS: &[u16] = &[0x067b, 0x0e8d, 0x1199, 0x10c4, 0x0403];
const BAUD_LADDER: &[u32] = &[9600, 4800, 38400, 115200];

#[derive(Serialize, Clone)]
pub struct GpsPosition {
    pub latitude: f64,
    pub longitude: f64,
    pub accuracy: f64,
    pub heading: Option<f64>,
    pub speed: Option<f64>,
    pub timestamp: u64,
}

#[derive(Serialize)]
pub struct GpsDetectResult {
    pub found: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vid: Option<u16>,
}

fn score_port(info: &serialport::SerialPortInfo) -> i32 {
    match &info.port_type {
        serialport::SerialPortType::UsbPort(usb) => {
            if usb.vid == UBLOX_VID { return 100; }
            if BRIDGE_VIDS.contains(&usb.vid) {
                let name = info.port_name.to_uppercase();
                if name.contains("GPS") || name.contains("GNSS") || name.contains("NMEA") {
                    return 70;
                }
            }
            0
        }
        _ => {
            let name = info.port_name.to_uppercase();
            if name.contains("GPS") || name.contains("GNSS") { 50 } else { 0 }
        }
    }
}

#[tauri::command]
pub fn detect_internal_gps() -> GpsDetectResult {
    let ports = serialport::available_ports().unwrap_or_default();
    let mut best: Option<(&serialport::SerialPortInfo, i32)> = None;

    for port in &ports {
        let s = score_port(port);
        if s > 0 && best.as_ref().map_or(true, |(_, bs)| s > *bs) {
            best = Some((port, s));
        }
    }

    match best {
        Some((info, _)) => {
            let vid = match &info.port_type {
                serialport::SerialPortType::UsbPort(usb) => Some(usb.vid),
                _ => None,
            };
            GpsDetectResult { found: true, port: Some(info.port_name.clone()), vid }
        }
        None => GpsDetectResult { found: false, port: None, vid: None },
    }
}

fn validate_nmea_checksum(sentence: &str) -> bool {
    if !sentence.starts_with('$') { return false; }
    let body = &sentence[1..];
    let Some(star) = body.find('*') else { return false };
    let payload = &body[..star];
    let hex = &body[star + 1..];
    let computed = payload.bytes().fold(0u8, |acc, b| acc ^ b);
    let Ok(expected) = u8::from_str_radix(hex.trim(), 16) else { return false };
    computed == expected
}

fn parse_nmea_coord(raw: &str, hemi: &str) -> Option<f64> {
    if raw.is_empty() || hemi.is_empty() { return None; }
    let dot = raw.find('.')?;
    if dot < 3 { return None; }
    let deg_end = dot - 2;
    let degrees: f64 = raw[..deg_end].parse().ok()?;
    let minutes: f64 = raw[deg_end..].parse().ok()?;
    let mut coord = degrees + minutes / 60.0;
    if hemi == "S" || hemi == "W" { coord = -coord; }
    Some(coord)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[tauri::command]
pub fn start_internal_gps(app: AppHandle, _opts: Option<serde_json::Value>) -> Result<(), String> {
    if GPS_RUNNING.load(std::sync::atomic::Ordering::Relaxed) {
        return Ok(());
    }

    let detect = detect_internal_gps();
    let port_name = detect.port.ok_or("No GPS port found")?;

    GPS_STOP.store(false, std::sync::atomic::Ordering::Relaxed);
    GPS_RUNNING.store(true, std::sync::atomic::Ordering::Relaxed);

    std::thread::spawn(move || {
        let pos = Arc::new(Mutex::new(GpsPosition {
            latitude: 0.0, longitude: 0.0, accuracy: 9999.0,
            heading: None, speed: None, timestamp: 0,
        }));

        'outer: for &baud in BAUD_LADDER {
            if GPS_STOP.load(std::sync::atomic::Ordering::Relaxed) { break; }

            let port = serialport::new(&port_name, baud)
                .timeout(Duration::from_secs(6))
                .open();

            let port = match port {
                Ok(p) => p,
                Err(_) => continue,
            };

            let reader = std::io::BufReader::new(port);

            for line in reader.lines() {
                if GPS_STOP.load(std::sync::atomic::Ordering::Relaxed) { break 'outer; }

                let line = match line {
                    Ok(l) => l.trim().to_string(),
                    Err(_) => continue,
                };

                if !validate_nmea_checksum(&line) { continue; }

                let parts: Vec<&str> = line.split(',').collect();
                if parts.len() < 6 { continue; }

                let tag = &parts[0][3..]; // strip $GP/$GN/$GL prefix

                let mut p = pos.lock().unwrap();

                match tag {
                    "GGA" if parts.len() >= 10 => {
                        if let (Some(lat), Some(lng)) = (
                            parse_nmea_coord(parts[2], parts[3]),
                            parse_nmea_coord(parts[4], parts[5]),
                        ) {
                            p.latitude = lat;
                            p.longitude = lng;
                            let hdop: f64 = parts[8].parse().unwrap_or(99.0);
                            p.accuracy = hdop * 5.0;
                            p.timestamp = now_ms();
                            let _ = app.emit("geo:internal-gps-update", p.clone());
                        }
                    }
                    "RMC" if parts.len() >= 9 => {
                        if let (Some(lat), Some(lng)) = (
                            parse_nmea_coord(parts[3], parts[4]),
                            parse_nmea_coord(parts[5], parts[6]),
                        ) {
                            p.latitude = lat;
                            p.longitude = lng;
                            let speed_knots: f64 = parts[7].parse().unwrap_or(0.0);
                            p.speed = Some(speed_knots * 0.514444);
                            if parts.len() > 8 {
                                p.heading = parts[8].parse().ok();
                            }
                            p.timestamp = now_ms();
                            let _ = app.emit("geo:internal-gps-update", p.clone());
                        }
                    }
                    _ => {}
                }
            }
        }

        GPS_RUNNING.store(false, std::sync::atomic::Ordering::Relaxed);
    });

    Ok(())
}

#[tauri::command]
pub fn stop_internal_gps() {
    GPS_STOP.store(true, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
pub fn list_serial_ports() -> Vec<String> {
    serialport::available_ports()
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.port_name)
        .collect()
}
