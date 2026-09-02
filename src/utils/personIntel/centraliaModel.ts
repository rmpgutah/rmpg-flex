// ============================================================
// centralia model — court-PDF opinion extractor (freelawproject/centralia)
// ============================================================
// freelawproject/centralia is a Python package: "a PDF plus a court id in,
// a typed document out." It recovers opinion structure (caption, syllabus,
// majority/concurrence/dissent, footnotes, page numbers) from a court PDF
// that labels none of it, across 241 court layouts.
//
// Cloudflare Workers cannot run the Python extractor (lxml + native PDF
// parsing). centralia ships a Pyodide build that runs client-side, and a
// sidecar could expose it over HTTP. This module is the typed CONTRACT for
// that output so an extracted opinion — however produced — lands in one
// stable shape the dossier can store, search, and display.
//
// Reference: https://github.com/freelawproject/centralia
// ============================================================

import type { CentraliaResult } from './types';

/** Build a `pending` skeleton the caller persists while extraction runs elsewhere. */
export function pendingCentraliaResult(courtId: string, docketNumber?: string): CentraliaResult {
  return {
    status: 'pending',
    court_id: courtId,
    cluster: { docket_number: docketNumber },
    opinions: [],
    warnings: ['centralia extractor not available on Workers; pending client/sidecar extraction'],
  };
}

const VALID_STATUSES = new Set(['valid', 'review', 'scanned', 'failed', 'pending']);

/**
 * Normalize an arbitrary JSON object (from a client-side Pyodide run, a
 * sidecar, or an imported blob) into the centralia shape. Defensive: every
 * field is optional in upstream output, so missing keys degrade to undefined
 * rather than throwing. Returns status 'failed' for unrecognizable input.
 */
export function normalizeCentraliaResult(raw: unknown, courtId?: string): CentraliaResult {
  if (!raw || typeof raw !== 'object') {
    return { status: 'failed', court_id: courtId || '', cluster: {}, opinions: [], warnings: ['unrecognized extractor output'] };
  }
  const o = raw as Record<string, any>;
  const status: CentraliaResult['status'] =
    typeof o.status === 'string' && VALID_STATUSES.has(o.status) ? (o.status as CentraliaResult['status']) : 'valid';
  const clusterRaw = (o.cluster && typeof o.cluster === 'object') ? o.cluster : {};
  const cluster: CentraliaResult['cluster'] = {
    citation: str(clusterRaw.citation),
    docket_number: str(clusterRaw.docket_number),
    case_name: str(clusterRaw.case_name),
    date_filed: str(clusterRaw.date_filed),
    date_filed_iso: clusterRaw.date_filed_iso == null ? null : str(clusterRaw.date_filed_iso),
    panel: Array.isArray(clusterRaw.panel)
      ? (clusterRaw.panel as unknown[]).map(str).filter((x): x is string => !!x)
      : undefined,
    parties: Array.isArray(clusterRaw.parties)
      ? (clusterRaw.parties as unknown[]).map(str).filter((x): x is string => !!x)
      : undefined,
  };
  const opinions = Array.isArray(o.opinions)
    ? o.opinions.map((op: any) => ({
        author: str(op?.author),
        type: str(op?.type),
        pages: str(op?.pages),
        html: str(op?.html),
        text: str(op?.text),
      }))
    : [];
  return {
    status,
    court_id: str(o.court_id) || courtId || '',
    cluster,
    opinions,
    headmatter: o.headmatter && typeof o.headmatter === 'object' ? o.headmatter : undefined,
    endmatter: o.endmatter && typeof o.endmatter === 'object' ? o.endmatter : undefined,
    sections: o.sections && typeof o.sections === 'object' ? o.sections : undefined,
    removed: Array.isArray(o.removed) ? o.removed : undefined,
    warnings: Array.isArray(o.warnings) ? (o.warnings as unknown[]).map(str).filter((x): x is string => !!x) : undefined,
    diagnostics: o.diagnostics && typeof o.diagnostics === 'object' ? o.diagnostics : undefined,
    html: str(o.html),
    casebody: str(o.casebody),
    versions: o.versions && typeof o.versions === 'object' ? o.versions : undefined,
  };
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = typeof v === 'string' ? v : String(v);
  return s.length ? s : undefined;
}

/**
 * Extract `legal` data points from a centralia opinion result so it folds
 * into the dossier's fused data set (docket number, case name, court, date,
 * authors). Pure function — safe to unit-test without D1.
 */
export function centraliaToDataPoints(
  r: CentraliaResult,
  source = 'centralia',
): { category: 'legal' | 'online'; field: string; value: string; source: string }[] {
  const pts: { category: 'legal' | 'online'; field: string; value: string; source: string }[] = [];
  if (r.cluster.case_name) pts.push({ category: 'legal', field: 'case_name', value: r.cluster.case_name, source });
  if (r.cluster.docket_number) pts.push({ category: 'legal', field: 'docket_number', value: r.cluster.docket_number, source });
  if (r.cluster.citation) pts.push({ category: 'legal', field: 'citation', value: r.cluster.citation, source });
  if (r.cluster.date_filed) pts.push({ category: 'legal', field: 'date_filed', value: r.cluster.date_filed, source });
  if (r.court_id) pts.push({ category: 'legal', field: 'court_id', value: r.court_id, source });
  for (const op of r.opinions) {
    if (op.author) pts.push({ category: 'legal', field: 'opinion_author', value: op.author, source });
  }
  return pts;
}
