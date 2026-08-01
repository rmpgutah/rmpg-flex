import type { jsPDF } from 'jspdf';

export type Criticality =
  | 'court-legal'
  | 'evidence-custody'
  | 'use-of-force'
  | 'dispatch-patrol'
  | 'client-facing'
  | 'internal-reference';

export const BATCH_ORDER: readonly Criticality[] = [
  'court-legal',
  'evidence-custody',
  'use-of-force',
  'dispatch-patrol',
  'client-facing',
  'internal-reference',
] as const;

export type FixtureVariant = 'typical' | 'empty' | 'maximal';

export const REQUIRED_VARIANTS: readonly FixtureVariant[] = ['typical', 'empty', 'maximal'] as const;

export interface PdfFixture<T = unknown> {
  variant: FixtureVariant;
  /** Short human description shown in the gallery's fixture picker. */
  label: string;
  input: T;
}

export interface PdfRegistryEntry<T = unknown> {
  /** Stable kebab-case id; used in screenshot filenames and the catalogue. */
  id: string;
  label: string;
  criticality: Criticality;
  /** Repo-relative path of the generator, for the defect catalogue. */
  module: string;
  generate: (input: T) => jsPDF | Promise<jsPDF>;
  fixtures: PdfFixture<T>[];
}

export function validateRegistry(entries: PdfRegistryEntry[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const e of entries) {
    if (seen.has(e.id)) problems.push(`duplicate id: ${e.id}`);
    seen.add(e.id);

    if (!BATCH_ORDER.includes(e.criticality)) {
      problems.push(`${e.id}: unknown criticality "${e.criticality}"`);
    }

    const present = new Set(e.fixtures.map((f) => f.variant));
    const missing = REQUIRED_VARIANTS.filter((v) => !present.has(v));
    if (missing.length > 0) {
      problems.push(`${e.id}: missing fixture variant(s): ${missing.join(', ')}`);
    }
  }

  return problems;
}
