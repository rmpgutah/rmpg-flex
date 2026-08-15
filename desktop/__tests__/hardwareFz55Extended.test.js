'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseWindowsThermalOutput,
  parseWindowsSmartCardOutput,
  parseWindowsFingerprintOutput,
  parseWindowsWwanSignalOutput,
  parseWindowsBatteryOutput,
  parseBodyCamHidReport,
} = require('../hardwareFz55');

// ── Thermal ──────────────────────────────────────────────────
test('parseWindowsThermalOutput: converts tenths-of-Kelvin to °F', () => {
  // 3232 tenths = 323.2 K = 50.05°C = 122.09°F
  const raw = JSON.stringify([{ CurrentTemperature: 3232 }, { CurrentTemperature: 3418 }]);
  const result = parseWindowsThermalOutput(raw);
  assert.ok(result);
  assert.equal(result.zones.length, 2);
  assert.ok(Math.abs(result.zones[0].tempF - 122.09) < 0.1);
  assert.equal(result.maxTempF, result.zones[1].tempF);
});

test('parseWindowsThermalOutput: single object (not array) from WMI', () => {
  const raw = JSON.stringify({ CurrentTemperature: 2981 }); // ~24.95°C = 76.9°F
  const result = parseWindowsThermalOutput(raw);
  assert.ok(result);
  assert.equal(result.zones.length, 1);
});

test('parseWindowsThermalOutput: returns null on bad JSON', () => {
  assert.equal(parseWindowsThermalOutput('not json'), null);
  assert.equal(parseWindowsThermalOutput(''), null);
  assert.equal(parseWindowsThermalOutput(null), null);
});

// ── Smartcard ─────────────────────────────────────────────────
test('parseWindowsSmartCardOutput: detects present reader with no card', () => {
  const raw = JSON.stringify([{ FriendlyName: 'Panasonic Smart Card Reader', Status: 'OK' }]);
  const result = parseWindowsSmartCardOutput(raw);
  assert.equal(result.present, true);
  assert.equal(result.cardInserted, false);
  assert.equal(result.atr, null);
});

test('parseWindowsSmartCardOutput: detects card inserted via ATR field', () => {
  const raw = JSON.stringify([{ FriendlyName: 'Panasonic Smart Card Reader', Status: 'OK', ATR: '3B8F8001804F0CA000000306030001000000006A' }]);
  const result = parseWindowsSmartCardOutput(raw);
  assert.equal(result.present, true);
  assert.equal(result.cardInserted, true);
  assert.equal(result.atr, '3B8F8001804F0CA000000306030001000000006A');
});

test('parseWindowsSmartCardOutput: no reader present', () => {
  const result = parseWindowsSmartCardOutput(JSON.stringify([]));
  assert.equal(result.present, false);
  assert.equal(result.cardInserted, false);
});

test('parseWindowsSmartCardOutput: returns safe default on bad JSON', () => {
  const result = parseWindowsSmartCardOutput('not json');
  assert.equal(result.present, false);
});

// ── Fingerprint ───────────────────────────────────────────────
test('parseWindowsFingerprintOutput: detects ready fingerprint reader', () => {
  const raw = JSON.stringify([{ FriendlyName: 'Panasonic Fingerprint Sensor', Status: 'OK' }]);
  const result = parseWindowsFingerprintOutput(raw);
  assert.equal(result.present, true);
  assert.equal(result.ready, true);
});

test('parseWindowsFingerprintOutput: present but not ready (degraded)', () => {
  const raw = JSON.stringify([{ FriendlyName: 'Panasonic Fingerprint Sensor', Status: 'Error' }]);
  const result = parseWindowsFingerprintOutput(raw);
  assert.equal(result.present, true);
  assert.equal(result.ready, false);
});

test('parseWindowsFingerprintOutput: no reader', () => {
  const result = parseWindowsFingerprintOutput(JSON.stringify([]));
  assert.equal(result.present, false);
  assert.equal(result.ready, false);
});

// ── WWAN signal ───────────────────────────────────────────────
test('parseWindowsWwanSignalOutput: parses RSSI and maps to bars', () => {
  // netsh mbn show signal output contains "Signal Quality : 80"
  const raw = 'Signal Quality                 : 80\r\nRSSI                           : -65 dBm\r\n';
  const result = parseWindowsWwanSignalOutput(raw);
  assert.equal(typeof result.rssi, 'number');
  assert.equal(result.bars, 4); // -65 dBm → 4 bars
});

test('parseWindowsWwanSignalOutput: returns 0 bars on empty output', () => {
  const result = parseWindowsWwanSignalOutput('');
  assert.equal(result.bars, 0);
  assert.equal(result.rssi, null);
});

test('parseWindowsWwanSignalOutput: returns 0 bars on null input', () => {
  const result = parseWindowsWwanSignalOutput(null);
  assert.equal(result.bars, 0);
});

// ── Battery minutesRemaining ──────────────────────────────────
test('parseWindowsBatteryOutput: includes minutesRemaining from EstimatedRunTime', () => {
  const raw = JSON.stringify([
    { EstimatedChargeRemaining: 87, BatteryStatus: 1, EstimatedRunTime: 192 },
    { EstimatedChargeRemaining: 91, BatteryStatus: 1, EstimatedRunTime: 210 },
  ]);
  const result = parseWindowsBatteryOutput(raw);
  assert.ok(result);
  // minutesRemaining is the average of both bays' EstimatedRunTime
  assert.equal(result.minutesRemaining, 201);
});

test('parseWindowsBatteryOutput: minutesRemaining is null when EstimatedRunTime absent', () => {
  const raw = JSON.stringify([{ EstimatedChargeRemaining: 80, BatteryStatus: 1 }]);
  const result = parseWindowsBatteryOutput(raw);
  assert.equal(result.minutesRemaining, null);
});

test('parseWindowsBatteryOutput: minutesRemaining is null when WMI returns 71582788 (unknown)', () => {
  // WMI returns 71582788 when runtime is unknown (charge cycle calculating)
  const raw = JSON.stringify([{ EstimatedChargeRemaining: 50, BatteryStatus: 2, EstimatedRunTime: 71582788 }]);
  const result = parseWindowsBatteryOutput(raw);
  assert.equal(result.minutesRemaining, null);
});

// ── Body cam HID ──────────────────────────────────────────────
test('parseBodyCamHidReport: parses Axon Body 4 HID report — recording + battery', () => {
  // Byte 0: report ID (0x01), Byte 1: flags (bit 0 = recording), Byte 2: battery %
  const buf = Buffer.from([0x01, 0x01, 0x59]); // recording=true, battery=89%
  const result = parseBodyCamHidReport(buf);
  assert.equal(result.recording, true);
  assert.equal(result.batteryPct, 89);
});

test('parseBodyCamHidReport: not recording', () => {
  const buf = Buffer.from([0x01, 0x00, 0x46]); // recording=false, battery=70%
  const result = parseBodyCamHidReport(buf);
  assert.equal(result.recording, false);
  assert.equal(result.batteryPct, 70);
});

test('parseBodyCamHidReport: returns safe default on null/short buffer', () => {
  assert.deepEqual(parseBodyCamHidReport(null), { recording: false, batteryPct: null });
  assert.deepEqual(parseBodyCamHidReport(Buffer.alloc(1)), { recording: false, batteryPct: null });
});
