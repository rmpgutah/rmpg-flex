// ============================================================
// Utah Sex Offender Registry poller (Cloudflare Worker)
// ============================================================
// Pulls Utah SOR records from an AGENCY-AUTHORIZED feed into the local
// utah_sex_offenders table, which the DL-scan deep sweep queries by name.
//
// ⚠️ This does NOT scrape the public registry. Utah's registry runs on
// OffenderWatch (communitynotification.com), which technically blocks
// automated access (HTTP 403) and whose Terms of Use prohibit systematic
// retrieval/harvesting. The lawful, durable channel is OffenderWatch's
// law-enforcement API or a Utah BCI data feed — both agency-credentialed.
//
// The poller is therefore CONFIG-GATED: it reads a feed URL + key from
// system_config and is a no-op until an authorized feed is provisioned.
// It expects the feed to return a JSON array of offender objects (the
// OffenderWatch LE API shape, with tolerant field aliasing). When your
// agency connects its feed, this lights up with zero code change.
//
// Config keys (system_config, any category):
//   sor_feed_url  — HTTPS endpoint returning JSON array of offenders
//   sor_feed_key  — bearer token / API key (sent as Authorization: Bearer)
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { execute, query, queryFirst } from './db';

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RECORDS_PER_RUN = 5_000;

interface SorConfig { url: string; key: string }

async function readConfig(db: D1Database): Promise<SorConfig | null> {
  try {
    const url = await queryFirst<{ config_value: string }>(
      db, `SELECT config_value FROM system_config WHERE config_key = 'sor_feed_url' ORDER BY id DESC LIMIT 1`);
    const key = await queryFirst<{ config_value: string }>(
      db, `SELECT config_value FROM system_config WHERE config_key = 'sor_feed_key' ORDER BY id DESC LIMIT 1`);
    const u = (url?.config_value || '').trim();
    if (!u || !/^https:\/\//i.test(u)) return null;
    return { url: u, key: (key?.config_value || '').trim() };
  } catch { return null; }
}

// Tolerant field reader — OffenderWatch / BCI feeds vary in casing/keys.
function pick(o: Record<string, any>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

interface SorRow {
  registry_id: string; first_name: string; middle_name: string; last_name: string;
  date_of_birth: string; aliases: string; sex: string; race: string; height: string;
  weight: string; hair_color: string; eye_color: string; scars_marks: string;
  address: string; city: string; state: string; zip: string; offense: string;
  risk_level: string; registration_status: string; compliance_status: string; photo_url: string;
}

function normalize(o: Record<string, any>): SorRow | null {
  const last = pick(o, 'last_name', 'lastName', 'LastName', 'last');
  const first = pick(o, 'first_name', 'firstName', 'FirstName', 'first');
  if (!last && !first) return null;
  return {
    registry_id: pick(o, 'registry_id', 'offenderId', 'id', 'sor_number', 'sorNumber') || `${last}-${first}-${pick(o, 'date_of_birth', 'dob', 'dateOfBirth')}`,
    first_name: first, middle_name: pick(o, 'middle_name', 'middleName', 'middle'),
    last_name: last,
    date_of_birth: pick(o, 'date_of_birth', 'dob', 'dateOfBirth', 'DOB'),
    aliases: pick(o, 'aliases', 'akas', 'alias'),
    sex: pick(o, 'sex', 'gender'), race: pick(o, 'race', 'ethnicity'),
    height: pick(o, 'height'), weight: pick(o, 'weight'),
    hair_color: pick(o, 'hair_color', 'hair', 'hairColor'),
    eye_color: pick(o, 'eye_color', 'eyes', 'eyeColor'),
    scars_marks: pick(o, 'scars_marks', 'scarsMarksTattoos', 'smt'),
    address: pick(o, 'address', 'street', 'homeAddress', 'residence'),
    city: pick(o, 'city'), state: pick(o, 'state') || 'UT', zip: pick(o, 'zip', 'postal_code', 'zipCode'),
    offense: pick(o, 'offense', 'conviction', 'charges', 'crime'),
    risk_level: pick(o, 'risk_level', 'riskLevel', 'tier'),
    registration_status: pick(o, 'registration_status', 'status', 'registrationStatus'),
    compliance_status: pick(o, 'compliance_status', 'compliance', 'complianceStatus'),
    photo_url: pick(o, 'photo_url', 'photo', 'image', 'imageUrl', 'mugshot'),
  };
}

export interface SorPollResult {
  configured: boolean;
  seen: number;
  upserted: number;
  error?: string;
}

/**
 * Poll the configured Utah SOR feed and upsert into utah_sex_offenders.
 * No-op (configured:false) when no feed is provisioned.
 */
export async function runUtahSorPoll(db: D1Database): Promise<SorPollResult> {
  const cfg = await readConfig(db);
  if (!cfg) return { configured: false, seen: 0, upserted: 0 };

  let seen = 0, upserted = 0;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const resp = await fetch(cfg.url, {
      headers: {
        'Accept': 'application/json',
        ...(cfg.key ? { 'Authorization': `Bearer ${cfg.key}` } : {}),
      },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));

    if (!resp.ok) throw new Error(`Feed returned HTTP ${resp.status}`);
    const json = await resp.json() as any;
    // Accept either a bare array or {data:[...]} / {offenders:[...]}.
    const list: Record<string, any>[] = Array.isArray(json)
      ? json : Array.isArray(json?.data) ? json.data
      : Array.isArray(json?.offenders) ? json.offenders
      : Array.isArray(json?.results) ? json.results : [];

    for (const raw of list.slice(0, MAX_RECORDS_PER_RUN)) {
      const r = normalize(raw);
      if (!r) continue;
      seen++;
      try {
        const existing = await queryFirst<{ id: number }>(
          db, 'SELECT id FROM utah_sex_offenders WHERE registry_id = ?', r.registry_id);
        if (existing) {
          await execute(db, `
            UPDATE utah_sex_offenders SET
              first_name=?, middle_name=?, last_name=?, date_of_birth=?, aliases=?, sex=?, race=?,
              height=?, weight=?, hair_color=?, eye_color=?, scars_marks=?, address=?, city=?, state=?,
              zip=?, offense=?, risk_level=?, registration_status=?, compliance_status=?, photo_url=?,
              source='SOR_FEED', last_seen_at=datetime('now'), updated_at=datetime('now')
            WHERE id=?`,
            r.first_name, r.middle_name, r.last_name, r.date_of_birth, r.aliases, r.sex, r.race,
            r.height, r.weight, r.hair_color, r.eye_color, r.scars_marks, r.address, r.city, r.state,
            r.zip, r.offense, r.risk_level, r.registration_status, r.compliance_status, r.photo_url,
            existing.id);
        } else {
          await execute(db, `
            INSERT INTO utah_sex_offenders (registry_id, first_name, middle_name, last_name, date_of_birth,
              aliases, sex, race, height, weight, hair_color, eye_color, scars_marks, address, city, state,
              zip, offense, risk_level, registration_status, compliance_status, photo_url, source, last_seen_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'SOR_FEED', datetime('now'))`,
            r.registry_id, r.first_name, r.middle_name, r.last_name, r.date_of_birth, r.aliases, r.sex,
            r.race, r.height, r.weight, r.hair_color, r.eye_color, r.scars_marks, r.address, r.city,
            r.state, r.zip, r.offense, r.risk_level, r.registration_status, r.compliance_status, r.photo_url);
        }
        upserted++;
      } catch { /* per-row failure shouldn't abort the run */ }
    }

    await execute(db, `INSERT INTO utah_sor_runs (status, records_seen, records_upserted, detail)
      VALUES ('ok', ?, ?, ?)`, seen, upserted, `feed=${cfg.url.slice(0, 80)}`);
    return { configured: true, seen, upserted };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await execute(db, `INSERT INTO utah_sor_runs (status, records_seen, records_upserted, detail)
        VALUES ('error', ?, ?, ?)`, seen, upserted, msg.slice(0, 200));
    } catch { /* logging best-effort */ }
    return { configured: true, seen, upserted, error: msg };
  }
}

