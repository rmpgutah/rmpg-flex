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
    platform: () => 'darwin',
    arch: () => 'arm64',
    cpus: () => [{ model: 'Apple M2' }, { model: 'Apple M2' }],
    totalmem: () => 17179869184,
    freemem: () => 4294967296,
  };
}

test('formatSystemInfo: assembles the expected shape from os + a precomputed freeBytes', () => {
  const info = formatSystemInfo(fakeOs(), 214748364800);
  assert.deepEqual(info, {
    os: 'darwin',
    arch: 'arm64',
    cpuModel: 'Apple M2',
    totalMem: 17179869184,
    freeMem: 4294967296,
    diskFree: 214748364800,
  });
});

test('formatSystemInfo: cpuModel falls back to "unknown" when cpus() is empty', () => {
  const os = { ...fakeOs(), cpus: () => [] };
  const info = formatSystemInfo(os, 0);
  assert.equal(info.cpuModel, 'unknown');
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
