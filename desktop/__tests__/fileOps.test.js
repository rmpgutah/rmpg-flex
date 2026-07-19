'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSaveDialogOptions, buildOpenDialogOptions, resolveAllowedRoots, formatPrinters, isKnownPrinterName, encodeBackupForExport, decodeBackupForImport } = require('../fileOps');

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

test('formatPrinters: maps raw printer list to {name, isDefault} pairs, preserving order', () => {
  const rawPrinterList = [
    {
      name: 'HP_LaserJet',
      displayName: 'HP LaserJet',
      description: 'HP LaserJet Pro',
      status: 0,
      isDefault: false,
      options: {},
    },
    {
      name: 'Canon_Pixma',
      displayName: 'Canon Pixma',
      description: 'Canon Pixma MG3600',
      status: 0,
      isDefault: true,
      options: {},
    },
    {
      name: 'PDF_Printer',
      displayName: 'Save as PDF',
      description: 'Virtual PDF printer',
      status: 0,
      isDefault: false,
      options: {},
    },
  ];
  const printers = formatPrinters(rawPrinterList);
  assert.deepEqual(printers, [
    { name: 'HP_LaserJet', isDefault: false },
    { name: 'Canon_Pixma', isDefault: true },
    { name: 'PDF_Printer', isDefault: false },
  ]);
});

test('isKnownPrinterName: returns true when the name matches an entry in the list', () => {
  const printers = [
    { name: 'HP_LaserJet', isDefault: false },
    { name: 'Canon_Pixma', isDefault: true },
  ];
  assert.equal(isKnownPrinterName('Canon_Pixma', printers), true);
});

test('isKnownPrinterName: returns false when the name does not match any entry', () => {
  const printers = [
    { name: 'HP_LaserJet', isDefault: false },
    { name: 'Canon_Pixma', isDefault: true },
  ];
  assert.equal(isKnownPrinterName('Nonexistent_Printer', printers), false);
});

test('isKnownPrinterName: returns false for an empty printer list', () => {
  assert.equal(isKnownPrinterName('Any_Printer', []), false);
});

test('encodeBackupForExport: base64-encodes raw bytes then encrypts via safeStorage', () => {
  const fakeSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + s),
  };
  const rawBytes = Buffer.from('hello');
  const result = encodeBackupForExport(rawBytes, fakeSafeStorage);
  const expected = Buffer.from('enc:' + rawBytes.toString('base64')).toString('base64');
  assert.equal(result, expected);
});

test('encodeBackupForExport: throws TypeError for a non-Buffer input', () => {
  const fakeSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + s),
  };
  assert.throws(() => encodeBackupForExport('not-a-buffer', fakeSafeStorage), TypeError);
});

test('decodeBackupForImport: decrypts then base64-decodes back to the original raw bytes', () => {
  const fakeSafeStorage = {
    decryptString: (buf) => buf.toString().slice(4),
  };
  const rawBytes = Buffer.from('hello');
  // Matches the Task 8 test fixture: encryptSecretForStorage's
  // encryptString('enc:' + base64) -> .toString('base64').
  const encodedText = Buffer.from('enc:' + rawBytes.toString('base64')).toString('base64');
  const result = decodeBackupForImport(encodedText, fakeSafeStorage);
  assert.deepEqual(result, rawBytes);
});

test('decodeBackupForImport: round-trips exactly with encodeBackupForExport using matching fakes', () => {
  const fakeSafeStorageForEncrypt = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + s),
  };
  const fakeSafeStorageForDecrypt = {
    decryptString: (buf) => buf.toString().slice(4),
  };
  const rawBytes = Buffer.from('this is a raw sqlite backup payload, not really SQLite bytes');
  const encoded = encodeBackupForExport(rawBytes, fakeSafeStorageForEncrypt);
  const decoded = decodeBackupForImport(encoded, fakeSafeStorageForDecrypt);
  assert.deepEqual(decoded, rawBytes);
});
