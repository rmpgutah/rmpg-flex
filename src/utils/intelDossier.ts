// ============================================================
// RMPG Flex — Person Dossier pure helpers
// ============================================================
// Timeline merging + associate ranking for /api/intel/dossier/person/:id.
// Pure functions (no D1/Hono) — covered by tests/intelDossier.test.ts.
// ============================================================

export interface TimelineEvent {
  kind: string;            // call | incident | citation | field_interview | trespass_order | warrant | arrest
  id: number;
  date: string | null;     // ISO-ish; null sorts last
  title: string;
  subtitle: string;
  status: string;
  source_person_id?: number; // set when the event came from a cluster member, not the subject
}

// Merge per-source event arrays into one date-desc stream. Null/empty
// dates sort last so undated rows never bury recent activity.
export function mergeTimeline(sources: TimelineEvent[][]): TimelineEvent[] {
  return sources.flat().sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });
}

// ── Screening hits ───────────────────────────────────────────────────────────

export interface ScreeningHitRow {
  id: number;
  source_key: string;
  display_name: string;
  summary: string | null;
  reviewed_at: string | null;
}

// Map confirmed screening_hits rows (already filtered to status='confirmed' AND
// is_active=1 by the caller) to TimelineEvent entries. Pure — no DB access.
export function screeningHitsToTimeline(hits: ScreeningHitRow[]): TimelineEvent[] {
  return hits.map((h) => ({
    kind: 'screening_hit',
    id: h.id,
    date: h.reviewed_at ?? null,
    title: `Screening match: ${h.source_key}`,
    subtitle: h.summary ?? '',
    status: 'confirmed',
  }));
}

export interface CoOccurrence { person_id: number; name: string; kind: string }
export interface Associate { person_id: number; name: string; shared_events: number; kinds: string[] }

// Rank co-occurring persons by shared-event count. `exclude` removes the
// subject and their confirmed cluster members (an alias is not an associate).
export function rankAssociates(rows: CoOccurrence[], exclude: Set<number>, limit: number): Associate[] {
  const byPerson = new Map<number, Associate>();
  for (const r of rows) {
    if (exclude.has(r.person_id)) continue;
    const e = byPerson.get(r.person_id) || { person_id: r.person_id, name: r.name, shared_events: 0, kinds: [] };
    e.shared_events++;
    if (!e.kinds.includes(r.kind)) e.kinds.push(r.kind);
    byPerson.set(r.person_id, e);
  }
  return [...byPerson.values()]
    .sort((a, b) => b.shared_events - a.shared_events)
    .slice(0, limit);
}
