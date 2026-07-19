import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiUploadFiles } from '../useApi';

// Audio side effects (AudioContext) don't exist in jsdom — stub the chime.
vi.mock('../../utils/actionChimes', () => ({ chimeForApiSuccess: () => {} }));

// Regression coverage for the silent ID-image upload drop (2026-06-13):
// a same-origin `POST /api/uploads` died at the edge with `net::ERR_FAILED`
// and the caller got exactly ONE attempt (FormData bodies were forced to
// `retries = 0`). apiUploadFiles must now AUTO-RETRY transient transport/5xx
// failures, while still failing fast on deterministic 4xx client errors.

const file = () => new File(['x'], 'id.jpg', { type: 'image/jpeg' });
const okResponse = () =>
  new Response(JSON.stringify([{ file_id: 'abc', original_name: 'id.jpg' }]), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
const errResponse = (status: number, body: unknown = { error: 'nope' }) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('apiUploadFiles auto-retry', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('rmpg_token', 'test-token');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('retries a transient network failure, then succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(okResponse());

    const onRetry = vi.fn();
    const out = await apiUploadFiles([file()], 'person_id_image', undefined, {
      retries: 3,
      retryDelayMs: 0,
      onRetry,
    });

    expect(out).toEqual([{ file_id: 'abc', original_name: 'id.jpg' }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a deterministic 4xx (e.g. file too large)', async () => {
    fetchMock.mockResolvedValue(errResponse(400, { error: 'File too large' }));

    await expect(
      apiUploadFiles([file()], 'person_id_image', undefined, { retries: 3, retryDelayMs: 0 }),
    ).rejects.toThrow(/File too large/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries 5xx server blips', async () => {
    fetchMock.mockResolvedValueOnce(errResponse(503)).mockResolvedValueOnce(okResponse());

    const out = await apiUploadFiles([file()], 'person_id_image', undefined, {
      retries: 2,
      retryDelayMs: 0,
    });
    expect(out[0].file_id).toBe('abc');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting retries and throws the last error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      apiUploadFiles([file()], 'person_id_image', undefined, { retries: 2, retryDelayMs: 0 }),
    ).rejects.toThrow(/Failed to fetch/);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('defaults to a single attempt (backward compatible) when no retries requested', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(apiUploadFiles([file()], 'company_document')).rejects.toThrow(/Failed to fetch/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('routes a file over the direct-upload threshold through presign, not /api/uploads', async () => {
    const bigFile = new File(['x'.repeat(21 * 1024 * 1024)], 'big.mp4', { type: 'video/mp4' });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        file_id: 'big-1', upload_url: 'https://acct.r2.cloudflarestorage.com/bucket/key', key: 'attachments/big-1.mp4',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ file_id: 'big-1', original_name: 'big.mp4' }), {
        status: 201, headers: { 'Content-Type': 'application/json' },
      }));

    const putSpy = vi.spyOn(await import('../../utils/uploadWithProgress'), 'putFileDirect').mockResolvedValue(undefined);
    const out = await apiUploadFiles([bigFile]);

    expect(out).toEqual([{ file_id: 'big-1', original_name: 'big.mp4' }]);
    expect(fetchMock.mock.calls.every(([u]) => !String(u).endsWith('/api/uploads') || String(u).includes('presign'))).toBe(true);
    putSpy.mockRestore();
  });

  it('preserves file order when uploading mixed-size files [small, large, small]', async () => {
    const small1 = new File(['x'], 'small1.jpg', { type: 'image/jpeg' });
    const large = new File(['x'.repeat(21 * 1024 * 1024)], 'large.mp4', { type: 'video/mp4' });
    const small2 = new File(['x'], 'small2.jpg', { type: 'image/jpeg' });

    // Mock multipart POST /api/uploads to return results for both small files in order
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { file_id: 'small1-id', original_name: 'small1.jpg' },
        { file_id: 'small2-id', original_name: 'small2.jpg' },
      ]), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      // Presign for large file
      .mockResolvedValueOnce(new Response(JSON.stringify({
        file_id: 'large-id', upload_url: 'https://acct.r2.cloudflarestorage.com/bucket/key', key: 'attachments/large-id.mp4',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      // Complete presign for large file
      .mockResolvedValueOnce(new Response(JSON.stringify({ file_id: 'large-id', original_name: 'large.mp4' }), {
        status: 201, headers: { 'Content-Type': 'application/json' },
      }));

    const putSpy = vi.spyOn(await import('../../utils/uploadWithProgress'), 'putFileDirect').mockResolvedValue(undefined);

    const out = await apiUploadFiles([small1, large, small2]);

    // Verify results are in the SAME order as input files: [small1, large, small2]
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ file_id: 'small1-id', original_name: 'small1.jpg' });
    expect(out[1]).toEqual({ file_id: 'large-id', original_name: 'large.mp4' });
    expect(out[2]).toEqual({ file_id: 'small2-id', original_name: 'small2.jpg' });

    putSpy.mockRestore();
  });
});