/** Bulk-insert offender rows the agency lawfully holds (admin import). */
export async function importSorRows(db: D1Database, rows: Record<string, any>[]): Promise<{ imported: number }> {
  let imported = 0;
  for (const raw of rows.slice(0, MAX_RECORDS_PER_RUN)) {
    const r = normalize(raw);
    if (!r) continue;
    try {
      const existing = await queryFirst<{ id: number }>(
        db, 'SELECT id FROM utah_sex_offenders WHERE registry_id = ?', r.registry_id);
      if (existing) continue;
      await execute(db, `
        INSERT INTO utah_sex_offenders (registry_id, first_name, middle_name, last_name, date_of_birth,
          aliases, sex, race, height, weight, hair_color, eye_color, scars_marks, address, city, state,
          zip, offense, risk_level, registration_status, compliance_status, photo_url, source, last_seen_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ADMIN_IMPORT', datetime('now'))`,
        r.registry_id, r.first_name, r.middle_name, r.last_name, r.date_of_birth, r.aliases, r.sex,
        r.race, r.height, r.weight, r.hair_color, r.eye_color, r.scars_marks, r.address, r.city,
        r.state, r.zip, r.offense, r.risk_level, r.registration_status, r.compliance_status, r.photo_url);
      imported++;
    } catch { /* skip bad row */ }
  }
  return { imported };
}
