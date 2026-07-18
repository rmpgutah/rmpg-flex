import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { putFileDirect } from '../uploadWithProgress';

class FakeXHR {
  static instances: FakeXHR[] = [];
  method = '';
  url = '';
  status = 0;
  upload: { onprogress: ((e: any) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  headers: Record<string, string> = {};
  body: any = null;

  open(method: string, url: string) { this.method = method; this.url = url; FakeXHR.instances.push(this); }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body: any) { this.body = body; }
  abort() { this.onabort?.(); }
}

describe('putFileDirect', () => {
  beforeEach(() => {
    FakeXHR.instances.length = 0;
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('PUTs the raw file with a Content-Type header and no Authorization header', async () => {
    const file = new File(['hello'], 'a.txt', { type: 'text/plain' });
    const promise = putFileDirect('https://example.r2.cloudflarestorage.com/bucket/key?sig=abc', file);
    const xhr = FakeXHR.instances[0];
    xhr.status = 200;
    xhr.onload?.();
    await expect(promise).resolves.toBeUndefined();
    expect(xhr.method).toBe('PUT');
    expect(xhr.headers['Content-Type']).toBe('text/plain');
    expect(xhr.headers['Authorization']).toBeUndefined();
    expect(xhr.body).toBe(file);
  });

  it('rejects on a non-2xx status', async () => {
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    const promise = putFileDirect('https://x', file);
    const xhr = FakeXHR.instances[0];
    xhr.status = 500;
    xhr.onload?.();
    await expect(promise).rejects.toThrow(/500/);
  });

  it('reports progress with phase "uploading"', async () => {
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    const onProgress = vi.fn();
    const promise = putFileDirect('https://x', file, onProgress);
    const xhr = FakeXHR.instances[0];
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'uploading', percent: 50 }));
    xhr.status = 200;
    xhr.onload?.();
    await promise;
  });

  it('rejects with AbortError on network error', async () => {
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    const promise = putFileDirect('https://x', file);
    const xhr = FakeXHR.instances[0];
    xhr.onerror?.();
    await expect(promise).rejects.toThrow(/Network error/);
  });
});
