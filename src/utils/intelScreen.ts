// ============================================================
// RMPG Flex — Intel cross-hit screening engine (Wave 1)
// ============================================================
// One shared engine: given a person or vehicle, return every hot hit
// (active warrant, watchlist, active trespass, stolen, SOR, caution/
// gang flags). Reused by POST /api/intel/screen, the plate-sighting
// log, and the per-minute coverage sweep so EVERY entry path gets a
// records check without write-hooks across 80 route files.
// Every rule is try/catch-isolated; sentinel strings never match.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst, execute } from './db';
import { isRealValue } from './intelMatch';

export interface ScreenHit {
  kind: string;                       // active_warrant | watchlist | trespass_active | stolen | sor | caution | gang
  severity: 'critical' | 'warning';
  detail: string;
}

export async function screenPerson(db: D1Database, personId: number): Promise<ScreenHit[]> {
  const hits: ScreenHit[] = [];
  try {
    for (const w of await query<any>(db,
      `SELECT warrant_number, charge_description FROM warrants
       WHERE (subject_person_id = ? OR person_id = ?) AND status IN ('active','outstanding') LIMIT 5`,
      personId, personId))
      hits.push({ kind: 'active_warrant', severity: 'critical',
        detail: `Active warrant ${w.warrant_number || ''}${isRealValue(w.charge_description) ? ` — ${w.charge_description}` : ''}`.trim() });
  } catch (err: any) { console.error('[screen] warrants failed:', err?.message); }
  try {
    const w = await queryFirst<any>(db,
      `SELECT reason FROM intel_watchlist WHERE entity_type = 'person' AND entity_id = ? AND active = 1 LIMIT 1`, personId);
    if (w) hits.push({ kind: 'watchlist', severity: 'critical',
      detail: `On watchlist${isRealValue(w.reason) ? `: ${w.reason}` : ''}` });
  } catch (err: any) { console.error('[screen] watchlist failed:', err?.message); }
  try {
    for (const t of await query<any>(db,
      `SELECT order_number, location FROM trespass_orders WHERE person_id = ? AND status = 'active' LIMIT 3`, personId))
      hits.push({ kind: 'trespass_active', severity: 'warning',
        detail: `Active trespass ${t.order_number || ''}${isRealValue(t.location) ? ` — ${t.location}` : ''}`.trim() });
  } catch (err: any) { console.error('[screen] trespass failed:', err?.message); }
  try {
    // Offender registry alerts the agency itself created. Only ACTIVE,
    // unexpired alerts surface (a 'cleared' alert must not screen as a hit).
    // severity danger→critical, warning/caution→warning; a sex_offender
    // alert_type is tagged 'sor' so the UI badges it as registry, not a
    // generic caution.
    for (const a of await query<any>(db,
      `SELECT alert_type, severity, description FROM offender_alerts
       WHERE person_id = ? AND status = 'active'
         AND (expiration_date IS NULL OR expiration_date = '' OR expiration_date >= date('now'))
       ORDER BY CASE severity WHEN 'danger' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END LIMIT 5`, personId)) {
      const sev = a.severity === 'danger' ? 'critical' : 'warning';
      const isSor = String(a.alert_type) === 'sex_offender';
      const label = isSor ? 'Registered sex offender (registry alert)'
                          : `Offender alert${isRealValue(a.alert_type) ? ` (${String(a.alert_type).replace(/_/g, ' ')})` : ''}`;
      hits.push({ kind: isSor ? 'sor' : 'caution', severity: sev,
        detail: `${label}${isRealValue(a.description) ? ` — ${a.description}` : ''}`.trim() });
    }
  } catch (err: any) { console.error('[screen] offender_alerts failed:', err?.message); }
  try {
    const p = await queryFirst<any>(db,
      `SELECT caution_flags, gang_affiliation, is_sex_offender, watchlist_match, flags FROM persons WHERE id = ?`, personId);
    if (p) {
      if (isRealValue(p.caution_flags)) hits.push({ kind: 'caution', severity: 'warning', detail: `Caution: ${p.caution_flags}` });
      if (isRealValue(p.gang_affiliation)) hits.push({ kind: 'gang', severity: 'warning', detail: `Gang affiliation: ${p.gang_affiliation}` });
      if (p.is_sex_offender === 1 || String(p.is_sex_offender) === 'true') hits.push({ kind: 'sor', severity: 'warning', detail: 'Registered sex offender' });
      if (isRealValue(p.watchlist_match)) hits.push({ kind: 'watchlist', severity: 'warning', detail: `External watchlist: ${p.watchlist_match}` });
      const f = isRealValue(p.flags) ? String(p.flags).toLowerCase() : '';
      if (f.includes('officer safety') || f.includes('violent'))
        hits.push({ kind: 'caution', severity: 'critical', detail: 'OFFICER SAFETY flag on record' });
    }
  } catch (err: any) { console.error('[screen] person flags failed:', err?.message); }
  return hits;
}

