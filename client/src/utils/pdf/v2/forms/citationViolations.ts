import type { LayoutEngine } from '../engine/layout';
import type { Primitives } from '../engine/primitives';
import type { CitationViolation } from './citation';

export type ViolationLayout = 'compact' | 'stacked';

export function selectViolationLayout(violations: CitationViolation[]): ViolationLayout {
  return violations.length >= 4 ? 'stacked' : 'compact';
}

export function totalFine(violations: CitationViolation[]): number {
  return violations.reduce(
    (sum, v) => sum + (Number.isFinite(v.fine_amount) ? v.fine_amount : 0),
    0,
  );
}

const fmtFine = (n: number): string => `$${n.toFixed(2)}`;

/**
 * Render the entire VIOLATIONS block — header + body + total-fine line —
 * at the current layout cursor. Auto-picks compact-table (≤3) or stacked-
 * per-violation (4+) layout. Self-contained: caller must NOT also draw a
 * "VIOLATIONS" section header.
 *
 * No-op when violations is empty (caller handles back-compat fallback to
 * flat single-violation fields).
 */
export function renderViolations(
  prims: Primitives,
  _layout: LayoutEngine,
  violations: CitationViolation[],
): void {
  if (violations.length === 0) return;
  const mode = selectViolationLayout(violations);
  if (mode === 'compact') renderCompact(prims, violations);
  else renderStacked(prims, violations);
  // Total-fine line shared by both layouts.
  prims.spacer(1);
  prims.labeledField(
    {
      kind: 'labeled',
      label: 'TOTAL FINE',
      accessor: () => fmtFine(totalFine(violations)),
      editable: false,
    },
    undefined as unknown as never,
  );
}

function renderCompact(prims: Primitives, violations: CitationViolation[]): void {
  prims.table(
    {
      kind: 'table',
      label: 'VIOLATIONS',
      columns: [
        { key: 'statute_citation', header: 'STATUTE',     width: 'half' },
        { key: 'description',      header: 'DESCRIPTION', width: 'full' },
        { key: 'level_short',      header: 'LVL',         width: 'quarter' },
        { key: 'fine_fmt',         header: 'FINE',        width: 'quarter' },
      ],
      accessor: () => violations.map((v) => ({
        statute_citation: v.statute_citation,
        description: v.description,
        level_short: v.offense_level.slice(0, 3).toUpperCase(),
        fine_fmt: fmtFine(v.fine_amount),
      })),
      editable: false,
    },
    undefined as unknown as never,
  );
}

function renderStacked(prims: Primitives, violations: CitationViolation[]): void {
  prims.labeledField(
    { kind: 'labeled', label: 'VIOLATIONS', accessor: () => '', editable: false },
    undefined as unknown as never,
  );
  violations.forEach((v, i) => {
    prims.spacer(1);
    prims.labeledField(
      {
        kind: 'labeled',
        label: `VIOLATION ${i + 1} — STATUTE`,
        accessor: () => v.statute_citation,
        editable: false,
      },
      undefined as unknown as never,
    );
    prims.labeledField(
      {
        kind: 'labeled',
        label: 'OFFENSE LEVEL',
        accessor: () => v.offense_level,
        editable: false,
      },
      undefined as unknown as never,
    );
    prims.labeledField(
      {
        kind: 'labeled',
        label: 'DESCRIPTION',
        accessor: () => v.description,
        editable: false,
      },
      undefined as unknown as never,
    );
    prims.labeledField(
      {
        kind: 'labeled',
        label: 'FINE',
        accessor: () => fmtFine(v.fine_amount),
        editable: false,
      },
      undefined as unknown as never,
    );
  });
}
