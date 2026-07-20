'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatSerialPorts,
  groupMediaDevicesByKind,
  filterVideoInputDevices,
  parseSystemProfilerBluetoothOutput,
  classifyGpsPresence,
  formatDisplays,
} = require('../deviceInfo');

test('formatSerialPorts: maps to {path, manufacturer}, defaulting missing manufacturer to null', () => {
  const raw = [
    { path: '/dev/tty.usbserial-1', manufacturer: 'FTDI', vendorId: '0403' },
    { path: '/dev/tty.usbserial-2' },
  ];
  assert.deepEqual(formatSerialPorts(raw), [
    { path: '/dev/tty.usbserial-1', manufacturer: 'FTDI' },
    { path: '/dev/tty.usbserial-2', manufacturer: null },
  ]);
});

test('formatSerialPorts: empty/undefined input returns []', () => {
  assert.deepEqual(formatSerialPorts([]), []);
  assert.deepEqual(formatSerialPorts(undefined), []);
});

test('groupMediaDevicesByKind: buckets audioinput/audiooutput, ignores other kinds', () => {
  const devices = [
    { kind: 'audioinput', deviceId: 'mic1', label: 'Built-in Microphone' },
    { kind: 'audiooutput', deviceId: 'spk1', label: 'Built-in Speakers' },
    { kind: 'videoinput', deviceId: 'cam1', label: 'FaceTime Camera' },
    { kind: 'audioinput', deviceId: 'mic2', label: 'USB Headset' },
  ];
  assert.deepEqual(groupMediaDevicesByKind(devices), {
    inputs: [
      { deviceId: 'mic1', label: 'Built-in Microphone' },
      { deviceId: 'mic2', label: 'USB Headset' },
    ],
    outputs: [{ deviceId: 'spk1', label: 'Built-in Speakers' }],
  });
});

test('groupMediaDevicesByKind: empty/undefined input returns empty buckets', () => {
  assert.deepEqual(groupMediaDevicesByKind([]), { inputs: [], outputs: [] });
  assert.deepEqual(groupMediaDevicesByKind(undefined), { inputs: [], outputs: [] });
});

test('filterVideoInputDevices: keeps only videoinput, maps deviceId to id', () => {
  const devices = [
    { kind: 'audioinput', deviceId: 'mic1', label: 'Mic' },
    { kind: 'videoinput', deviceId: 'cam1', label: 'FaceTime Camera' },
    { kind: 'videoinput', deviceId: 'cam2', label: 'External USB Camera' },
  ];
  assert.deepEqual(filterVideoInputDevices(devices), [
    { id: 'cam1', label: 'FaceTime Camera' },
    { id: 'cam2', label: 'External USB Camera' },
  ]);
});

test('filterVideoInputDevices: empty/undefined input returns []', () => {
  assert.deepEqual(filterVideoInputDevices([]), []);
  assert.deepEqual(filterVideoInputDevices(undefined), []);
});

const BLUETOOTH_FIXTURE = JSON.stringify({
  SPBluetoothDataType: [
    {
      device_connected: [{ 'AirPods Pro': { device_minorClassOfDevice_string: 'Headphones' } }],
      device_not_connected: [
        { 'Magic Keyboard': { device_minorClassOfDevice_string: 'Keyboard' } },
        { 'Body-Cam Dock': { device_minorClassOfDevice_string: 'Uncategorized' } },
      ],
    },
  ],
});

test('parseSystemProfilerBluetoothOutput: splits connected vs paired-only, both marked paired', () => {
  const result = parseSystemProfilerBluetoothOutput(BLUETOOTH_FIXTURE);
  const byName = Object.fromEntries(result.map((d) => [d.name, d]));
  assert.equal(result.length, 3);
  assert.deepEqual(byName['AirPods Pro'], { name: 'AirPods Pro', paired: true, connected: true });
  assert.deepEqual(byName['Magic Keyboard'], { name: 'Magic Keyboard', paired: true, connected: false });
  assert.deepEqual(byName['Body-Cam Dock'], { name: 'Body-Cam Dock', paired: true, connected: false });
});

test('parseSystemProfilerBluetoothOutput: no bluetooth devices at all returns []', () => {
  const empty = JSON.stringify({ SPBluetoothDataType: [{}] });
  assert.deepEqual(parseSystemProfilerBluetoothOutput(empty), []);
});

test('parseSystemProfilerBluetoothOutput: malformed JSON returns [] instead of throwing', () => {
  assert.deepEqual(parseSystemProfilerBluetoothOutput('not json'), []);
  assert.deepEqual(parseSystemProfilerBluetoothOutput('{}'), []);
  assert.deepEqual(parseSystemProfilerBluetoothOutput(''), []);
});

test('classifyGpsPresence: no port found -> not present, not busy', () => {
  assert.deepEqual(classifyGpsPresence(null, null), { present: false, portBusy: false });
});

test('classifyGpsPresence: port found, probe succeeded -> present, free', () => {
  assert.deepEqual(classifyGpsPresence({ path: '/dev/tty.usbserial-1', score: 100 }, null), {
    present: true,
    portBusy: false,
  });
});

test('classifyGpsPresence: port found, probe failed -> present, busy', () => {
  assert.deepEqual(
    classifyGpsPresence({ path: '/dev/tty.usbserial-1', score: 100 }, new Error('Access denied')),
    { present: true, portBusy: true },
  );
});

test('formatDisplays: flags the display matching primaryDisplayId', () => {
  const raw = [
    { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 720 } },
  ];
  assert.deepEqual(formatDisplays(raw, 2), [
    { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, primary: false },
    { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 720 }, primary: true },
  ]);
});

test('formatDisplays: no display matches primaryDisplayId -> all false', () => {
  const raw = [{ id: 1, bounds: { x: 0, y: 0, width: 800, height: 600 } }];
  assert.deepEqual(formatDisplays(raw, 999), [
    { id: 1, bounds: { x: 0, y: 0, width: 800, height: 600 }, primary: false },
  ]);
});

test('formatDisplays: empty/undefined input returns []', () => {
  assert.deepEqual(formatDisplays([], 1), []);
  assert.deepEqual(formatDisplays(undefined, 1), []);
});
