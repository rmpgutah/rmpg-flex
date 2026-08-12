'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getDiskFreeBytes, formatSystemInfo } = require('../systemInfo');
const { appendToLogFile, tailLogFile } = require('../systemInfo');

function fakeFs(statfsResult) {
  return { statfsSync: () => statfsResult };
}

test('getDiskFreeBytes: computes bytes from bavail * bsize', () => {
  const fs = fakeFs({ bavail: 1000, bsize: 4096 });
  assert.equal(getDiskFreeBytes('/', fs), 1000 * 4096);
});

function fakeOs() {
  return {
    hostname: () => 'fz55-unit',
    platform: () => 'darwin',
    arch: () => 'arm64',
    release: () => '24.5.0',
    cpus: () => [{ model: 'Apple M2' }, { model: 'Apple M2' }],
    totalmem: () => 17179869184,
    freemem: () => 4294967296,
    uptime: () => 3600,
  };
}

test('formatSystemInfo: assembles the expected shape from os + a precomputed freeBytes', () => {
  const info = formatSystemInfo(fakeOs(), 214748364800);
  const MB = 1024 * 1024;
  const GB = MB * 1024;
  assert.deepEqual(info, {
    hostname: 'fz55-unit',
    platform: 'darwin',
    arch: 'arm64',
    os_version: '24.5.0',
    cpu_count: 2,
    cpu_model: 'Apple M2',
    uptime_seconds: 3600,
    total_memory_mb: Math.round(17179869184 / MB),
    free_memory_mb: Math.round(4294967296 / MB),
    disk_free_gb: Math.round((214748364800 / GB) * 10) / 10,
    disk_free_bytes: 214748364800,
  });
});

test('formatSystemInfo: cpuModel falls back to "unknown" when cpus() is empty', () => {
  const os = { ...fakeOs(), cpus: () => [] };
  const info = formatSystemInfo(os, 0);
  assert.equal(info.cpu_model, 'Unknown');
});

function fakeFsWithStore(initialContent) {
  let content = initialContent;
  return {
    existsSync: () => content !== undefined,
    appendFileSync: (_path, line) => { content = (content || '') + line; },
    readFileSync: () => content,
    _get: () => content,
  };
}

test('appendToLogFile: appends a timestamped line ending in a newline', () => {
  const fs = fakeFsWithStore('');
  appendToLogFile('hello world', '/logs/app.log', fs);
  const written = fs._get();
  assert.match(written, /\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] hello world\n$/);
});

test('tailLogFile: returns empty string when the file does not exist', () => {
  const fs = fakeFsWithStore(undefined);
  assert.equal(tailLogFile('/logs/app.log', 5, fs), '');
});

test('tailLogFile: returns only the last N lines', () => {
  const fs = fakeFsWithStore('line1\nline2\nline3\nline4\nline5\n');
  assert.equal(tailLogFile('/logs/app.log', 2, fs), 'line4\nline5');
});

test('tailLogFile: returns everything when fewer lines exist than requested', () => {
  const fs = fakeFsWithStore('only-line\n');
  assert.equal(tailLogFile('/logs/app.log', 500, fs), 'only-line');
});

const path = require('node:path');
const { getLogsDirectory } = require('../systemInfo');

test('getLogsDirectory: returns the directory containing the log file', () => {
  assert.equal(getLogsDirectory('/Users/officer/Library/Application Support/RMPG Flex/rmpg-flex.log', path), '/Users/officer/Library/Application Support/RMPG Flex');
});

const { buildDiagnosticsBundleText } = require('../systemInfo');

test('buildDiagnosticsBundleText: combines system info and log tail into one text block', () => {
  const info = { os: 'darwin', arch: 'arm64', cpuModel: 'Apple M2', totalMem: 100, freeMem: 50, diskFree: 1000 };
  const text = buildDiagnosticsBundleText(info, 'log line 1\nlog line 2');
  assert.match(text, /=== System Info ===/);
  assert.match(text, /"os": "darwin"/);
  assert.match(text, /=== Recent Logs ===/);
  assert.match(text, /log line 1/);
});

const { listCrashReports } = require('../systemInfo');

function fakeFsDir(exists, entries) {
  return {
    existsSync: () => exists,
    readdirSync: () => entries.map((e) => e.name),
    statSync: (p) => ({ mtime: entries.find((e) => p.endsWith(e.name)).mtime }),
  };
}

