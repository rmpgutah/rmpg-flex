// Route-level smoke test (Miniflare/workerd) for the gated Tesseract-primary
// OCR leg in src/routes/serveIntake.ts (ocrImageWithTesseractGate). Regression
// guard for the plan's Global Constraint: the flag defaults OFF, and with it
// off, POST /api/serve-intake/scan-document must NEVER reach the Tesseract
// container — it must fall straight through to the existing
// Claude-vision -> Workers-AI-vision chain (ocrImage), exactly like before
// this leg existed.
//
// getContainer (@cloudflare/containers) is module-mocked so we can assert,
// by direct call-count, that the container was never touched — the container
// binding itself isn't runnable under Miniflare. No real case data — a
// synthetic 1x1 PNG only.
import { env } from 'cloudflare:test';
import { describe, it, expect, vi } from 'vitest';

const { getContainerMock } = vi.hoisted(() => ({
  getContainerMock: vi.fn(() => ({
    fetch: vi.fn(async () => {
      throw new Error('Tesseract container must not be reached when tesseract_ocr_primary is OFF');
    }),
  })),
}));

vi.mock('@cloudflare/containers', () => ({
  getContainer: getContainerMock,
}));

import app from './entry';

// Minimal valid PNG (1x1 transparent pixel) — enough to satisfy isImage()/File
// plumbing; the vision model call itself fails fast in this env (no AI/Claude
// key configured) and the handler degrades to an empty extraction, which is
// fine — this test only cares whether the Tesseract container leg fired.
const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe('Tesseract OCR gate — default OFF', () => {
  it('flag OFF (default, KV has no feature_flags row) never calls the Tesseract container', async () => {
    getContainerMock.mockClear();

    const fd = new FormData();
    fd.append('image', new Blob([PNG_1X1], { type: 'image/png' }), 'input.png');

    const res = await app.request(
      '/api/serve-intake/scan-document',
      { method: 'POST', body: fd },
      env as unknown as Record<string, unknown>,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { ocrEngine: string; model: string };

    // The regression guard: with the flag off, the container is never touched.
    expect(getContainerMock).not.toHaveBeenCalled();
    // And the response never carries the tesseract+<model> label this leg
    // would stamp if it HAD run.
    expect(body.model.startsWith('tesseract+')).toBe(false);
    expect(['claude-vision', 'workers-ai-vision']).toContain(body.ocrEngine);
  });

  it('flag explicitly OFF in KV also never calls the Tesseract container', async () => {
    getContainerMock.mockClear();
    await (env as unknown as { KV: KVNamespace }).KV.put(
      'feature_flags',
      JSON.stringify({ tesseract_ocr_primary: false }),
    );

    const fd = new FormData();
    fd.append('image', new Blob([PNG_1X1], { type: 'image/png' }), 'input.png');

    const res = await app.request(
      '/api/serve-intake/scan-document',
      { method: 'POST', body: fd },
      env as unknown as Record<string, unknown>,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { model: string };
    expect(getContainerMock).not.toHaveBeenCalled();
    expect(body.model.startsWith('tesseract+')).toBe(false);
  });
});
