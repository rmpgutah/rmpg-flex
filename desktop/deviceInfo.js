// ============================================================
// RMPG Flex — Device & Hardware
// Pure shaping/decision functions for serial/audio/video/
// bluetooth device enumeration, GPS presence classification,
// and multi-display info. Every OS/Electron-touching function
// takes its dependency as a parameter, mirroring
// desktop/systemInfo.js's pattern, for zero-runtime-dependency
// unit testing.
// ============================================================

'use strict';

/** Formats SerialPort.list()'s resolved shape down to {path, manufacturer}. */
function formatSerialPorts(rawPortList) {
  return (rawPortList || []).map((port) => ({
    path: port.path,
    manufacturer: port.manufacturer || null,
  }));
}

/**
 * Buckets the Web Platform's navigator.mediaDevices.enumerateDevices()
 * result into {inputs, outputs} audio devices. Runs entirely in the
 * renderer/preload context (see Group D plan's Scope Decision #1) — this
 * function itself has no Electron/Node dependency, so it's unit-tested
 * with a plain fake array, no navigator/DOM needed.
 */
function groupMediaDevicesByKind(mediaDeviceInfoList) {
  const inputs = [];
  const outputs = [];
  for (const device of mediaDeviceInfoList || []) {
    if (device.kind === 'audioinput') {
      inputs.push({ deviceId: device.deviceId, label: device.label });
    } else if (device.kind === 'audiooutput') {
      outputs.push({ deviceId: device.deviceId, label: device.label });
    }
  }
  return { inputs, outputs };
}

/**
 * Filters navigator.mediaDevices.enumerateDevices()'s result down to video
 * input (camera) devices only. See groupMediaDevicesByKind's doc comment —
 * same renderer-only scope decision applies here.
 */
function filterVideoInputDevices(mediaDeviceInfoList) {
  return (mediaDeviceInfoList || [])
    .filter((device) => device.kind === 'videoinput')
    .map((device) => ({ id: device.deviceId, label: device.label }));
}

/**
 * Parses `system_profiler SPBluetoothDataType -json`'s output into
 * {name, paired, connected}. Real shape (macOS, observed):
 *   { SPBluetoothDataType: [ { device_connected: [ {name: {...}} ], device_not_connected: [ {name: {...}} ] } ] }
 * Each device entry is a single-key object keyed by the device's display
 * name — the value object's own fields aren't needed for this shape.
 * Tolerant of missing/malformed input: returns [] rather than throwing, so
 * a `system_profiler` output-format change degrades to an empty list
 * instead of crashing the device:bluetooth handler.
 */
function parseSystemProfilerBluetoothOutput(jsonString) {
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return [];
  }
  const root = parsed?.SPBluetoothDataType?.[0];
  if (!root) return [];

  function namesFrom(list) {
    return (list || []).flatMap((entry) => Object.keys(entry || {}));
  }

  const connectedNames = new Set(namesFrom(root.device_connected));
  const pairedNames = new Set([...connectedNames, ...namesFrom(root.device_not_connected)]);

  return [...pairedNames].map((name) => ({
    name,
    paired: true,
    connected: connectedNames.has(name),
  }));
}

/**
 * Turns findGpsPort()'s result plus a probeGpsPortOpen() outcome into the
 * device:gps-present shape. See Group D plan's Scope Decision #3 for why a
 * live open-probe (not just enumeration) is needed to distinguish "no GPS
 * module" from "module present but its port is currently in use".
 */
function classifyGpsPresence(foundPort, probeError) {
  if (!foundPort) return { present: false, portBusy: false };
  return { present: true, portBusy: Boolean(probeError) };
}

/**
 * Formats Electron's screen.getAllDisplays() down to {id, bounds, primary},
 * flagging whichever display's id matches primaryDisplayId
 * (screen.getPrimaryDisplay().id).
 */
function formatDisplays(rawDisplays, primaryDisplayId) {
  return (rawDisplays || []).map((display) => ({
    id: display.id,
    bounds: display.bounds,
    primary: display.id === primaryDisplayId,
  }));
}

module.exports = {
  formatSerialPorts,
  groupMediaDevicesByKind,
  filterVideoInputDevices,
  parseSystemProfilerBluetoothOutput,
  classifyGpsPresence,
  formatDisplays,
};
