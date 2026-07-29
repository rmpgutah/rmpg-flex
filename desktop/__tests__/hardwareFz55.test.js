'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseWindowsBatteryOutput, parseWindowsDockOutput } = require('../hardwareFz55');

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
