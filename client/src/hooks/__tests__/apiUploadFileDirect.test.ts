import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiUploadFileDirect } from '../useApi';
import * as uploadWithProgress from '../../utils/uploadWithProgress';

vi.mock('../../utils/actionChimes', () => ({ chimeForApiSuccess: () => {}, nackForApiFailure: () => {} }));

const file = () => new File(['x'.repeat(30 * 1024 * 1024)], 'clip.mp4', { type: 'video/mp4' });

describe('apiUploadFileDirect', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let putSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('rmpg_token', 'test-token');
    putSpy = vi.spyOn(uploadWithProgress, 'putFileDirect').mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    putSpy.mockRestore();
  });

  it('presigns, PUTs directly, then completes — in that order', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        file_id: 'abc-123', upload_url: 'https://acct.r2.cloudflarestorage.com/bucket/key', key: 'attachments/abc-123.mp4',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ file_id: 'abc-123', original_name: 'clip.mp4' }), {
        status: 201, headers: { 'Content-Type': 'application/json' },
      }));

    const result = await apiUploadFileDirect(file(), 'bodycam_video', 42);

    expect(result).toEqual({ file_id: 'abc-123', original_name: 'clip.mp4' });
    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/uploads/presign'), expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/uploads/presign/abc-123/complete'), expect.objectContaining({ method: 'POST' }));
    expect(putSpy).toHaveBeenCalledWith('https://acct.r2.cloudflarestorage.com/bucket/key', expect.any(File), undefined);
  });

  it('propagates a PUT failure without calling complete', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      file_id: 'abc-123', upload_url: 'https://acct.r2.cloudflarestorage.com/bucket/key', key: 'attachments/abc-123.mp4',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    putSpy.mockRejectedValueOnce(new Error('Direct upload failed with status 500'));

    await expect(apiUploadFileDirect(file())).rejects.toThrow(/Direct upload failed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
