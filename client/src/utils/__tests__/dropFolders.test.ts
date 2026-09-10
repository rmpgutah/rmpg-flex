import { describe, it, expect } from 'vitest';
import { extractFolderGroups } from '../dropFolders';

// ─── Helpers to mock the FileSystemEntry API ───────────────────────────────

function makeFile(name: string, type = 'application/pdf', size = 100): File {
  return new File(['x'.repeat(size)], name, { type });
}

function fileEntry(file: File): object {
  return {
    isFile: true,
    isDirectory: false,
    name: file.name,
    file: (cb: (f: File) => void, _err?: () => void) => cb(file),
  };
}

function dirEntry(name: string, children: object[]): object {
  let done = false;
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (cb: (batch: object[]) => void, _err?: () => void) => {
        if (!done) { done = true; cb(children); }
        else cb([]);
      },
    }),
  };
}

function makeDataTransferWithEntries(entries: object[]): DataTransfer {
  const items = entries.map((entry, i) => ({
    kind: 'file',
    webkitGetAsEntry: () => entry,
    // getAsFile falls back to DataTransfer.files[i] — not needed for dir entries
    getAsFile: () => null,
  }));
  return {
    items,
    files: [],
  } as unknown as DataTransfer;
}

function makeDataTransferFilesOnly(files: File[]): DataTransfer {
  return {
    items: [],
    files,
  } as unknown as DataTransfer;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('extractFolderGroups', () => {
  it('returns a single loose-files group for top-level file entries', async () => {
    const f1 = makeFile('summons.pdf');
    const f2 = makeFile('notice.pdf');
    const dt = makeDataTransferWithEntries([fileEntry(f1), fileEntry(f2)]);
    // Patch getAsFile to return the file
    (dt.items[0] as any).getAsFile = () => f1;
    (dt.items[1] as any).getAsFile = () => f2;

    const groups = await extractFolderGroups(dt);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('(loose files)');
    expect(groups[0].files).toHaveLength(2);
  });

  it('creates one group per top-level folder', async () => {
    const fa = makeFile('a.pdf');
    const fb = makeFile('b.pdf');
    const dirA = dirEntry('Job-A', [fileEntry(fa)]);
    const dirB = dirEntry('Job-B', [fileEntry(fb)]);
    const dt = makeDataTransferWithEntries([dirA, dirB]);

    const groups = await extractFolderGroups(dt);
    expect(groups).toHaveLength(2);
    expect(groups[0].name).toBe('Job-A');
    expect(groups[0].files).toEqual([fa]);
    expect(groups[1].name).toBe('Job-B');
    expect(groups[1].files).toEqual([fb]);
  });

  it('mixes folders and loose files: loose files come first', async () => {
    const loose = makeFile('lone.pdf');
    const nested = makeFile('nested.pdf');
    const dir = dirEntry('Folder', [fileEntry(nested)]);

    const dt = makeDataTransferWithEntries([fileEntry(loose), dir]);
    (dt.items[0] as any).getAsFile = () => loose;

    const groups = await extractFolderGroups(dt);
    // loose-files group is unshifted to the front
    expect(groups[0].name).toBe('(loose files)');
    expect(groups[0].files).toEqual([loose]);
    expect(groups[1].name).toBe('Folder');
    expect(groups[1].files).toEqual([nested]);
  });

  it('applies the accept filter and excludes non-matching files', async () => {
    const pdf = makeFile('doc.pdf', 'application/pdf');
    const jpg = makeFile('photo.jpg', 'image/jpeg');
    const txt = makeFile('notes.txt', 'text/plain');

    const dt = makeDataTransferWithEntries([fileEntry(pdf), fileEntry(jpg), fileEntry(txt)]);
    (dt.items[0] as any).getAsFile = () => pdf;
    (dt.items[1] as any).getAsFile = () => jpg;
    (dt.items[2] as any).getAsFile = () => txt;

    const isPdfOrImage = (f: File) => f.type === 'application/pdf' || f.type.startsWith('image/');
    const groups = await extractFolderGroups(dt, isPdfOrImage);
    expect(groups).toHaveLength(1);
    expect(groups[0].files).toHaveLength(2);
    expect(groups[0].files.map((f) => f.name)).toEqual(['doc.pdf', 'photo.jpg']);
  });

  it('falls back to DataTransfer.files when webkitGetAsEntry is unavailable', async () => {
    const f1 = makeFile('a.pdf');
    const f2 = makeFile('b.pdf');
    const dt = makeDataTransferFilesOnly([f1, f2]);

    const groups = await extractFolderGroups(dt);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('(loose files)');
    expect(groups[0].files).toHaveLength(2);
  });

  it('returns empty array when nothing is dropped', async () => {
    const dt = makeDataTransferFilesOnly([]);
    const groups = await extractFolderGroups(dt);
    expect(groups).toHaveLength(0);
  });

  it('omits a folder group when the folder contains no accepted files', async () => {
    const txt = makeFile('readme.txt', 'text/plain');
    const dir = dirEntry('JunkFolder', [fileEntry(txt)]);
    const dt = makeDataTransferWithEntries([dir]);

    const pdfOnly = (f: File) => f.type === 'application/pdf';
    const groups = await extractFolderGroups(dt, pdfOnly);
    expect(groups).toHaveLength(0);
  });
});
