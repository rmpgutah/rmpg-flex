'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseWindowsBatteryOutput, parseWindowsDockOutput, parseWindowsWwanOutput } = require('../hardwareFz55');
const { parseWindowsTpmOutput, classifyKeystrokeBurst, filterPrintableKeydown } = require('../hardwareFz55');

test('parseWindowsBatteryOutput: single battery, discharging', () => {
  const raw = JSON.stringify({ DeviceID: 'Battery0', EstimatedChargeRemaining: 76, BatteryStatus: 1 });
  assert.deepEqual(parseWindowsBatteryOutput(raw), {
    batteries: [{ percent: 76, charging: false }],
    overallPercent: 76,
    charging: false,
  });
});

test('parseWindowsBatteryOutput: single battery, charging (AC)', () => {
  const raw = JSON.stringify({ DeviceID: 'Battery0', EstimatedChargeRemaining: 40, BatteryStatus: 2 });
  assert.deepEqual(parseWindowsBatteryOutput(raw), {
    batteries: [{ percent: 40, charging: true }],
    overallPercent: 40,
    charging: true,
  });
});

test('parseWindowsBatteryOutput: dual hot-swap bays, both discharging', () => {
  const raw = JSON.stringify([
    { DeviceID: 'Battery0', EstimatedChargeRemaining: 80, BatteryStatus: 1 },
    { DeviceID: 'Battery1', EstimatedChargeRemaining: 60, BatteryStatus: 1 },
  ]);
  assert.deepEqual(parseWindowsBatteryOutput(raw), {
    batteries: [
      { percent: 80, charging: false },
      { percent: 60, charging: false },
    ],
    overallPercent: 70,
    charging: false,
  });
});

test('parseWindowsBatteryOutput: dual bays, one charging counts overall as charging', () => {
  const raw = JSON.stringify([
    { DeviceID: 'Battery0', EstimatedChargeRemaining: 50, BatteryStatus: 2 },
    { DeviceID: 'Battery1', EstimatedChargeRemaining: 90, BatteryStatus: 1 },
  ]);
  const result = parseWindowsBatteryOutput(raw);
  assert.equal(result.overallPercent, 70);
  assert.equal(result.charging, true);
});

test('parseWindowsBatteryOutput: empty array (desktop, no battery) returns null', () => {
  assert.equal(parseWindowsBatteryOutput(JSON.stringify([])), null);
});

test('parseWindowsBatteryOutput: malformed JSON returns null', () => {
  assert.equal(parseWindowsBatteryOutput('not json'), null);
});

test('parseWindowsBatteryOutput: JSON literal null returns null', () => {
  assert.equal(parseWindowsBatteryOutput('null'), null);
});

test('parseWindowsBatteryOutput: entry missing EstimatedChargeRemaining does not turn overallPercent into NaN', () => {
  const raw = JSON.stringify([
    { DeviceID: 'Battery0', EstimatedChargeRemaining: 80, BatteryStatus: 1 },
    { DeviceID: 'Battery1', BatteryStatus: 1 },
  ]);
  const result = parseWindowsBatteryOutput(raw);
  assert.equal(Number.isNaN(result.overallPercent), false);
  assert.deepEqual(result.batteries, [
    { percent: 80, charging: false },
    { percent: 0, charging: false },
  ]);
});

test('parseWindowsDockOutput: docked when a DockUpDown device is OK', () => {
  const raw = JSON.stringify({ Status: 'OK' });
  assert.deepEqual(parseWindowsDockOutput(raw), { docked: true });
});

test('parseWindowsDockOutput: docked when multiple DockUpDown devices, one OK', () => {
  const raw = JSON.stringify([{ Status: 'Error' }, { Status: 'OK' }]);
  assert.deepEqual(parseWindowsDockOutput(raw), { docked: true });
});

test('parseWindowsDockOutput: not docked when no devices returned', () => {
  assert.deepEqual(parseWindowsDockOutput(JSON.stringify([])), { docked: false });
});

test('parseWindowsDockOutput: not docked when devices exist but none OK', () => {
  const raw = JSON.stringify([{ Status: 'Error' }]);
  assert.deepEqual(parseWindowsDockOutput(raw), { docked: false });
});

test('parseWindowsDockOutput: not docked on malformed JSON', () => {
  assert.deepEqual(parseWindowsDockOutput('garbage'), { docked: false });
});

test('parseWindowsDockOutput: JSON literal null is not docked', () => {
  assert.deepEqual(parseWindowsDockOutput('null'), { docked: false });
});

test('parseWindowsWwanOutput: present and connected', () => {
  const raw = JSON.stringify({ Name: 'Sierra Wireless EM7511', InterfaceDescription: 'Sierra Wireless EM7511', Status: 'Up' });
  assert.deepEqual(parseWindowsWwanOutput(raw), { present: true, connected: true });
});

