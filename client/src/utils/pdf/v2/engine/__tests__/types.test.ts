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

  it('FieldSpec switch narrows to correct shape', () => {
    const fields: FieldSpec<{ a: string; b: boolean }>[] = [
      { kind: 'labeled', label: 'A', accessor: d => d.a },
      { kind: 'checkbox', label: 'B', accessor: d => d.b },
    ];
    const kinds = fields.map(f => f.kind);
    expect(kinds).toEqual(['labeled', 'checkbox']);

    const labeled = fields[0];
    if (labeled.kind === 'labeled') {
      // width is only on LabeledField, so this line must compile cleanly
      expect(labeled.width).toBeUndefined();
    }
  });
});
