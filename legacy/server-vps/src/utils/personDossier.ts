// ============================================================
// RMPG Flex — Person Dossier Aggregator
//
// Builds a print-ready aggregation for a person across every
// junction table: warrants, trespass orders, arrests, incidents,
// calls, citations, field interviews. Designed for the dossier
// PDF appendix renderer, but the JSON shape is also useful for
// dashboards and prosecutor-handoff exports.
//
// Each section is { count, rows[], summary fields } so the
// renderer can branch on emptiness without iterating every row.
// Sections are independently try/catch'd because some tables
// (warrants, trespass_orders) live behind addCol migrations and
// might not exist on legacy DBs.
// ============================================================

import type Database from 'better-sqlite3';

export interface PersonDossierSection<TRow> {
  count: number;
  rows: TRow[];
}

export interface PersonDossier {
  person: any;
  warrants: PersonDossierSection<any> & { activeCount: number };
  trespassOrders: PersonDossierSection<any> & { activeCount: number };
  arrests: PersonDossierSection<any> & { mostRecent: string | null };
  incidents: PersonDossierSection<any>;
  calls: PersonDossierSection<any>;
  citations: PersonDossierSection<any> & { unpaidCount: number };
  fieldInterviews: PersonDossierSection<any>;
  summary: {
    riskLevel: 'high' | 'elevated' | 'standard';
    activeWarrants: number;
    activeTrespasses: number;
    totalContacts: number;
  };
}

// Per-section row cap to keep the PDF a bounded size — 25 rows
// per section is enough for a typical dossier without paginating
// the appendix into a small book. The full count is preserved
// in the section header so the operator knows there are more.
const ROW_CAP = 25;

