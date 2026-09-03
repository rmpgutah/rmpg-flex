// ============================================================
// RMPG Flex — Intel pattern detection + subject escalation (Wave 2)
// ============================================================
// Repeat-location and near-repeat clustering over calls_for_service,
// plus per-subject escalation scoring. Alerts flow through the existing
// anomaly_alerts table (dedup_key prevents repeats); escalation also
// renders on the person dossier. Pure helpers are unit-tested in
// tests/intelPatterns.test.ts.
// ============================================================

import { log } from './logger';
import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst, execute } from './db';
import { isRealValue, normalizeAddress } from './intelMatch';
import { parseD1TimestampMs } from './fleetio/sync';

// ── Escalation scoring (pure) ────────────────────────────────

export interface WeightedEvent { kind: string; date: string | null }
export interface Escalation { recent: number; baseline: number; ratio: number; trend: 'escalating' | 'active' | 'quiet' }

const KIND_WEIGHT: Record<string, number> = {
  field_interview: 1, call: 2, citation: 2, trespass_order: 3, arrest: 4, warrant: 5,
};

// Weighted activity in the last 30 days vs the monthly baseline over the
// prior 90 days. 'escalating' = ratio >= 2 with >= 3 recent events.
export function computeEscalation(events: WeightedEvent[]): Escalation {
  const now = Date.now();
  const d30 = now - 30 * 86400000;
  const d120 = now - 120 * 86400000;
  let recent = 0, recentCount = 0, prior = 0;
  for (const e of events) {
    if (!e.date) continue;
    // D1 timestamps are zone-less UTC; Date.parse would read them as local time.
    const t = parseD1TimestampMs(e.date);
    if (t == null) continue;
    const w = KIND_WEIGHT[e.kind] || 1;
    if (t >= d30) { recent += w; recentCount++; }
    else if (t >= d120) prior += w;
  }
  const baseline = prior / 3; // prior 90 days → per-month
  if (recentCount === 0) return { recent, baseline, ratio: 0, trend: 'quiet' };
  const ratio = baseline > 0 ? recent / baseline : (recentCount >= 3 ? 99 : 1);
  return { recent, baseline, ratio, trend: ratio >= 2 && recentCount >= 3 ? 'escalating' : 'active' };
}

// ── Proximity clustering (pure) ──────────────────────────────

export interface GeoEvent { id: number; lat: number; lng: number; type: string }
export interface GeoCluster { type: string; centroid: { lat: number; lng: number }; events: GeoEvent[] }

// Greedy box clustering per incident type: events within `box` degrees
// (~0.003° ≈ 330 m) of a cluster seed join it; clusters under minSize drop.
export function clusterByProximity(events: GeoEvent[], box: number, minSize: number): GeoCluster[] {
  const byType = new Map<string, GeoEvent[]>();
  for (const e of events) {
    if (!Number.isFinite(e.lat) || !Number.isFinite(e.lng)) continue;
    byType.set(e.type, [...(byType.get(e.type) || []), e]);
  }
  const clusters: GeoCluster[] = [];
  for (const [type, list] of byType) {
    const used = new Set<number>();
    for (const seed of list) {
      if (used.has(seed.id)) continue;
      const members = list.filter((e) => !used.has(e.id)
        && Math.abs(e.lat - seed.lat) <= box && Math.abs(e.lng - seed.lng) <= box);
      if (members.length < minSize) continue;
      members.forEach((m) => used.add(m.id));
      clusters.push({
        type,
        centroid: {
          lat: members.reduce((s, e) => s + e.lat, 0) / members.length,
          lng: members.reduce((s, e) => s + e.lng, 0) / members.length,
        },
        events: members,
      });
    }
  }
  return clusters;
}

// ── Alert plumbing ───────────────────────────────────────────

function isoWeek(): string {
  const d = new Date();
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d.getTime() - onejan.getTime()) / 86400000) + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}w${week}`;
}

async function raiseAlert(db: D1Database, dedupKey: string, severity: string, title: string, details: string): Promise<boolean> {
  try {
    const dup = await queryFirst<any>(db, 'SELECT id FROM anomaly_alerts WHERE dedup_key = ?', dedupKey);
    if (dup) return false;
    await execute(db,
      `INSERT INTO anomaly_alerts (alert_type, severity, title, details, dedup_key, created_at, updated_at)
       VALUES ('intel_pattern', ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      severity, title, details, dedupKey);
    return true;
  } catch (err: any) {
    log.error('[intel-pattern] raise failed', { error: err?.message });
    return false;
  }
}

// ── Detectors (DB-bound, cron-called) ────────────────────────

