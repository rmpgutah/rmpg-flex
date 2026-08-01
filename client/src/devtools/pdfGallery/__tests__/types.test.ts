import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import { validateRegistry, BATCH_ORDER, type PdfRegistryEntry } from '../types';

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
