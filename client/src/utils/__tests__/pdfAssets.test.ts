import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadLogoLightBase64, clearImageCache } from '../pdfAssets';

// jsdom does not implement OffscreenCanvas / createImageBitmap — stub
// minimal fakes so pdfAssets' loaders can run in the test environment.
// The fake canvas records the compositing calls made against it so the
// "produces a real white recolor" test can assert on actual behavior
// rather than just trusting the stub blindly returns a data URL.
class FakeOffscreenCanvasContext {
  calls: Array<{ op: string; args: unknown[] }> = [];
  globalCompositeOperation = 'source-over';
  fillStyle = '#000000';
  drawImage(...args: unknown[]) {
    this.calls.push({ op: 'drawImage', args });
  }
  fillRect(...args: unknown[]) {
    this.calls.push({ op: 'fillRect', args: [...args, this.fillStyle, this.globalCompositeOperation] });
  }
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  private ctx = new FakeOffscreenCanvasContext();
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext(_type: string) {
    return this.ctx;
  }
  async convertToBlob(_opts?: unknown) {
    return new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
  }
}

describe('loadLogoLightBase64', () => {
  beforeEach(() => {
    clearImageCache();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob([new Uint8Array([0, 0, 0, 0])], { type: 'image/png' }),
    })));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 4, height: 4, close: vi.fn(),
    })));
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas as unknown as typeof OffscreenCanvas);
  });

  it('returns a PNG data URL', async () => {
    const result = await loadLogoLightBase64();
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it('caches the result across calls (fetch only called once)', async () => {
    await loadLogoLightBase64();
    await loadLogoLightBase64();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns null when the fetch fails', async () => {
    clearImageCache();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const result = await loadLogoLightBase64();
    expect(result).toBeNull();
  });

  it('recolors via source-in compositing with white fill (produces a real white recolor, not a passthrough)', async () => {
    let capturedCtx: FakeOffscreenCanvasContext | null = null;
    class SpyOffscreenCanvas extends FakeOffscreenCanvas {
      getContext(type: string) {
        const ctx = super.getContext(type) as FakeOffscreenCanvasContext;
        capturedCtx = ctx;
        return ctx;
      }
    }
    vi.stubGlobal('OffscreenCanvas', SpyOffscreenCanvas as unknown as typeof OffscreenCanvas);

    await loadLogoLightBase64();

    expect(capturedCtx).not.toBeNull();
    const fillRectCall = capturedCtx!.calls.find((c) => c.op === 'fillRect');
    expect(fillRectCall).toBeDefined();
    // args: [x, y, w, h, fillStyle, compositeOp]
    expect(fillRectCall!.args[4]).toBe('#ffffff');
    expect(fillRectCall!.args[5]).toBe('source-in');
    // drawImage must happen before fillRect (establishes the alpha silhouette first)
    const drawIdx = capturedCtx!.calls.findIndex((c) => c.op === 'drawImage');
    const fillIdx = capturedCtx!.calls.findIndex((c) => c.op === 'fillRect');
    expect(drawIdx).toBeGreaterThanOrEqual(0);
    expect(drawIdx).toBeLessThan(fillIdx);
  });
});
