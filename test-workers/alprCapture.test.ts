// Route-level smoke test (Miniflare/workerd) for POST /api/alpr/capture.
// Regression guard for the false-confidence bug (#1278/#1283): a capture whose
// vision read self-reports confidence 1.0 must be PERSISTED as DERIVED trust
// (< the 0.85 accept gate) and NOT auto-accepted. The vision read + plate
// screening are module-mocked so the path touches only the self-provisioning
// alpr_captures table; the trust math + storage are exercised for real.
import { env } from 'cloudflare:test';
import { describe, it, expect, vi } from 'vitest';

// Vision model returns a (fabricated) 1.0 self-report — exactly the bug input.
vi.mock('../src/utils/cloudflarePlate', () => ({
  readPlateCloudflare: async () => ({
    plate: '6KJ345', state: 'UT', make: null, model: null, color: null, year: null,
    plateType: null, bodyStyle: null, condition: null, damageSummary: null,
    confidence: 1.0, model_id: 'mock-vision', ms: 1,
  }),
}));
// No hotlist/watchlist tables in the test DB — keep screening a no-op so the
// capture path stays on alpr_captures only.
vi.mock('../src/utils/intelScreen', () => ({
  screenVehicle: async () => ({ hits: [], vehicleId: null }),
}));

import app from './entry';

describe('POST /api/alpr/capture — persists derived trust, not the model self-report', () => {
  it('a self-reported 1.0 is stored as derived trust < 0.85 and not accepted', async () => {
    const fd = new FormData();
    fd.append('image', new Blob([new Uint8Array([255, 216, 255, 0])], { type: 'image/jpeg' }), 'capture.jpg');

    const res = await app.request('/api/alpr/capture', { method: 'POST', body: fd }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { plate_confidence: number | null; accepted: boolean | null };

    // The response never echoes the fabricated 1.0.
    expect(body.plate_confidence).not.toBe(1);
    expect(body.plate_confidence!).toBeLessThan(0.85);
    expect(body.accepted).toBeFalsy();

    // And the PERSISTED row agrees: both confidence columns hold derived trust,
    // the row is held for review, and accepted is 0.
    const row = await env.DB
      .prepare('SELECT confidence, plate_confidence, accepted, review_status FROM alpr_captures ORDER BY id DESC LIMIT 1')
      .first() as { confidence: number; plate_confidence: number; accepted: number; review_status: string } | null;
    expect(row).not.toBeNull();
    expect(row!.plate_confidence).toBeLessThan(0.85);
    expect(row!.plate_confidence).not.toBe(1);
    expect(row!.confidence).toBeLessThan(0.85);
    expect(row!.accepted).toBe(0);
    expect(row!.review_status).toBe('needs_review');
  });
});
