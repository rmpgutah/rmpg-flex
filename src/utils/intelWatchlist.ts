// ============================================================
// RMPG Flex — Intel watchlist sweep (Palantir Phase 4)
// ============================================================
// Runs in the per-minute cron. For each active watch, finds activity
// linked to the watched entity created AFTER last_alert_at (new calls,
// field interviews, citations) and inserts a HIGH-priority row into the
// existing notifications table for the watcher — surfaces in the
// notifications inbox/bell with no new delivery plumbing.
//
// Each watch is try/catch-isolated; the sweep can never throw out of
// the cron. last_alert_at only advances when hits were found (or stays
// fresh on no-hit to bound the scan window via COALESCE in queries).
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query, execute } from './db';

interface WatchRow {
  id: number; entity_type: string; entity_id: number;
  reason: string | null; added_by: number; last_alert_at: string | null;
}

interface Hit { kind: string; label: string }

async function hitsForPerson(db: D1Database, personId: number, since: string): Promise<Hit[]> {
  const hits: Hit[] = [];
  try {
    for (const r of await query<any>(db,
      `SELECT c.call_number, c.incident_type FROM calls_for_service c
       JOIN call_persons cp ON cp.call_id = c.id
       WHERE cp.person_id = ? AND c.created_at > ? LIMIT 5`, personId, since))
      hits.push({ kind: 'call', label: `${r.call_number || 'CFS'} ${r.incident_type || ''}`.trim() });
  } catch (err: any) { console.error('[watchlist] person calls failed:', err?.message); }
  try {
    for (const r of await query<any>(db,
      `SELECT fi_number, contact_reason FROM field_interviews
       WHERE person_id = ? AND created_at > ? LIMIT 5`, personId, since))
      hits.push({ kind: 'field interview', label: `${r.fi_number || 'FI'} ${r.contact_reason || ''}`.trim() });
  } catch (err: any) { console.error('[watchlist] person FIs failed:', err?.message); }
  try {
    for (const r of await query<any>(db,
      `SELECT citation_number FROM citations
       WHERE person_id = ? AND created_at > ? LIMIT 5`, personId, since))
      hits.push({ kind: 'citation', label: r.citation_number || 'Citation' });
  } catch (err: any) { console.error('[watchlist] person citations failed:', err?.message); }
  return hits;
}

async function hitsForVehicle(db: D1Database, vehicleId: number, since: string): Promise<Hit[]> {
  const hits: Hit[] = [];
  try {
    for (const r of await query<any>(db,
      `SELECT c.call_number, c.incident_type FROM calls_for_service c
       JOIN call_vehicles cv ON cv.call_id = c.id
       WHERE cv.vehicle_id = ? AND c.created_at > ? LIMIT 5`, vehicleId, since))
      hits.push({ kind: 'call', label: `${r.call_number || 'CFS'} ${r.incident_type || ''}`.trim() });
  } catch (err: any) { console.error('[watchlist] vehicle calls failed:', err?.message); }
  try {
    for (const r of await query<any>(db,
      `SELECT fi_number FROM field_interviews
       WHERE vehicle_id = ? AND created_at > ? LIMIT 5`, vehicleId, since))
      hits.push({ kind: 'field interview', label: r.fi_number || 'FI' });
  } catch (err: any) { console.error('[watchlist] vehicle FIs failed:', err?.message); }
  return hits;
}

async function entityLabel(db: D1Database, type: string, id: number): Promise<string> {
  try {
    if (type === 'person') {
      const p = await query<any>(db, 'SELECT first_name, last_name FROM persons WHERE id = ?', id);
      if (p[0]) return `${p[0].first_name} ${p[0].last_name}`;
    } else if (type === 'vehicle') {
      const v = await query<any>(db, 'SELECT plate_number, make, model FROM vehicles_records WHERE id = ?', id);
      if (v[0]) return [v[0].make, v[0].model, v[0].plate_number ? `(${v[0].plate_number})` : ''].filter(Boolean).join(' ');
    }
  } catch { /* fall through */ }
  return `${type} #${id}`;
}

export async function sweepWatchlist(db: D1Database): Promise<number> {
  let alerts = 0;
  let watches: WatchRow[] = [];
  try {
    watches = await query<WatchRow>(db,
      'SELECT id, entity_type, entity_id, reason, added_by, last_alert_at FROM intel_watchlist WHERE active = 1 LIMIT 200');
  } catch (err: any) {
    // Table missing on live = migration drift; stay silent beyond one log.
    console.error('[watchlist] sweep skipped:', err?.message);
    return 0;
  }
  for (const w of watches) {
    try {
      const since = w.last_alert_at || new Date(0).toISOString();
      const hits = w.entity_type === 'vehicle'
        ? await hitsForVehicle(db, w.entity_id, since)
        : await hitsForPerson(db, w.entity_id, since);
      if (!hits.length) continue;
      const label = await entityLabel(db, w.entity_type, w.entity_id);
      const detail = hits.map((h) => `${h.kind}: ${h.label}`).join('; ');
      await execute(db,
        `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
         VALUES ('watchlist_hit', 'high', ?, ?, ?, ?, ?, 0, datetime('now'))`,
        `WATCHLIST: ${label}`,
        `New activity for watched ${w.entity_type} ${label}${w.reason ? ` (watch reason: ${w.reason})` : ''} — ${detail}`,
        w.entity_type, w.entity_id, w.added_by);
      await execute(db, `UPDATE intel_watchlist SET last_alert_at = datetime('now') WHERE id = ?`, w.id);
      alerts++;
    } catch (err: any) {
      console.error(`[watchlist] watch ${w.id} failed:`, err?.message);
    }
  }
  return alerts;
}
