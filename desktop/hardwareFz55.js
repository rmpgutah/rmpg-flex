// ============================================================
// RMPG Flex — FZ-55 Windows-native hardware
// Parsing/shaping for Panasonic Toughbook FZ-55 hardware queried
// via PowerShell CIM cmdlets. Every function takes its raw input
// (a JSON string, a keystroke array) as a parameter — no live OS
// access here — mirroring desktop/systemInfo.js's/deviceInfo.js's
// pattern, for zero-runtime-dependency unit testing.
// ============================================================

'use strict';

/**
 * Parses `Get-CimInstance -ClassName Win32_Battery | ... | ConvertTo-Json`
 * output. Win32_Battery returns one instance per installed battery — the
 * FZ-55's dual hot-swap bays surface as a JSON array of 0, 1, or 2 entries
 * (a single instance serializes as a bare object, not a 1-element array).
 * BatteryStatus 2 = on AC/charging, everything else treated as discharging
 * (WMI's enum has several discharge-adjacent values; only 2 means charging).
 */
function parseWindowsBatteryOutput(rawJsonString) {
  let parsed;
  try {
    parsed = JSON.parse(rawJsonString);
  } catch {
    return null;
  }
  const entries = (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (entry) => entry && typeof entry === 'object'
  );
  if (entries.length === 0) return null;

  const batteries = entries.map((entry) => {
    const percent = Number(entry.EstimatedChargeRemaining);
    return {
      percent: Number.isFinite(percent) ? percent : 0,
      charging: entry.BatteryStatus === 2,
    };
  });

  const overallPercent = batteries.length > 0
    ? Math.round(batteries.reduce((sum, b) => sum + b.percent, 0) / batteries.length)
    : 0;
  const charging = batteries.some((b) => b.charging);

  return { batteries, overallPercent, charging };
}

/**
 * Parses `Get-PnpDevice -Class DockUpDown | Select-Object Status | ConvertTo-Json`
 * output. The 24-pin docking connector fires an ACPI DockUpDown PnP event;
 * `docked: true` when at least one such device reports Status 'OK'.
 */
