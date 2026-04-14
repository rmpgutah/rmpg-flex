import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../recordPdfGenerator', () => ({
  downloadRecordPdf: vi.fn(async () => 'v1'),
}));

const downloadPdfV2Mock = vi.fn<(...args: any[]) => Promise<string>>(async () => 'v2');
vi.mock('../v2', () => ({
  downloadPdfV2: (...args: any[]) => downloadPdfV2Mock(...args),
}));

vi.mock('../v2/forms', () => ({
  getV2Schema: (t: string) => ({ meta: { formNumber: t, title: 'T', revision: 'R' }, header: { kind: 'default', formId: t }, sections: [] }),
}));

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));

import { downloadPdf, _resetFacadeCacheForTest, _setFlagsForTest } from '../facade';

describe('pdf facade', () => {
  beforeEach(() => { _resetFacadeCacheForTest(); downloadPdfV2Mock.mockClear(); });

  it('uses v1 path when flag is false', async () => {
    _setFlagsForTest({ warrant: false });
    const r = await downloadPdf('warrant', { id: 1 }, 'x.pdf');
    expect(r).toBe('v1');
  });

  it('uses v2 path when flag is true', async () => {
    _setFlagsForTest({ warrant: true });
    const r = await downloadPdf('warrant', { id: 1 }, 'x.pdf');
    expect(r).toBe('v2');
  });

  it('falls back to v1 if v2 throws', async () => {
    _setFlagsForTest({ warrant: true });
    downloadPdfV2Mock.mockRejectedValueOnce(new Error('schema exploded'));
    const r = await downloadPdf('warrant', { id: 1 }, 'x.pdf');
    expect(r).toBe('v1');
  });
});
