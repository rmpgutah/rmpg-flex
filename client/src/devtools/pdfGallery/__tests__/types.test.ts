import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import { validateRegistry, BATCH_ORDER, createEntry, type PdfRegistryEntry } from '../types';

function entry(over: Partial<PdfRegistryEntry> = {}): PdfRegistryEntry {
  return {
    id: 'trespass-order',
    label: 'Trespass Order',
    criticality: 'court-legal',
    module: 'client/src/utils/trespassOrderPdf.ts',
    generate: () => new jsPDF(),
    fixtures: [
      { variant: 'typical', label: 'Standard order', input: {} },
      { variant: 'empty', label: 'All optional fields absent', input: {} },
      { variant: 'maximal', label: 'Long narrative, 40 rows', input: {} },
    ],
    ...over,
  } as PdfRegistryEntry;
}

describe('BATCH_ORDER', () => {
  it('lists the six batches in spec order', () => {
    expect(BATCH_ORDER).toEqual([
      'court-legal',
      'evidence-custody',
      'use-of-force',
      'dispatch-patrol',
      'client-facing',
      'internal-reference',
    ]);
  });
});

describe('validateRegistry', () => {
  it('accepts a well-formed entry', () => {
    expect(validateRegistry([entry()])).toEqual([]);
  });

  it('rejects duplicate ids', () => {
    const problems = validateRegistry([entry(), entry()]);
    expect(problems.join(' ')).toMatch(/duplicate id.*trespass-order/i);
  });

  it('requires all three fixture variants', () => {
    const problems = validateRegistry([
      entry({ fixtures: [{ variant: 'typical', label: 'Only one', input: {} }] }),
    ]);
    expect(problems.join(' ')).toMatch(/missing fixture variant.*empty.*maximal/is);
  });

  it('rejects an unknown criticality', () => {
    const problems = validateRegistry([entry({ criticality: 'nonsense' as never })]);
    expect(problems.join(' ')).toMatch(/unknown criticality.*nonsense/i);
  });

  it('reports every problem rather than only the first', () => {
    const problems = validateRegistry([
      entry({ id: 'a', fixtures: [] }),
      entry({ id: 'b', criticality: 'nope' as never }),
    ]);
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });
});

describe('createEntry', () => {
  it('preserves runtime values unchanged', () => {
    const original: PdfRegistryEntry<{ name: string }> = {
      id: 'test-doc',
      label: 'Test Document',
      criticality: 'internal-reference',
      module: 'client/src/utils/testPdf.ts',
      generate: () => new jsPDF(),
      fixtures: [
        { variant: 'typical', label: 'Typical', input: { name: 'Alice' } },
        { variant: 'empty', label: 'Empty', input: { name: '' } },
        { variant: 'maximal', label: 'Maximal', input: { name: 'VeryLongName' } },
      ],
    };

    const created = createEntry(original);

    expect(created.id).toBe(original.id);
    expect(created.label).toBe(original.label);
    expect(created.criticality).toBe(original.criticality);
    expect(created.module).toBe(original.module);
    expect(created.fixtures).toBe(original.fixtures);
    expect(created.generate).toBe(original.generate);
  });

  it('enables heterogeneous arrays without casts via type widening', () => {
    // Different fixture input types
    interface TrespassInput {
      subjectName: string;
    }
    interface InvoiceInput {
      invoiceNumber: number;
      total: number;
    }

    const trespassEntry = createEntry<TrespassInput>({
      id: 'trespass-order',
      label: 'Trespass Order',
      criticality: 'court-legal',
      module: 'client/src/utils/trespassOrderPdf.ts',
      generate: (input) => new jsPDF(),
      fixtures: [
        { variant: 'typical', label: 'Standard', input: { subjectName: 'John Doe' } },
        { variant: 'empty', label: 'Empty', input: { subjectName: '' } },
        { variant: 'maximal', label: 'Long name', input: { subjectName: 'VeryLongName' } },
      ],
    });

    const invoiceEntry = createEntry<InvoiceInput>({
      id: 'invoice',
      label: 'Invoice',
      criticality: 'client-facing',
      module: 'client/src/utils/invoicePdf.ts',
      generate: (input) => new jsPDF(),
      fixtures: [
        { variant: 'typical', label: 'Standard', input: { invoiceNumber: 1001, total: 150 } },
        { variant: 'empty', label: 'Empty', input: { invoiceNumber: 0, total: 0 } },
        { variant: 'maximal', label: 'Large', input: { invoiceNumber: 9999, total: 99999 } },
      ],
    });

    // Without createEntry, this array assignment would require casts on each entry.
    // With createEntry, both entries pass type checking without casts.
    const registry: PdfRegistryEntry[] = [trespassEntry, invoiceEntry];

    expect(registry).toHaveLength(2);
    expect(registry[0].id).toBe('trespass-order');
    expect(registry[1].id).toBe('invoice');
  });

  it('works with validateRegistry on createEntry results', () => {
    const entry1 = createEntry<{ data: string }>({
      id: 'doc-1',
      label: 'Document 1',
      criticality: 'dispatch-patrol',
      module: 'client/src/utils/doc1.ts',
      generate: () => new jsPDF(),
      fixtures: [
        { variant: 'typical', label: 'T', input: { data: 'test' } },
        { variant: 'empty', label: 'E', input: { data: '' } },
        { variant: 'maximal', label: 'M', input: { data: 'x'.repeat(1000) } },
      ],
    });

    const entry2 = createEntry<{ count: number }>({
      id: 'doc-2',
      label: 'Document 2',
      criticality: 'evidence-custody',
      module: 'client/src/utils/doc2.ts',
      generate: () => new jsPDF(),
      fixtures: [
        { variant: 'typical', label: 'T', input: { count: 5 } },
        { variant: 'empty', label: 'E', input: { count: 0 } },
        { variant: 'maximal', label: 'M', input: { count: 999 } },
      ],
    });

    const problems = validateRegistry([entry1, entry2]);
    expect(problems).toEqual([]);
  });
});