function parseWindowsDockOutput(rawJsonString) {
  let parsed;
  try {
    parsed = JSON.parse(rawJsonString);
  } catch {
    return { docked: false };
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return { docked: entries.some((entry) => entry && entry.Status === 'OK') };
}

/**
 * Parses `Get-NetAdapter | Where-Object {$_.InterfaceDescription -match
 * 'Sierra|EM74|EM75|EM91'} | Select-Object Name, InterfaceDescription,
 * Status | ConvertTo-Json` output. The PowerShell filter already narrows
 * to WWAN adapters (Sierra EM7455/EM7511/EM7421/EM7595, mk3 5G EM9190), so
 * an empty result means no WWAN module installed, and any entry present
 * means the module is there; Status 'Up' means an active connection.
 */
function parseWindowsWwanOutput(rawJsonString) {
  let parsed;
  try {
    parsed = JSON.parse(rawJsonString);
  } catch {
    return { present: false, connected: false };
  }
  const entries = (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (entry) => entry && typeof entry === 'object'
  );
  if (entries.length === 0) return { present: false, connected: false };
  return { present: true, connected: entries.some((entry) => entry.Status === 'Up') };
}

/**
 * Parses `Get-Tpm | Select-Object TpmPresent, TpmReady, TpmEnabled |
 * ConvertTo-Json` output. Read-only posture reporting for the FZ-55's
 * Secured-core PC hardware root of trust — consumed by desktop/security/
 * as one more signal, never used to block app function.
 */
function parseWindowsTpmOutput(rawJsonString) {
  let parsed;
  try {
    parsed = JSON.parse(rawJsonString);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    present: Boolean(parsed.TpmPresent),
    ready: Boolean(parsed.TpmReady),
    enabled: Boolean(parsed.TpmEnabled),
  };
}

const BARCODE_MAX_GAP_MS = 30;
const BARCODE_MIN_LENGTH = 3;

/**
 * Returns true when a `before-input-event` `input.key` value should be
 * buffered as a candidate barcode-scan character: a single printable
 * character, or the literal string `'Enter'` (the scan terminator).
 * Electron's `before-input-event` fires a separate keyDown for modifier
 * and other non-printable keys (`'Shift'`, `'Control'`, `'Alt'`, `'Dead'`,
 * ...), where `input.key` is a multi-character name rather than the
 * character produced — those must be filtered out before buffering, or a
 * scanner's Shift-then-letter sequence for an uppercase character corrupts
 * the buffered payload (e.g. 'ABC123' buffers as 'ShiftAShiftBShiftC123').
 * Callers (main.js's before-input-event handler) MUST filter to records
 * that pass this check before pushing them onto the buffer passed to
 * `classifyKeystrokeBurst` — that function assumes its input is already
 * filtered and does no filtering of its own.
 */
function filterPrintableKeydown(key) {
  return key === 'Enter' || (typeof key === 'string' && key.length === 1);
}

/**
 * Classifies a buffered run of keydown records as a barcode-scanner
 * keyboard-wedge burst (fast, ends in Enter, at least BARCODE_MIN_LENGTH
 * characters) vs. ordinary human typing. The FZ-55's barcode xPAK
 * (FZ-VBR551M) emits characters far faster than any human can type, so a
 * consistent sub-30ms inter-key gap is the distinguishing signal. Assumes
 * `records` has already been filtered to printable-character-or-Enter
 * entries via `filterPrintableKeydown` — it does not filter modifier keys.
 */
function classifyKeystrokeBurst(records) {
  if (!records || records.length < BARCODE_MIN_LENGTH + 1) {
    return { isScan: false, payload: '' };
  }
  const last = records[records.length - 1];
  if (last.char !== 'Enter') {
    return { isScan: false, payload: '' };
  }
  const payloadRecords = records.slice(0, -1);
  if (payloadRecords.length < BARCODE_MIN_LENGTH) {
    return { isScan: false, payload: '' };
  }
  for (let i = 1; i < records.length; i++) {
    const gap = records[i].timestampMs - records[i - 1].timestampMs;
    if (gap > BARCODE_MAX_GAP_MS) {
      return { isScan: false, payload: '' };
    }
  }
  return { isScan: true, payload: payloadRecords.map((r) => r.char).join('') };
}

/**
 * Parses `Get-WmiObject -Namespace root/WMI -Class MSAcpi_ThermalZoneTemperature
 * | Select-Object CurrentTemperature | ConvertTo-Json`.
 * WMI returns CurrentTemperature in tenths of Kelvin.
 * Formula: (tenthsK / 10 - 273.15) * 9/5 + 32  →  °F
 */
function parseWindowsThermalOutput(rawJsonString) {
  if (!rawJsonString) return null;
  let parsed;
  try { parsed = JSON.parse(rawJsonString); } catch { return null; }
  const entries = (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (e) => e && typeof e.CurrentTemperature === 'number'
  );
  if (entries.length === 0) return null;
  const zones = entries.map((e) => ({
    tempF: Math.round(((e.CurrentTemperature / 10 - 273.15) * 9) / 5 + 32),
  }));
  return { zones, maxTempF: Math.max(...zones.map((z) => z.tempF)) };
}

/**
 * Parses `Get-PnpDevice -Class SmartCard | Select-Object FriendlyName, Status, ATR
 * | ConvertTo-Json`. Returns reader presence and whether a card is currently inserted
 * (card insertion is indicated by a non-empty ATR field).
 */
function parseWindowsSmartCardOutput(rawJsonString) {
  const safe = { present: false, cardInserted: false, atr: null };
  if (!rawJsonString) return safe;
  let parsed;
  try { parsed = JSON.parse(rawJsonString); } catch { return safe; }
  const entries = (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (e) => e && typeof e === 'object'
  );
  if (entries.length === 0) return safe;
  const okEntry = entries.find((e) => e.Status === 'OK');
  if (!okEntry) return safe;
  const atr = (okEntry.ATR && String(okEntry.ATR).trim()) || null;
  return { present: true, cardInserted: Boolean(atr), atr };
}

/**
 * Parses `Get-PnpDevice -Class Biometric | Select-Object FriendlyName, Status
 * | ConvertTo-Json`. Detects fingerprint reader presence and readiness.
 */
function parseWindowsFingerprintOutput(rawJsonString) {
  const safe = { present: false, ready: false };
  if (!rawJsonString) return safe;
  let parsed;
  try { parsed = JSON.parse(rawJsonString); } catch { return safe; }
  const entries = (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (e) => e && typeof e === 'object'
  );
  if (entries.length === 0) return safe;
  const present = entries.some((e) => e.Status === 'OK' || e.Status === 'Error');
  const ready = entries.some((e) => e.Status === 'OK');
  return { present, ready };
}

/**
 * Parses `netsh mbn show signal interface=*` text output.
 * Extracts RSSI (dBm) and maps to a 0–5 bar scale.
 * RSSI mapping (LTE typical): > -65 → 5, >= -75 → 4, >= -85 → 3, >= -95 → 2, >= -105 → 1, else 0
 */
function parseWindowsWwanSignalOutput(text) {
  if (!text) return { rssi: null, bars: 0 };
  const rssiMatch = text.match(/RSSI\s*:\s*(-?\d+)/i);
  if (!rssiMatch) return { rssi: null, bars: 0 };
  const rssi = parseInt(rssiMatch[1], 10);
  let bars = 0;
  if (rssi > -65) bars = 5;
  else if (rssi >= -75) bars = 4;
  else if (rssi >= -85) bars = 3;
  else if (rssi >= -95) bars = 2;
  else if (rssi >= -105) bars = 1;
  return { rssi, bars };
}

module.exports = {
  parseWindowsBatteryOutput,
  parseWindowsDockOutput,
  parseWindowsWwanOutput,
  parseWindowsTpmOutput,
  filterPrintableKeydown,
  classifyKeystrokeBurst,
  parseWindowsThermalOutput,
  parseWindowsSmartCardOutput,
  parseWindowsFingerprintOutput,
  parseWindowsWwanSignalOutput,
};