export async function screenVehicle(
  db: D1Database,
  ref: { vehicleId?: number; plate?: string },
): Promise<{ vehicleId: number | null; hits: ScreenHit[] }> {
  const hits: ScreenHit[] = [];
  let vehicle: any = null;
  try {
    vehicle = ref.vehicleId
      ? await queryFirst<any>(db, 'SELECT id, plate_number, is_stolen, stolen_status, flags, owner_person_id FROM vehicles_records WHERE id = ?', ref.vehicleId)
      : ref.plate
        ? await queryFirst<any>(db, 'SELECT id, plate_number, is_stolen, stolen_status, flags, owner_person_id FROM vehicles_records WHERE UPPER(plate_number) = ?', ref.plate.toUpperCase())
        : null;
  } catch (err: any) { console.error('[screen] vehicle lookup failed:', err?.message); }
  if (!vehicle) return { vehicleId: null, hits };

  if (vehicle.is_stolen === 1 || isRealValue(vehicle.stolen_status))
    hits.push({ kind: 'stolen', severity: 'critical',
      detail: `STOLEN${isRealValue(vehicle.stolen_status) ? ` (${vehicle.stolen_status})` : ''} — ${vehicle.plate_number || `vehicle #${vehicle.id}`}` });
  try {
    const w = await queryFirst<any>(db,
      `SELECT reason FROM intel_watchlist WHERE entity_type = 'vehicle' AND entity_id = ? AND active = 1 LIMIT 1`, vehicle.id);
    if (w) hits.push({ kind: 'watchlist', severity: 'critical',
      detail: `Vehicle on watchlist${isRealValue(w.reason) ? `: ${w.reason}` : ''}` });
  } catch (err: any) { console.error('[screen] vehicle watchlist failed:', err?.message); }
  if (vehicle.owner_person_id) {
    const ownerHits = await screenPerson(db, vehicle.owner_person_id);
    for (const h of ownerHits) hits.push({ ...h, detail: `Owner: ${h.detail}` });
  }
  return { vehicleId: vehicle.id, hits };
}

// Coverage sweep — screens persons/vehicles created in the last few
// minutes regardless of which route created them. Critical hits raise
// an anomaly_alerts row (dedup_key prevents repeats) so the dispatch
// banner lights up.
export async function sweepNewEntities(db: D1Database): Promise<number> {
  let raised = 0;
  const raise = async (dedupKey: string, title: string, details: string) => {
    try {
      const dup = await queryFirst<any>(db, 'SELECT id FROM anomaly_alerts WHERE dedup_key = ?', dedupKey);
      if (dup) return;
      await execute(db,
        `INSERT INTO anomaly_alerts (alert_type, severity, title, details, dedup_key, created_at, updated_at)
         VALUES ('intel_screen', 'critical', ?, ?, ?, datetime('now'), datetime('now'))`,
        title, details, dedupKey);
      raised++;
    } catch (err: any) { console.error('[screen-sweep] raise failed:', err?.message); }
  };
  try {
    for (const p of await query<any>(db,
      `SELECT id, first_name, last_name FROM persons WHERE created_at > datetime('now','-2 minutes') LIMIT 25`)) {
      const hits = (await screenPerson(db, p.id)).filter((h) => h.severity === 'critical');
      if (hits.length) await raise(`intel_screen:person:${p.id}`,
        `RECORDS HIT: ${p.first_name} ${p.last_name}`, hits.map((h) => h.detail).join('; '));
    }
  } catch (err: any) { console.error('[screen-sweep] persons failed:', err?.message); }
  try {
    for (const v of await query<any>(db,
      `SELECT id, plate_number FROM vehicles_records WHERE created_at > datetime('now','-2 minutes') LIMIT 25`)) {
      const { hits } = await screenVehicle(db, { vehicleId: v.id });
      const crit = hits.filter((h) => h.severity === 'critical');
      if (crit.length) await raise(`intel_screen:vehicle:${v.id}`,
        `RECORDS HIT: vehicle ${v.plate_number || `#${v.id}`}`, crit.map((h) => h.detail).join('; '));
    }
  } catch (err: any) { console.error('[screen-sweep] vehicles failed:', err?.message); }
  return raised;
}
