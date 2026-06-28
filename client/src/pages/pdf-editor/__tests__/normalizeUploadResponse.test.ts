import { describe, it, expect } from 'vitest';
import { normalizeUploadResponse } from '../uploadResponse';

// Regression coverage for the "Upload did not return file" bug: the /api/uploads
// Worker route returns a BARE ARRAY of attachment rows, but several call sites
// historically expected a `{ files: [...] }` envelope. normalizeUploadResponse
// must accept every shape we've ever emitted.
describe('normalizeUploadResponse', () => {
  it('reads the canonical bare array', () => {
    const out = normalizeUploadResponse([
      { file_id: 'abc', original_name: 'doc.pdf' },
    ]);
    expect(out).toEqual([{ file_id: 'abc', original_name: 'doc.pdf' }]);
  });

  it('reads the legacy { files: [...] } envelope', () => {
    const out = normalizeUploadResponse({ files: [{ file_id: 'x', original_name: 'y.pdf' }] });
    expect(out[0].file_id).toBe('x');
  });

  it('reads a single { file: {...} } record', () => {
    const out = normalizeUploadResponse({ file: { file_id: 'one' } });
    expect(out).toHaveLength(1);
    expect(out[0].file_id).toBe('one');
    expect(out[0].original_name).toBe('document.pdf'); // default
  });

  it('reads a bare single record', () => {
    const out = normalizeUploadResponse({ fileId: 'z', name: 'z.pdf' });
    expect(out[0].file_id).toBe('z');
    expect(out[0].original_name).toBe('z.pdf');
  });

  it('reads the { uploaded: [...] } alias', () => {
    const out = normalizeUploadResponse({ uploaded: [{ id: '42' }] });
    expect(out[0].file_id).toBe('42');
  });

  it('drops rows without an id and returns [] for junk', () => {
    expect(normalizeUploadResponse([{ original_name: 'no-id.pdf' }])).toEqual([]);
    expect(normalizeUploadResponse(null)).toEqual([]);
    expect(normalizeUploadResponse('nope')).toEqual([]);
    expect(normalizeUploadResponse({})).toEqual([]);
  });
});
