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
});
