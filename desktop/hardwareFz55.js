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
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  if (entries.length === 0) return null;

  const batteries = entries.map((entry) => ({
    percent: Number(entry.EstimatedChargeRemaining),
    charging: entry.BatteryStatus === 2,
  }));

  const overallPercent = Math.round(
    batteries.reduce((sum, b) => sum + b.percent, 0) / batteries.length
  );
  const charging = batteries.some((b) => b.charging);

  return { batteries, overallPercent, charging };
}

module.exports = {
  parseWindowsBatteryOutput,
};