export function buildPersonDossier(
  db: Database.Database,
  personId: number,
): PersonDossier | null {
  const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(personId) as any;
  if (!person) return null;

  // ── Warrants ──────────────────────────────────────────
  const warrants = safeQuery(() =>
    db.prepare(`
      SELECT id, warrant_number, type, status, charge_description,
             offense_level, statute_citation, bail_amount,
             issuing_court, created_at AS date_issued, expires_at
      FROM warrants
      WHERE subject_person_id = ?
      ORDER BY
        CASE WHEN status = 'active' THEN 0 ELSE 1 END,
        created_at DESC
      LIMIT ?
    `).all(personId, ROW_CAP),
  );
  const warrantsTotal = safeCount(() =>
    db.prepare('SELECT COUNT(*) as c FROM warrants WHERE subject_person_id = ?').get(personId),
  );
  const activeWarrants = warrants.filter(w => w.status === 'active').length;

  // ── Trespass Orders ───────────────────────────────────
  const trespassOrders = safeQuery(() =>
    db.prepare(`
      SELECT id, order_number, status, order_type, location, property_name,
             effective_date, expiration_date, served_at, reason
      FROM trespass_orders
      WHERE person_id = ?
      ORDER BY
        CASE WHEN status = 'active' THEN 0 ELSE 1 END,
        created_at DESC
      LIMIT ?
    `).all(personId, ROW_CAP),
  );
  const trespassTotal = safeCount(() =>
    db.prepare('SELECT COUNT(*) as c FROM trespass_orders WHERE person_id = ?').get(personId),
  );
  const activeTrespasses = trespassOrders.filter(t => t.status === 'active').length;

  // ── Arrests (via arrest_cross_links → arrest_records) ─
  const arrests = safeQuery(() =>
    db.prepare(`
      SELECT ar.id, ar.full_name, ar.booking_date, ar.charges,
             ar.county, ar.status, ar.mugshot_url
      FROM arrest_cross_links acl
      JOIN arrest_records ar ON acl.arrest_record_id = ar.id
      WHERE acl.linked_type = 'person' AND acl.linked_id = ?
      ORDER BY ar.booking_date DESC
      LIMIT ?
    `).all(personId, ROW_CAP),
  );
  const arrestsTotal = safeCount(() =>
    db.prepare(`
      SELECT COUNT(*) as c
      FROM arrest_cross_links
      WHERE linked_type = 'person' AND linked_id = ?
    `).get(personId),
  );
  const mostRecentArrest = arrests.length > 0 ? arrests[0].booking_date : null;

  // ── Incidents (via incident_persons) ──────────────────
  const incidents = safeQuery(() =>
    db.prepare(`
      SELECT i.id, i.incident_number, i.incident_type, i.status, i.priority,
             i.narrative AS description, i.created_at, ip.role
      FROM incident_persons ip
      JOIN incidents i ON ip.incident_id = i.id
      WHERE ip.person_id = ?
      ORDER BY i.created_at DESC
      LIMIT ?
    `).all(personId, ROW_CAP),
  );
  const incidentsTotal = safeCount(() =>
    db.prepare(`
      SELECT COUNT(*) as c FROM incident_persons WHERE person_id = ?
    `).get(personId),
  );

  // ── Calls (via incident_persons → incidents → calls_for_service) ─
  const calls = safeQuery(() =>
    db.prepare(`
      SELECT DISTINCT c.id, c.call_number, c.incident_type, c.priority,
             c.status, c.location_address AS location, c.created_at
      FROM incident_persons ip
      JOIN incidents i ON ip.incident_id = i.id
      JOIN calls_for_service c ON i.call_id = c.id
      WHERE ip.person_id = ? AND i.call_id IS NOT NULL
      ORDER BY c.created_at DESC
      LIMIT ?
    `).all(personId, ROW_CAP),
  );
  const callsTotal = safeCount(() =>
    db.prepare(`
      SELECT COUNT(DISTINCT c.id) as c
      FROM incident_persons ip
      JOIN incidents i ON ip.incident_id = i.id
      JOIN calls_for_service c ON i.call_id = c.id
      WHERE ip.person_id = ? AND i.call_id IS NOT NULL
    `).get(personId),
  );

  // ── Citations ─────────────────────────────────────────
  const citations = safeQuery(() =>
    db.prepare(`
      SELECT id, citation_number, type, status, statute_citation,
             violation_description, offense_level, fine_amount,
             violation_date, court_date
      FROM citations
      WHERE person_id = ?
      ORDER BY violation_date DESC
      LIMIT ?
    `).all(personId, ROW_CAP),
  );
  const citationsTotal = safeCount(() =>
    db.prepare('SELECT COUNT(*) as c FROM citations WHERE person_id = ?').get(personId),
  );
  const unpaidCitations = citations.filter(
    c => c.status === 'issued' || c.status === 'contested',
  ).length;

  // ── Field Interviews ──────────────────────────────────
  const fieldInterviews = safeQuery(() =>
    db.prepare(`
      SELECT id, fi_number, location, contact_reason, contact_type,
             action_taken, officer_name, created_at, status
      FROM field_interviews
      WHERE person_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(personId, ROW_CAP),
  );
  const fieldInterviewsTotal = safeCount(() =>
    db.prepare('SELECT COUNT(*) as c FROM field_interviews WHERE person_id = ?').get(personId),
  );

  // ── Risk classification ───────────────────────────────
  // - HIGH: any active warrant
  // - ELEVATED: active trespass, recent arrest (<180d), or 3+ incidents
  // - STANDARD: otherwise
  let riskLevel: 'high' | 'elevated' | 'standard' = 'standard';
  if (activeWarrants > 0) {
    riskLevel = 'high';
  } else if (
    activeTrespasses > 0
    || (mostRecentArrest && daysSince(mostRecentArrest) <= 180)
    || incidentsTotal >= 3
  ) {
    riskLevel = 'elevated';
  }

  return {
    person,
    warrants: { count: warrantsTotal, rows: warrants, activeCount: activeWarrants },
    trespassOrders: { count: trespassTotal, rows: trespassOrders, activeCount: activeTrespasses },
    arrests: { count: arrestsTotal, rows: arrests, mostRecent: mostRecentArrest },
    incidents: { count: incidentsTotal, rows: incidents },
    calls: { count: callsTotal, rows: calls },
    citations: { count: citationsTotal, rows: citations, unpaidCount: unpaidCitations },
    fieldInterviews: { count: fieldInterviewsTotal, rows: fieldInterviews },
    summary: {
      riskLevel,
      activeWarrants,
      activeTrespasses,
      totalContacts: incidentsTotal + callsTotal + fieldInterviewsTotal,
    },
  };
}

// Tables behind addCol migrations sometimes don't exist on
// legacy DBs — swallow the SQLite error and return [] / 0
// rather than failing the whole dossier.
//
// Rows come back as `any[]` because better-sqlite3 returns
// `unknown[]` from `.all()` and we don't have schema-typed
// row interfaces here; downstream filters use field-level
// access that's stable per the SELECT projection.
function safeQuery(fn: () => unknown[]): any[] {
  try { return fn() as any[]; } catch { return []; }
}

function safeCount(fn: () => unknown): number {
  try {
    const row = fn() as { c?: number } | undefined;
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

function daysSince(isoDate: string | null | undefined): number {
  if (!isoDate) return Infinity;
  const t = Date.parse(isoDate);
  if (!isFinite(t)) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}