test('parseWindowsWwanOutput: present but not connected', () => {
  const raw = JSON.stringify({ Name: 'Sierra Wireless EM7511', InterfaceDescription: 'Sierra Wireless EM7511', Status: 'Disconnected' });
  assert.deepEqual(parseWindowsWwanOutput(raw), { present: true, connected: false });
});

test('parseWindowsWwanOutput: no WWAN adapter installed', () => {
  assert.deepEqual(parseWindowsWwanOutput(JSON.stringify([])), { present: false, connected: false });
});

test('parseWindowsWwanOutput: malformed JSON treated as not present', () => {
  assert.deepEqual(parseWindowsWwanOutput('garbage'), { present: false, connected: false });
});

test('parseWindowsWwanOutput: JSON literal null treated as not present', () => {
  assert.deepEqual(parseWindowsWwanOutput('null'), { present: false, connected: false });
});

test('parseWindowsTpmOutput: present, ready, and enabled', () => {
  const raw = JSON.stringify({ TpmPresent: true, TpmReady: true, TpmEnabled: true });
  assert.deepEqual(parseWindowsTpmOutput(raw), { present: true, ready: true, enabled: true });
});

test('parseWindowsTpmOutput: present but not ready', () => {
  const raw = JSON.stringify({ TpmPresent: true, TpmReady: false, TpmEnabled: true });
  assert.deepEqual(parseWindowsTpmOutput(raw), { present: true, ready: false, enabled: true });
});

test('parseWindowsTpmOutput: not present', () => {
  const raw = JSON.stringify({ TpmPresent: false, TpmReady: false, TpmEnabled: false });
  assert.deepEqual(parseWindowsTpmOutput(raw), { present: false, ready: false, enabled: false });
});

test('parseWindowsTpmOutput: malformed JSON returns null', () => {
  assert.equal(parseWindowsTpmOutput('garbage'), null);
});

test('parseWindowsTpmOutput: JSON literal null returns null', () => {
  assert.equal(parseWindowsTpmOutput('null'), null);
});

function burst(chars, gapMs) {
  return chars.split('').map((char, i) => ({ char, timestampMs: i * gapMs }));
}

test('classifyKeystrokeBurst: fast burst ending in Enter is a scan', () => {
  const records = burst('ABC123', 10).concat([{ char: 'Enter', timestampMs: 60 }]);
  assert.deepEqual(classifyKeystrokeBurst(records), { isScan: true, payload: 'ABC123' });
});

test('classifyKeystrokeBurst: slow human typing is not a scan', () => {
  const records = burst('ABC123', 200).concat([{ char: 'Enter', timestampMs: 1200 }]);
  assert.deepEqual(classifyKeystrokeBurst(records), { isScan: false, payload: '' });
});

test('classifyKeystrokeBurst: fast burst not ending in Enter is not a scan', () => {
  const records = burst('ABC123', 10);
  assert.deepEqual(classifyKeystrokeBurst(records), { isScan: false, payload: '' });
});

test('classifyKeystrokeBurst: fast but under the 3-char minimum is not a scan', () => {
  const records = burst('AB', 10).concat([{ char: 'Enter', timestampMs: 20 }]);
  assert.deepEqual(classifyKeystrokeBurst(records), { isScan: false, payload: '' });
});

test('classifyKeystrokeBurst: one slow gap in an otherwise-fast burst is not a scan', () => {
  const records = [
    { char: 'A', timestampMs: 0 },
    { char: 'B', timestampMs: 10 },
    { char: 'C', timestampMs: 300 },
    { char: 'D', timestampMs: 310 },
    { char: 'Enter', timestampMs: 320 },
  ];
  assert.deepEqual(classifyKeystrokeBurst(records), { isScan: false, payload: '' });
});

test('classifyKeystrokeBurst: empty input is not a scan', () => {
  assert.deepEqual(classifyKeystrokeBurst([]), { isScan: false, payload: '' });
});

test('filterPrintableKeydown: single printable characters are buffered', () => {
  assert.equal(filterPrintableKeydown('A'), true);
  assert.equal(filterPrintableKeydown('1'), true);
  assert.equal(filterPrintableKeydown('$'), true);
});

test('filterPrintableKeydown: Enter terminator is buffered', () => {
  assert.equal(filterPrintableKeydown('Enter'), true);
});

test('filterPrintableKeydown: modifier and non-printable keys are rejected', () => {
  assert.equal(filterPrintableKeydown('Shift'), false);
  assert.equal(filterPrintableKeydown('Control'), false);
  assert.equal(filterPrintableKeydown('Alt'), false);
  assert.equal(filterPrintableKeydown('Dead'), false);
});