export async function detectRepeatLocations(db: D1Database): Promise<number> {
  let raised = 0;
  try {
    const rows = await query<any>(db,
      `SELECT location_address, call_number, incident_type, created_at FROM calls_for_service
       WHERE created_at > datetime('now','-35 days') AND location_address IS NOT NULL`);
    const byAddr = new Map<string, any[]>();
    for (const r of rows) {
      if (!isRealValue(r.location_address)) continue;
      const k = normalizeAddress(String(r.location_address));
      if (!k) continue;
      byAddr.set(k, [...(byAddr.get(k) || []), r]);
    }
    const d7 = Date.now() - 7 * 86400000;
    for (const [addr, calls] of byAddr) {
      const recent = calls.filter((c) => (parseD1TimestampMs(c.created_at) ?? 0) >= d7);
      if (recent.length < 3) continue;
      const priorWeekly = (calls.length - recent.length) / 4;
      if (recent.length < priorWeekly * 2) continue;
      if (await raiseAlert(db, `intel_pattern:addr:${addr}:${isoWeek()}`, 'warning',
        `REPEAT LOCATION: ${calls[0].location_address}`,
        `${recent.length} calls in 7 days (prior weekly avg ${priorWeekly.toFixed(1)}): ${recent.map((c: any) => `${c.call_number || 'CFS'} ${c.incident_type || ''}`.trim()).join('; ')}`))
        raised++;
    }
  } catch (err: any) { log.error('[intel-pattern] repeat-locations failed', { error: err?.message }); }
  return raised;
}

export async function detectNearRepeat(db: D1Database): Promise<number> {
  let raised = 0;
  try {
    const rows = await query<any>(db,
      `SELECT id, latitude AS lat, longitude AS lng, incident_type AS type FROM calls_for_service
       WHERE created_at > datetime('now','-14 days')
         AND latitude IS NOT NULL AND longitude IS NOT NULL AND incident_type IS NOT NULL`);
    const clusters = clusterByProximity(
      rows.map((r: any) => ({ id: r.id, lat: Number(r.lat), lng: Number(r.lng), type: String(r.type) })),
      0.003, 3);
    for (const c of clusters) {
      const key = `intel_pattern:nr:${c.type}:${c.centroid.lat.toFixed(3)}:${c.centroid.lng.toFixed(3)}`;
      if (await raiseAlert(db, key, 'warning',
        `NEAR-REPEAT PATTERN: ${c.type}`,
        `${c.events.length} "${c.type}" calls within ~330m in 14 days (centroid ${c.centroid.lat.toFixed(4)}, ${c.centroid.lng.toFixed(4)})`))
        raised++;
    }
  } catch (err: any) { log.error('[intel-pattern] near-repeat failed', { error: err?.message }); }
  return raised;
}

// Events for one person, suitable for computeEscalation. Shared by the
// sweep and the dossier endpoint.
export async function personActivityEvents(db: D1Database, personId: number): Promise<WeightedEvent[]> {
  const events: WeightedEvent[] = [];
  const pull = async (kind: string, sql: string, ...binds: unknown[]) => {
    try {
      for (const r of await query<any>(db, sql, ...binds)) events.push({ kind, date: r.d });
    } catch (err: any) { log.error('[intel-pattern] activity events failed', { kind, error: err?.message }); }
  };
  await pull('call', `SELECT c.created_at AS d FROM calls_for_service c JOIN call_persons cp ON cp.call_id = c.id WHERE cp.person_id = ? AND c.created_at > datetime('now','-120 days')`, personId);
  await pull('field_interview', `SELECT created_at AS d FROM field_interviews WHERE person_id = ? AND created_at > datetime('now','-120 days')`, personId);
  await pull('citation', `SELECT created_at AS d FROM citations WHERE person_id = ? AND created_at > datetime('now','-120 days')`, personId);
  await pull('trespass_order', `SELECT effective_date AS d FROM trespass_orders WHERE person_id = ? AND effective_date > datetime('now','-120 days')`, personId);
  await pull('warrant', `SELECT issued_date AS d FROM warrants WHERE subject_person_id = ? AND issued_date > datetime('now','-120 days')`, personId);
  return events;
}

export async function sweepEscalation(db: D1Database): Promise<number> {
  let raised = 0;
  try {
    // Persons with any recent linked activity (calls or FIs) — bounded.
    const ids = new Set<number>();
    for (const r of await query<any>(db,
      `SELECT DISTINCT cp.person_id AS pid FROM call_persons cp
       JOIN calls_for_service c ON c.id = cp.call_id
       WHERE c.created_at > datetime('now','-30 days') LIMIT 250`))
      if (r.pid) ids.add(r.pid);
    for (const r of await query<any>(db,
      `SELECT DISTINCT person_id AS pid FROM field_interviews
       WHERE created_at > datetime('now','-30 days') AND person_id IS NOT NULL LIMIT 250`))
      ids.add(r.pid);
    for (const pid of ids) {
      const esc = computeEscalation(await personActivityEvents(db, pid));
      if (esc.trend !== 'escalating') continue;
      const p = await queryFirst<any>(db, 'SELECT first_name, last_name FROM persons WHERE id = ?', pid);
      if (await raiseAlert(db, `intel_pattern:esc:${pid}:${isoWeek()}`, 'warning',
        `SUBJECT ESCALATING: ${p ? `${p.first_name} ${p.last_name}` : `person #${pid}`}`,
        `Weighted activity ${esc.recent} in 30 days vs monthly baseline ${esc.baseline.toFixed(1)} (${esc.ratio.toFixed(1)}x)`))
        raised++;
    }
  } catch (err: any) { log.error('[intel-pattern] escalation sweep failed', { error: err?.message }); }
  return raised;
}
