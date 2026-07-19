'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getDiskFreeBytes, formatSystemInfo } = require('../systemInfo');

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
