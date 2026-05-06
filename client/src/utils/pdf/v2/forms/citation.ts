// ============================================================
// citation — populated v2 schema (mirrors citationBlank.ts)
// ============================================================
// Each labeled field carries a `path` matching the citations
// table column name. The sidecar embed walks the schema and
// captures `{path: accessor(data)}` for every field whose `path`
// is set, so extraction returns a system-keyed bag (not a
// label-keyed bag — labels can be reworded without breaking
// extraction). Fields without `path` are display-only (e.g.
// computed totals, signatures rendered from images).
//
// Keep section titles, column counts, and field order identical
// to citationBlank.ts so the printed forms look the same — the
// blank is just this schema with empty accessors.

import type { FormSchema, LabeledField, NarrativeField, SignatureField } from '../engine/types';

export interface CitationData {
  citation_number?: string | null;
  type?: string | null;
  status?: string | null;
  violation_date?: string | null;
  violation_time?: string | null;
  offense_level?: string | null;
  location?: string | null;
  person_name?: string | null;
  person_dob?: string | null;
  person_dl?: string | null;
  person_address?: string | null;
  vehicle_plate?: string | null;
  vehicle_state?: string | null;
  vehicle_description?: string | null;
  statute_citation?: string | null;
  fine_amount?: number | null;
  violation_description?: string | null;
  court_date?: string | null;
  court_name?: string | null;
  court_address?: string | null;
  notes?: string | null;
  issuing_officer_name?: string | null;
  badge_number?: string | null;
  signature_image?: string | null;
  signature_date?: string | null;
}

const str = (v: unknown): string => (v == null ? '' : String(v));
const fineFmt = (v: number | null | undefined): string =>
  v == null ? '' : `$${Number(v).toFixed(2)}`;

function lf(
  label: string,
  path: keyof CitationData,
  fmt: (d: CitationData) => string = (d) => str(d[path]),
): LabeledField<CitationData> {
  return { kind: 'labeled', label, accessor: fmt, path: path as string, editable: true };
}

const notesField: NarrativeField<CitationData> = {
  kind: 'narrative',
  label: 'Notes',
  accessor: (d) => d.notes ?? '',
  minLines: 12,
  editable: true,
  path: 'notes',
};

const officerSignature: SignatureField<CitationData> = {
  kind: 'signature',
  label: 'Issuing Officer',
  accessor: (d) => ({
    image: d.signature_image ?? undefined,
    printedName: d.issuing_officer_name ?? '',
    date: d.signature_date ?? d.violation_date ?? '',
  }),
  editable: false,
};

const subjectSignature: SignatureField<CitationData> = {
  kind: 'signature',
  label: 'Subject Acknowledgment',
  accessor: () => undefined,
  editable: false,
};

export const citationSchema: FormSchema<CitationData> = {
  meta: {
    formNumber: 'PS-209',
    title: 'CITATION',
    revision: '2026-04',
  },
  header: {
    kind: 'default',
    formId: 'citation',
    caseNumberAccessor: (d) => d.citation_number ?? undefined,
  },
  sections: [
    {
      kind: 'section', title: 'CITATION INFORMATION', columns: 3,
      fields: [
        lf('Citation Number', 'citation_number'),
        lf('Type', 'type'),
        lf('Status', 'status'),
      ],
    },
    {
      kind: 'section', title: 'TIMING & LEVEL', columns: 3,
      fields: [
        lf('Violation Date', 'violation_date'),
        lf('Violation Time', 'violation_time'),
        lf('Offense Level', 'offense_level'),
      ],
    },
    {
      kind: 'section', title: 'LOCATION', columns: 1,
      fields: [lf('Location', 'location')],
    },
    {
      kind: 'section', title: 'SUBJECT', columns: 3,
      fields: [
        lf('Full Name', 'person_name'),
        lf('Date of Birth', 'person_dob'),
        lf('DL Number', 'person_dl'),
      ],
    },
    {
      kind: 'section', title: 'SUBJECT ADDRESS', columns: 1,
      fields: [lf('Address', 'person_address')],
    },
    {
      kind: 'section', title: 'VEHICLE INFORMATION', columns: 3,
      fields: [
        lf('License Plate', 'vehicle_plate'),
        lf('State', 'vehicle_state'),
        lf('Vehicle Description', 'vehicle_description'),
      ],
    },
    {
      kind: 'section', title: 'VIOLATION DETAILS', columns: 2,
      fields: [
        lf('Statute / Code', 'statute_citation'),
        lf('Fine Amount', 'fine_amount', (d) => fineFmt(d.fine_amount ?? null)),
      ],
    },
    {
      kind: 'section', title: 'VIOLATION DESCRIPTION', columns: 1,
      fields: [lf('Violation Description', 'violation_description')],
    },
    {
      kind: 'section', title: 'COURT', columns: 2,
      fields: [
        lf('Court Date', 'court_date'),
        lf('Court Name', 'court_name'),
      ],
    },
    {
      kind: 'section', title: 'COURT ADDRESS', columns: 1,
      fields: [lf('Court Address', 'court_address')],
    },
    {
      kind: 'section', title: 'NOTES', columns: 1,
      fields: [notesField],
    },
    {
      kind: 'section', title: 'SIGNATURES', columns: 1,
      fields: [officerSignature, subjectSignature],
    },
  ],
};

/**
 * Extract the canonical data bag from a CitationData input. Keys
 * match the schema's `path` annotations — this is the shape that
 * gets sidecar-embedded AND the shape extraction returns. Round-
 * trip parity = re-render(extractSidecar(pdf).data) produces the
 * same canonical bytes.
 */
export function citationCanonicalData(d: CitationData): Record<string, unknown> {
  const bag: Record<string, unknown> = {};
  for (const section of citationSchema.sections) {
    if (typeof section === 'function') continue;
    for (const f of section.fields) {
      if ('path' in f && f.path) {
        // Use the raw accessor for narrative + labeled; signatures
        // are display-only (no path), already excluded.
        if (f.kind === 'labeled' || f.kind === 'narrative') {
          bag[f.path] = (f.accessor as (d: CitationData) => unknown)(d);
        }
      }
    }
  }
  return bag;
}
