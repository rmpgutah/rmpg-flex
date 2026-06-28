import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../recordPdfGenerator', () => ({
  downloadRecordPdf: vi.fn(async () => 'v1'),
}));

import { downloadPdf, _resetFacadeCacheForTest, _setFlagsForTest, invalidateFlagsCache } from '../facade';

// Single-engine facade: v1 is the only active path. The flag-based test
// hooks remain as no-op shims for backward compat with callers that still
// import them; calling them must not change routing.
describe('pdf facade — single engine (v1 only)', () => {
  beforeEach(() => { _resetFacadeCacheForTest(); });

  it('routes every form to v1 regardless of flag value', async () => {
    _setFlagsForTest({ warrant: true, citation: true, incident: true });
    const a = await downloadPdf('warrant', { id: 1 }, 'a.pdf');
    const b = await downloadPdf('citation', { id: 2 }, 'b.pdf');
    const c = await downloadPdf('incident', { id: 3 }, 'c.pdf');
    expect(a).toBe('v1');
    expect(b).toBe('v1');
    expect(c).toBe('v1');
  });

  it('compat shims (invalidateFlagsCache, _setFlagsForTest, _resetFacadeCacheForTest) are no-ops and do not throw', () => {
    expect(() => invalidateFlagsCache()).not.toThrow();
    expect(() => _setFlagsForTest({ anything: true })).not.toThrow();
    expect(() => _resetFacadeCacheForTest()).not.toThrow();
  });
});
