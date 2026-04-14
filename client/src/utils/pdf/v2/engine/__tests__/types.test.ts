import { describe, it, expect } from 'vitest';
import type { FormSchema, SchemaSection, RenderCallback, FieldSpec } from '../types';

describe('v2 engine types', () => {
  it('FormSchema has meta, header, sections, optional footer', () => {
    const schema: FormSchema<{ name: string }> = {
      meta: { formNumber: 'PS-TEST', title: 'TEST', revision: 'R1' },
      header: { kind: 'default', formId: 'test' },
      sections: [],
    };
    expect(schema.meta.formNumber).toBe('PS-TEST');
  });

  it('SchemaSection and RenderCallback are both valid Section kinds', () => {
    const schemaSec: SchemaSection<{ x: number }> = {
      kind: 'section',
      title: 'S',
      fields: [],
    };
    const callback: RenderCallback<{ x: number }> = (_ctx, d) => {
      void d.x;
    };
    expect(schemaSec.kind).toBe('section');
    expect(typeof callback).toBe('function');
  });

  it('FieldSpec discriminates on kind', () => {
    const f: FieldSpec<{ a: string }> = { kind: 'labeled', label: 'A', accessor: d => d.a };
    expect(f.kind).toBe('labeled');
  });
});
