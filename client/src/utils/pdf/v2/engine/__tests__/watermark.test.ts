import { describe, it, expect } from 'vitest';
import { renderPdfV2 } from '../renderer';
import type { FormSchema } from '../types';

const baseSchema = (watermark: 'blank-form' | 'draft' | undefined): FormSchema<{}> => ({
  meta: { formNumber: 'TEST', title: 'TEST', revision: '2026-05' },
  header: { kind: 'default', formId: 'test' },
  watermark,
  sections: [],
});

describe('watermark variants', () => {
  it('blank-form mode produces different bytes than no watermark', async () => {
    const noWm = (await renderPdfV2(baseSchema(undefined), {})).output('arraybuffer');
    const blank = (await renderPdfV2(baseSchema('blank-form'), {})).output('arraybuffer');
    expect(blank.byteLength).toBeGreaterThan(noWm.byteLength);
  });
  it('draft mode produces different bytes than blank-form', async () => {
    const blank = (await renderPdfV2(baseSchema('blank-form'), {})).output('arraybuffer');
    const draft = (await renderPdfV2(baseSchema('draft'), {})).output('arraybuffer');
    expect(draft.byteLength).not.toBe(blank.byteLength);
  });
});
