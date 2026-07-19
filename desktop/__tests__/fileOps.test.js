'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSaveDialogOptions, buildOpenDialogOptions, resolveAllowedRoots } = require('../fileOps');

test('buildSaveDialogOptions: defaults filters to [] when omitted', () => {
  const opts = buildSaveDialogOptions({});
  assert.deepEqual(opts, { defaultPath: undefined, filters: [] });
});

test('buildSaveDialogOptions: passes through defaultPath', () => {
  const opts = buildSaveDialogOptions({ defaultPath: '/tmp/report.pdf' });
  assert.equal(opts.defaultPath, '/tmp/report.pdf');
});

test('buildSaveDialogOptions: passes through filters', () => {
  const filters = [{ name: 'PDF', extensions: ['pdf'] }];
  const opts = buildSaveDialogOptions({ filters });
  assert.deepEqual(opts.filters, filters);
});

test('buildOpenDialogOptions: defaults filters to [] when omitted', () => {
  const opts = buildOpenDialogOptions({});
  assert.deepEqual(opts.filters, []);
});

test('buildOpenDialogOptions: multi true produces openFile + multiSelections', () => {
  const opts = buildOpenDialogOptions({ multi: true });
  assert.deepEqual(opts.properties, ['openFile', 'multiSelections']);
});

test('buildOpenDialogOptions: multi omitted produces just openFile', () => {
  const opts = buildOpenDialogOptions({});
  assert.deepEqual(opts.properties, ['openFile']);
});

test('buildOpenDialogOptions: multi false produces just openFile', () => {
  const opts = buildOpenDialogOptions({ multi: false });
  assert.deepEqual(opts.properties, ['openFile']);
});

test('resolveAllowedRoots: returns the 5 roots in documented order', () => {
  const fakeApp = { getPath: (name) => `${name}-path` };
  const roots = resolveAllowedRoots(fakeApp);
  assert.deepEqual(roots, [
    'downloads-path',
    'documents-path',
    'desktop-path',
    'temp-path',
    'userData-path',
  ]);
});
