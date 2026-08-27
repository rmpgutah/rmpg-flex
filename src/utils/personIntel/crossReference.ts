// ============================================================
// Cross-reference capture engine
// ============================================================
// Aggregates the structured cross-refs emitted by the legal/criminal/skip
// adapters, dedupes them, and persists each into person_intel_cross_refs.
//
// Confidence model (cumulative, capped at 0.97):
//   name match (the adapter's lead) → base set by the source (0.34–0.55)
//   + DOB corroborated        → +0.20
//   + address corroborated    → +0.12
//   + phone corroborated      → +0.10
//   + email corroborated      → +0.08
// A name-only match never exceeds 0.55 — it is a LEAD, not a confirmation,
// and an officer must verify it via verification.ts before it can be acted on.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import type { CapturedCrossRef, CrossReference, RiskFlag, SourceResult } from './types';
import { execute, query } from '../db';
import { log } from '../logger';

/** A captured xref keyed by its unique (source, externalRef). */
interface XrefKey {
  source: string;
  externalRef: string;
}

function dedupe(captured: CapturedCrossRef[]): CapturedCrossRef[] {
  const seen = new Map<string, CapturedCrossRef>();
  for (const c of captured) {
    const key = `${c.source}|${c.externalRef}`;
    // Keep the highest-confidence emission; merge matched fields.
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, { ...c });
    } else {
      if (c.confidence > prev.confidence) prev.confidence = c.confidence;
      for (const f of c.matchedFields) {
        if (!prev.matchedFields.some(m => m.field === f.field && m.value === f.value)) {
          prev.matchedFields.push(f);
        }
      }
      for (const f of c.riskFlags) if (!prev.riskFlags.includes(f)) prev.riskFlags.push(f);
      if (c.isCriminal) prev.isCriminal = true;
      if (c.externalUrl && !prev.externalUrl) prev.externalUrl = c.externalUrl;
    }
  }
  return [...seen.values()];
}

export function collectCrossRefs(results: SourceResult[]): CapturedCrossRef[] {
  const all: CapturedCrossRef[] = [];
  for (const r of results) {
    if (r.crossRefs) all.push(...r.crossRefs);
  }
  return dedupe(all);
}

export function xrefRiskFlags(crossRefs: CapturedCrossRef[]): RiskFlag[] {
  const s = new Set<RiskFlag>();
  for (const c of crossRefs) for (const f of c.riskFlags) s.add(f);
  return [...s];
}

/**
 * Persist captured cross-refs for a dossier. Idempotent per
 * (dossier_id, source, external_ref): re-running a phase updates the label/
 * confidence/matched_fields rather than inserting duplicates.
 */
export async function persistCrossRefs(
  db: D1Database,
  dossierId: number,
  captured: CapturedCrossRef[],
  capturedBy?: number,
): Promise<number> {
  let written = 0;
  for (const c of captured) {
    try {
      await execute(
        db,
        `INSERT INTO person_intel_cross_refs
           (dossier_id, source, external_ref, external_url, label,
            matched_fields, confidence, is_criminal, risk_flags, meta_json, captured_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(dossier_id, source, external_ref) DO UPDATE SET
           external_url=excluded.external_url,
           label=excluded.label,
           matched_fields=excluded.matched_fields,
           confidence=excluded.confidence,
           is_criminal=excluded.is_criminal,
           risk_flags=excluded.risk_flags,
           meta_json=COALESCE(excluded.meta_json, meta_json)`,
        dossierId,
        c.source,
        c.externalRef,
        c.externalUrl ?? null,
        c.label,
        JSON.stringify(c.matchedFields),
        c.confidence,
        c.isCriminal ? 1 : 0,
        JSON.stringify(c.riskFlags),
        c.meta ? JSON.stringify(c.meta) : null,
        capturedBy ?? null,
      );
      written++;
    } catch (e) {
      // A missing table or unique index surfaces here — degrade, don't crash
      // the phase. The route asserts on the row, not just res.status.
      log.error('persistCrossRefs insert failed', { source: c.source, externalRef: c.externalRef },
        e instanceof Error ? e : new Error(String(e)));
    }
  }
  try {
    await execute(db, `UPDATE person_intelligence SET cross_refs_found=? WHERE id=?`, written, dossierId);
  } catch { /* best-effort counter; column reconciled at boot */ }
  return written;
}

export async function fetchCrossRefs(db: D1Database, dossierId: number): Promise<CrossReference[]> {
  const rows = await query<any>(
    db,
    `SELECT id, dossier_id, source, external_ref, external_url, label,
            matched_fields, confidence, is_criminal, risk_flags, meta_json,
            captured_at, captured_by
       FROM person_intel_cross_refs
       WHERE dossier_id=? ORDER BY is_criminal DESC, confidence DESC`,
    dossierId,
  ).catch(() => []);
  return rows.map((r: any) => ({
    id: r.id,
    dossierId: r.dossier_id,
    source: r.source,
    externalRef: r.external_ref,
    externalUrl: r.external_url ?? undefined,
    label: r.label,
    matchedFields: safeParse(r.matched_fields, []),
    confidence: r.confidence,
    isCriminal: !!r.is_criminal,
    riskFlags: safeParse(r.risk_flags, []),
    meta: safeParse<Record<string, unknown> | undefined>(r.meta_json, undefined),
    capturedAt: r.captured_at,
    capturedBy: r.captured_by ?? undefined,
  }));
}

export function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