test('listCrashReports: returns [] when the crash dumps directory does not exist', () => {
  const fs = fakeFsDir(false, []);
  assert.deepEqual(listCrashReports('/crashes', fs), []);
});

test('listCrashReports: lists files with date and path', () => {
  const mtime = new Date('2026-07-01T00:00:00Z');
  const fs = fakeFsDir(true, [{ name: 'crash-1.dmp', mtime }]);
  const result = listCrashReports('/crashes', fs);
  assert.equal(result.length, 1);
  assert.equal(result[0].path, '/crashes/crash-1.dmp');
  assert.equal(result[0].date, mtime.toISOString());
});

const { evaluateDiskSpace } = require('../systemInfo');

test('evaluateDiskSpace: warn is false comfortably above the threshold', () => {
  assert.deepEqual(evaluateDiskSpace(2_000_000_000), { freeBytes: 2_000_000_000, warn: false });
});

test('evaluateDiskSpace: warn is true below the default 500MB threshold', () => {
  assert.deepEqual(evaluateDiskSpace(100_000_000), { freeBytes: 100_000_000, warn: true });
});

test('evaluateDiskSpace: accepts a custom threshold', () => {
  assert.deepEqual(evaluateDiskSpace(1_000_000_000, 2_000_000_000), { freeBytes: 1_000_000_000, warn: true });
});

test('evaluateDiskSpace: null freeBytes coerces to a false-positive warn (why callers must not pass null through)', () => {
  // JS coerces null to 0 in a numeric comparison, so evaluateDiskSpace(null) reports
  // warn: true — "disk space is low" — when the real problem is "couldn't determine
  // disk space at all". This is why the sys:disk-space handler in main.js must catch
  // a statfsSync failure and return { freeBytes: null, warn: false } directly instead
  // of routing the null through evaluateDiskSpace.
  assert.deepEqual(evaluateDiskSpace(null), { freeBytes: null, warn: true });
});

const { formatNetworkInterfaces } = require('../systemInfo');

test('formatNetworkInterfaces: filters out internal/loopback interfaces', () => {
  const raw = {
    lo0: [{ address: '127.0.0.1', internal: true, family: 'IPv4' }],
    en0: [{ address: '192.168.1.42', internal: false, family: 'IPv4' }],
  };
  const result = formatNetworkInterfaces(raw);
  assert.deepEqual(result, [{ name: 'en0', address: '192.168.1.42', type: 'IPv4' }]);
});

test('formatNetworkInterfaces: includes multiple addresses on the same interface as separate entries', () => {
  const raw = {
    en0: [
      { address: '192.168.1.42', internal: false, family: 'IPv4' },
      { address: 'fe80::1', internal: false, family: 'IPv6' },
    ],
  };
  const result = formatNetworkInterfaces(raw);
  assert.equal(result.length, 2);
  assert.equal(result[0].type, 'IPv4');
  assert.equal(result[1].type, 'IPv6');
});

test('formatNetworkInterfaces: returns [] for an empty interfaces object', () => {
  assert.deepEqual(formatNetworkInterfaces({}), []);
});

const { parsePmsetBatteryOutput } = require('../systemInfo');

test('parsePmsetBatteryOutput: parses a discharging laptop', () => {
  const raw = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=4325561)\t87%; discharging; 3:47 remaining present: true\n";
  assert.deepEqual(parsePmsetBatteryOutput(raw), { percent: 87, charging: false });
});

test('parsePmsetBatteryOutput: parses a charging laptop', () => {
  const raw = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=4325561)\t54%; charging; 1:12 remaining present: true\n";
  assert.deepEqual(parsePmsetBatteryOutput(raw), { percent: 54, charging: true });
});

test('parsePmsetBatteryOutput: parses "charged" (fully charged, on AC) as not charging', () => {
  const raw = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=4325561)\t100%; charged; 0:00 remaining present: true\n";
  assert.deepEqual(parsePmsetBatteryOutput(raw), { percent: 100, charging: false });
});

test('parsePmsetBatteryOutput: returns null for a desktop Mac with no battery line', () => {
  const raw = "Now drawing from 'AC Power'\n";
  assert.equal(parsePmsetBatteryOutput(raw), null);
});

test('parsePmsetBatteryOutput: returns null for unrecognizable output', () => {
  assert.equal(parsePmsetBatteryOutput('garbage'), null);
});
