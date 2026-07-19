'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSaveDialogOptions, buildOpenDialogOptions, resolveAllowedRoots, formatPrinters, isKnownPrinterName, encodeBackupForExport, decodeBackupForImport, swapInLocalDbWithRollback } = require('../fileOps');

/**
 * In-memory fake for Node's `fs` module, exposing only the
 * `.promises.{copyFile,writeFile,unlink,access}` shape swapInLocalDbWithRollback
 * depends on. `files` is a path -> Buffer map callers can seed/inspect directly.
 */
function makeFakeFsModule(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles));
  function missing(op, target) {
    const err = new Error(`ENOENT: no such file or directory, ${op} '${target}'`);
    err.code = 'ENOENT';
    return err;
  }
  return {
    files,
    promises: {
      async copyFile(src, dest) {
        if (!files.has(src)) throw missing('copyfile', src);
        files.set(dest, files.get(src));
      },
      async writeFile(dest, data) {
        files.set(dest, data);
      },
      async unlink(target) {
        if (!files.has(target)) throw missing('unlink', target);
        files.delete(target);
      },
      async access(target) {
        if (!files.has(target)) throw missing('access', target);
      },
    },
  };
}

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

test('swapInLocalDbWithRollback: happy path swaps in the new DB and cleans up the rollback snapshot', async () => {
  const dbPath = '/fake/userData/rmpg-local.db';
  const oldBytes = Buffer.from('OLD DB BYTES');
  const newBytes = Buffer.from('NEW DB BYTES');
  const fakeFs = makeFakeFsModule({ [dbPath]: oldBytes });
  let closeCalls = 0;
  let initCalls = 0;

  const result = await swapInLocalDbWithRollback(newBytes, {
    dbPath,
    fsModule: fakeFs,
    closeLocalDb: () => { closeCalls++; },
    initLocalDb: () => { initCalls++; },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(closeCalls, 1);
  assert.equal(initCalls, 1);
  assert.deepEqual(fakeFs.files.get(dbPath), newBytes);
  assert.equal(fakeFs.files.has(dbPath + '.pre-import-backup'), false);
});

test('swapInLocalDbWithRollback: first-ever run (no existing DB to snapshot) still succeeds', async () => {
  const dbPath = '/fake/userData/rmpg-local.db';
  const newBytes = Buffer.from('NEW DB BYTES');
  const fakeFs = makeFakeFsModule({}); // no pre-existing dbPath entry

  const result = await swapInLocalDbWithRollback(newBytes, {
    dbPath,
    fsModule: fakeFs,
    closeLocalDb: () => {},
    initLocalDb: () => {},
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(fakeFs.files.get(dbPath), newBytes);
});

test('swapInLocalDbWithRollback: rolls back to the pre-import DB when initLocalDb() throws on the new file', async () => {
  const dbPath = '/fake/userData/rmpg-local.db';
  const oldBytes = Buffer.from('OLD DB BYTES');
  const corruptBytes = Buffer.from('CORRUPT BYTES');
  const fakeFs = makeFakeFsModule({ [dbPath]: oldBytes });
  let initCalls = 0;
  let closeCalls = 0;

  const result = await swapInLocalDbWithRollback(corruptBytes, {
    dbPath,
    fsModule: fakeFs,
    closeLocalDb: () => { closeCalls++; },
    initLocalDb: () => {
      initCalls++;
      if (initCalls === 1) throw new Error('file is not a database');
    },
  });

  assert.deepEqual(result, { ok: false, error: 'file is not a database', rolledBack: true });
  assert.equal(initCalls, 2, 'initLocalDb() must be called again to reopen the restored DB');
  assert.equal(closeCalls, 2, 'closeLocalDb() must be re-called before the restore copy-back, in addition to the initial call at the top');
  assert.deepEqual(fakeFs.files.get(dbPath), oldBytes, 'dbPath content must be restored to the pre-import bytes');
});

test('swapInLocalDbWithRollback: aborts before the destructive write when the pre-write snapshot fails for a reason other than ENOENT', async () => {
  const dbPath = '/fake/userData/rmpg-local.db';
  const oldBytes = Buffer.from('OLD DB BYTES');
  const newBytes = Buffer.from('NEW DB BYTES');
  const fakeFs = makeFakeFsModule({ [dbPath]: oldBytes });
  fakeFs.promises.copyFile = async () => {
    const err = new Error('permission denied');
    err.code = 'EACCES';
    throw err;
  };
  let writeCalls = 0;
  const originalWriteFile = fakeFs.promises.writeFile;
  fakeFs.promises.writeFile = async (...args) => {
    writeCalls++;
    return originalWriteFile(...args);
  };

  const result = await swapInLocalDbWithRollback(newBytes, {
    dbPath,
    fsModule: fakeFs,
    closeLocalDb: () => {},
    initLocalDb: () => {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, false);
  assert.match(result.error, /snapshot/i, 'error must reference the snapshot failure, not a downstream one');
  assert.equal(writeCalls, 0, 'writeFile must never be called when the snapshot cannot be taken');
  assert.deepEqual(fakeFs.files.get(dbPath), oldBytes, 'dbPath content must be left completely untouched');
});

test('swapInLocalDbWithRollback: never throws even when the rollback restore itself fails', async () => {
  const dbPath = '/fake/userData/rmpg-local.db';
  const oldBytes = Buffer.from('OLD DB BYTES');
  const corruptBytes = Buffer.from('CORRUPT BYTES');
  const fakeFs = makeFakeFsModule({ [dbPath]: oldBytes });
  const originalCopyFile = fakeFs.promises.copyFile;
  let copyCalls = 0;
  fakeFs.promises.copyFile = async (src, dest) => {
    copyCalls++;
    if (copyCalls === 1) return originalCopyFile(src, dest); // initial snapshot: succeeds
    throw new Error('disk full'); // restore copy: fails
  };

  const result = await swapInLocalDbWithRollback(corruptBytes, {
    dbPath,
    fsModule: fakeFs,
    closeLocalDb: () => {},
    initLocalDb: () => { throw new Error('file is not a database'); },
  });

  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, false);
  assert.equal(result.error, 'file is not a database', 'error must reflect the original failure, not the restore failure');
});
