// stampOverlay unit test — canvas 2D is not implemented in jsdom, so we feed
// a recording mock context and assert the draw sequence: band rect, text
// calls, watermark placement bottom-right above the band with alpha < 1.
import { describe, it, expect } from 'vitest';
import { stampOverlay } from '../FieldCameraPage';

function mockCtx() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const alphaAtDraw: number[] = [];
  const ctx: any = {
    globalAlpha: 1,
    fillStyle: '',
    font: '',
    textBaseline: '',
    fillRect: (...args: unknown[]) => calls.push({ op: 'fillRect', args }),
    fillText: (...args: unknown[]) => calls.push({ op: 'fillText', args }),
    measureText: (s: string) => ({ width: s.length * 7 }),
    drawImage: function (...args: unknown[]) {
      alphaAtDraw.push(this.globalAlpha);
      calls.push({ op: 'drawImage', args });
    },
  };
  return { ctx, calls, alphaAtDraw };
}

const W = 1920; const H = 1080;

describe('stampOverlay', () => {
  it('draws the bottom data band across the full width', () => {
    const { ctx, calls } = mockCtx();
    stampOverlay(ctx, W, H, { timestamp: 'T', officer: 'O', unit: null, gps: null, logo: null });
    const band = calls.find(c => c.op === 'fillRect');
    expect(band).toBeTruthy();
    const [x, y, w, h] = band!.args as number[];
    expect(x).toBe(0);
    expect(w).toBe(W);
    expect(y + h).toBe(H); // band hugs the bottom edge
    expect(h).toBeGreaterThanOrEqual(34);
  });

  it('writes officer/timestamp on the left and GPS on the right when a fix exists', () => {
    const { ctx, calls } = mockCtx();
    stampOverlay(ctx, W, H, {
      timestamp: '2026-06-09 14:00:00 MT', officer: 'Zamora', unit: 'D19',
      gps: { lat: 40.76, lng: -111.89, accuracy: 8 }, logo: null,
    });
    const texts = calls.filter(c => c.op === 'fillText');
    expect(texts.length).toBe(2);
    expect(String(texts[0].args[0])).toContain('Zamora');
    expect(String(texts[0].args[0])).toContain('D19');
    expect(String(texts[1].args[0])).toContain('40.76');
    // GPS text x-position must be right-of-center
    expect(texts[1].args[1] as number).toBeGreaterThan(W / 2);
  });

  it('omits the GPS text without a fix and the watermark without a logo', () => {
    const { ctx, calls } = mockCtx();
    stampOverlay(ctx, W, H, { timestamp: 'T', officer: 'O', unit: null, gps: null, logo: null });
    expect(calls.filter(c => c.op === 'fillText').length).toBe(1);
    expect(calls.filter(c => c.op === 'drawImage').length).toBe(0);
  });

  it('draws the watermark translucent, in the bottom-right corner, above the band', () => {
    const { ctx, calls, alphaAtDraw } = mockCtx();
    const logo = { naturalWidth: 400, naturalHeight: 200 } as HTMLImageElement;
    stampOverlay(ctx, W, H, { timestamp: 'T', officer: 'O', unit: null, gps: null, logo });
    const draw = calls.find(c => c.op === 'drawImage');
    expect(draw).toBeTruthy();
    const [, x, y, w, h] = draw!.args as [unknown, number, number, number, number];
    // Bottom-right: right edge near canvas right, bottom edge above the band.
    expect(x + w).toBeLessThanOrEqual(W);
    expect(x + w).toBeGreaterThan(W * 0.8);
    const bandH = Math.max(34, Math.round(H * 0.045));
    expect(y + h).toBeLessThanOrEqual(H - bandH);
    // Translucent at draw time, restored afterwards.
    expect(alphaAtDraw[0]).toBeLessThan(1);
    expect(ctx.globalAlpha).toBe(1);
    // Aspect ratio preserved (2:1 logo).
    expect(Math.abs(w / h - 2)).toBeLessThan(0.05);
  });
});
