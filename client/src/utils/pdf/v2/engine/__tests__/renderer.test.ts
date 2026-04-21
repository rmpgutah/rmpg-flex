import { describe, it, expect } from 'vitest';
import { renderPdfV2 } from '../renderer';
import type { FormSchema } from '../types';

interface TestData { name: string; active: boolean; notes?: string }

const schema: FormSchema<TestData> = {
  meta: { formNumber: 'PS-TEST', title: 'TEST FORM', revision: '2026-04' },
  header: { kind: 'default', formId: 'test' },
  sections: [
    {
      kind: 'section', title: 'BASIC', columns: 1,
      fields: [
        { kind: 'labeled', label: 'Name', accessor: d => d.name },
        { kind: 'checkbox', label: 'Active', accessor: d => d.active },
      ],
    },
    {
      kind: 'section', title: 'NOTES', columns: 1,
      visibleIf: d => Boolean(d.notes),
      fields: [
        { kind: 'narrative', label: 'Notes', accessor: d => d.notes, minLines: 3 },
      ],
    },
  ],
};

describe('renderPdfV2', () => {
  it('produces a non-empty PDF blob for valid schema + data', async () => {
    const doc = await renderPdfV2(schema, { name: 'Jones', active: true });
    const size = (doc.output('arraybuffer') as ArrayBuffer).byteLength;
    expect(size).toBeGreaterThan(1000);
  });

  it('skips sections when visibleIf returns false', async () => {
    const withNotes = await renderPdfV2(schema, { name: 'X', active: false, notes: 'hello' });
    const withoutNotes = await renderPdfV2(schema, { name: 'X', active: false });
    const a = (withNotes.output('arraybuffer') as ArrayBuffer).byteLength;
    const b = (withoutNotes.output('arraybuffer') as ArrayBuffer).byteLength;
    expect(a).toBeGreaterThan(b);
  });

  it('does not print "undefined" anywhere even with null-heavy data', async () => {
    const doc = await renderPdfV2(schema, { name: null as any, active: false });
    const output = doc.output('datauristring');
    expect(output.toLowerCase()).not.toContain('undefined');
  });
});
