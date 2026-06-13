// Intel dashboard aggregate. One round-trip for the command-center landing.
// Each section is isolated: a failing query yields its empty default, never
// a 500 (mirrors the dossier endpoint's resilience). All tables/columns here
// are verified against live D1 (785de7ae).
import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst } from './db';

export interface IntelOverview {
  stats: { active_warrants: number; on_watchlist: number; gang_flagged: number };
  watchlist_activity: Array<{ entity_type: string; entity_id: number; label: string; event: string; when: string }>;
  alerts: Array<{ kind: string; person_id: number | null; label: string; detail: string; when: string }>;
  escalation_leaderboard: Array<{ person_id: number; label: string; score: number; trend: string }>;
  jail_cross_hits: Array<{ booking_id: number; name: string; person_id: number | null; booked_at: string; match: string }>;
  plate_sightings: Array<{ plate: string; state: string | null; flag: string | null; location_text: string | null; when: string }>;
  queues: { link_suggestions: number; resolution_pairs: number };
  bolos: { active: number; high_priority: number };
}

const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);

export async function buildOverview(db: D1Database): Promise<IntelOverview> {
  const ov: IntelOverview = {
    stats: { active_warrants: 0, on_watchlist: 0, gang_flagged: 0 },
    watchlist_activity: [], alerts: [], escalation_leaderboard: [],
    jail_cross_hits: [], plate_sightings: [],
    queues: { link_suggestions: 0, resolution_pairs: 0 },
    bolos: { active: 0, high_priority: 0 },
  };

  try {
    const r = await queryFirst<{ c: number }>(db,
      `SELECT COUNT(*) AS c FROM warrants WHERE LOWER(COALESCE(status,'')) IN ('active','outstanding')`);
    ov.stats.active_warrants = n(r?.c);
  } catch (e: any) { console.error('[overview] warrants stat:', e?.message); }

  try {
    const r = await queryFirst<{ c: number }>(db,
      `SELECT COUNT(*) AS c FROM intel_watchlist WHERE active = 1`);
    ov.stats.on_watchlist = n(r?.c);
  } catch (e: any) { console.error('[overview] watchlist stat:', e?.message); }

  try {
    const r = await queryFirst<{ c: number }>(db,
      `SELECT COUNT(*) AS c FROM persons WHERE LOWER(COALESCE(flags,'')) LIKE '%gang%'`);
    ov.stats.gang_flagged = n(r?.c);
  } catch (e: any) { console.error('[overview] gang stat:', e?.message); }

  // Recent activity on watched entities.
  try {
    ov.watchlist_activity = (await query<any>(db,
      `SELECT w.entity_type, w.entity_id,
              COALESCE(p.first_name || ' ' || p.last_name, 'Entity #' || w.entity_id) AS label,
              'Watched activity' AS event, w.last_alert_at AS when_ts
         FROM intel_watchlist w
         LEFT JOIN persons p ON w.entity_type = 'person' AND p.id = w.entity_id
        WHERE w.active = 1 AND w.last_alert_at IS NOT NULL
        ORDER BY w.last_alert_at DESC LIMIT 8`)).map((r) => ({
      entity_type: r.entity_type, entity_id: n(r.entity_id), label: String(r.label),
      event: r.event, when: r.when_ts || '',
    }));
  } catch (e: any) { console.error('[overview] watchlist activity:', e?.message); }

  // Active alerts: active warrants joined to subject persons.
  try {
    ov.alerts = (await query<any>(db,
      `SELECT COALESCE(w.subject_person_id, w.person_id) AS pid,
              COALESCE(p.first_name || ' ' || p.last_name, w.subject_name, 'Unknown') AS label,
              COALESCE(w.charge_description, 'Warrant') AS detail,
              w.issued_date AS when_ts
         FROM warrants w
         LEFT JOIN persons p ON p.id = COALESCE(w.subject_person_id, w.person_id)
        WHERE LOWER(COALESCE(w.status,'')) IN ('active','outstanding')
        ORDER BY w.issued_date DESC LIMIT 8`)).map((r) => ({
      kind: 'warrant', person_id: r.pid ? n(r.pid) : null,
      label: String(r.label), detail: String(r.detail), when: r.when_ts || '',
    }));
  } catch (e: any) { console.error('[overview] alerts:', e?.message); }

  // Escalation leaderboard: 30-day event tempo per person across calls + incidents.
  try {
    ov.escalation_leaderboard = (await query<any>(db,
      `SELECT pid, label, COUNT(*) AS score FROM (
          SELECT cp.person_id AS pid,
                 (SELECT first_name || ' ' || last_name FROM persons WHERE id = cp.person_id) AS label
            FROM call_persons cp
            JOIN calls_for_service c ON c.id = cp.call_id
           WHERE c.created_at >= datetime('now','-30 days')
          UNION ALL
          SELECT ip.person_id AS pid,
                 (SELECT first_name || ' ' || last_name FROM persons WHERE id = ip.person_id) AS label
            FROM incident_persons ip
            JOIN incidents i ON i.id = ip.incident_id
           WHERE i.occurred_date >= date('now','-30 days')
       ) WHERE pid IS NOT NULL AND label IS NOT NULL
       GROUP BY pid, label ORDER BY score DESC LIMIT 8`)).map((r) => ({
      person_id: n(r.pid), label: String(r.label), score: n(r.score),
      trend: n(r.score) >= 3 ? 'rising' : 'flat',
    }));
  } catch (e: any) { console.error('[overview] escalation:', e?.message); }

  // Jail cross-hits: recent bookings (inmates) in the last day, name-matched to persons.
  // NOTE: there is no jail_bookings table on live; inmates is the booking store and
  // has no person FK, so we name-match to persons to flag exact vs possible.
  try {
    ov.jail_cross_hits = (await query<any>(db,
      `SELECT i.id AS booking_id,
              (COALESCE(i.last_name,'') || ', ' || COALESCE(i.first_name,'')) AS name,
              p.id AS person_id, i.booking_date AS booked_at,
              CASE WHEN p.id IS NOT NULL THEN 'exact' ELSE 'possible' END AS match
         FROM inmates i
         LEFT JOIN persons p
           ON LOWER(p.last_name) = LOWER(i.last_name) AND LOWER(p.first_name) = LOWER(i.first_name)
        WHERE date(i.booking_date) >= date('now','-1 day')
        ORDER BY i.booking_date DESC LIMIT 6`)).map((r) => ({
      booking_id: n(r.booking_id),
      name: (String(r.name || '').trim().replace(/^,|,$/g, '').trim()) || 'Unknown',
      person_id: r.person_id ? n(r.person_id) : null, booked_at: r.booked_at || '', match: r.match,
    }));
  } catch (e: any) { console.error('[overview] jail cross-hits:', e?.message); }

  // Recent plate sightings.
  try {
    ov.plate_sightings = (await query<any>(db,
      `SELECT plate, state, location_text, created_at AS when_ts,
              CASE WHEN notes LIKE '%stolen%' THEN 'stolen' ELSE NULL END AS flag
         FROM vehicle_sightings ORDER BY created_at DESC LIMIT 6`)).map((r) => ({
      plate: String(r.plate || ''), state: r.state || null, flag: r.flag || null,
      location_text: r.location_text || null, when: r.when_ts || '',
    }));
  } catch (e: any) { console.error('[overview] sightings:', e?.message); }

  // Review queue counts.
  try {
    const a = await queryFirst<{ c: number }>(db,
      `SELECT COUNT(*) AS c FROM intel_link_suggestions WHERE status = 'pending'`);
    ov.queues.link_suggestions = n(a?.c);
  } catch (e: any) { console.error('[overview] link queue:', e?.message); }
  try {
    const b = await queryFirst<{ c: number }>(db,
      `SELECT COUNT(*) AS c FROM entity_resolution_suggestions WHERE status = 'pending'`);
    ov.queues.resolution_pairs = n(b?.c);
  } catch (e: any) { console.error('[overview] resolution queue:', e?.message); }

  // BOLO counts (bolos table exists on live).
  try {
    const r = await queryFirst<{ a: number; h: number }>(db,
      `SELECT COUNT(*) AS a,
              SUM(CASE WHEN priority IN ('critical','high') THEN 1 ELSE 0 END) AS h
         FROM bolos WHERE status = 'active'`);
    ov.bolos.active = n(r?.a); ov.bolos.high_priority = n(r?.h);
  } catch (e: any) { console.error('[overview] bolos:', e?.message); }

  return ov;
}
