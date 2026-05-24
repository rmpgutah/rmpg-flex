// ============================================================
// RMPG Flex — NIBRS (Hono / lean API, NB-1 + NB-2 + NB-3)
//   GET  /api/nibrs/codes              bundled
//   GET  /api/nibrs/codes/offenses?group=A|B&active=1
//   GET  /api/nibrs/codes/{locations|weapons|biases|properties|loss-types}
//   POST /api/nibrs/export?from=&to=[&dryRun=1][&force=1]
// Validator + flat-file generator inlined (lean API has no
// shared worker-middleware/ utility dir).
// ============================================================
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';
import { requireRole } from '../middleware/auth';

const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'];
const EXPORT_ROLES = ['admin', 'manager', 'supervisor'];

const nibrs = new Hono<Env>();

// ── Validator (used by /export and the incident-submit gate) ──
export interface NibrsValidationIssue {
  offense_id: number | null;
  offense_code: string | null;
  missing_field: string;
  severity: 'error' | 'warning';
  message: string;
}
export interface NibrsValidationResult {
  incident_id: number;
  valid: boolean;
  errors: NibrsValidationIssue[];
  warnings: NibrsValidationIssue[];
}

function isMissing(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim();
  if (!s) return true;
  if (s === '0' || s.toLowerCase() === 'none' || s.toLowerCase() === 'unknown') return true;
  return false;
}

export async function validateIncidentForNibrs(db: D1Database, incidentId: number): Promise<NibrsValidationResult> {
  const issues: NibrsValidationIssue[] = [];
  const incident = await queryFirst<any>(db, 'SELECT * FROM incidents WHERE id = ?', incidentId);
  if (!incident) {
    return { incident_id: incidentId, valid: false, errors: [{ offense_id: null, offense_code: null, missing_field: 'incident', severity: 'error', message: 'Incident not found' }], warnings: [] };
  }

  if (isMissing(incident.narrative)) issues.push({ offense_id: null, offense_code: null, missing_field: 'narrative', severity: 'error', message: 'Incident narrative is required' });
  if (isMissing(incident.location_address)) issues.push({ offense_id: null, offense_code: null, missing_field: 'location_address', severity: 'error', message: 'Incident location is required' });
  if (isMissing(incident.occurred_at) && isMissing(incident.reported_at)) issues.push({ offense_id: null, offense_code: null, missing_field: 'occurred_at', severity: 'error', message: 'Occurrence date/time is required' });

  const officerCount = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM incident_officers WHERE incident_id = ?', incidentId);
  if (!officerCount?.n) issues.push({ offense_id: null, offense_code: null, missing_field: 'officer', severity: 'error', message: 'At least one officer must be assigned' });

  const offenses = await query<any>(db, `
    SELECT io.*, nc.ucr_group, nc.attempted_completed_required, nc.victim_required,
           nc.weapon_required, nc.bias_required, nc.property_required, nc.drug_required
    FROM incident_offenses io
    LEFT JOIN nibrs_offense_codes nc ON nc.code = io.nibrs_code
    WHERE io.incident_id = ?`, incidentId);

  if (offenses.length === 0) issues.push({ offense_id: null, offense_code: null, missing_field: 'offense', severity: 'error', message: 'At least one offense must be listed' });

  const incidentHasVictim = (await queryFirst(db, "SELECT 1 FROM incident_persons WHERE incident_id = ? AND role = 'victim' LIMIT 1", incidentId)) != null;
  const incidentHasProperty = (await queryFirst(db, 'SELECT 1 FROM evidence WHERE incident_id = ? LIMIT 1', incidentId)) != null;

  for (const off of offenses) {
    const code = off.nibrs_code || off.offense_code;
    if (isMissing(off.nibrs_code)) { issues.push({ offense_id: off.id, offense_code: code, missing_field: 'nibrs_code', severity: 'error', message: `Offense has no NIBRS code` }); continue; }
    if (off.ucr_group == null) { issues.push({ offense_id: off.id, offense_code: code, missing_field: 'nibrs_code', severity: 'error', message: `NIBRS code "${code}" not recognized` }); continue; }
    if (off.ucr_group === 'B') continue;
    if (off.attempted_completed_required && isMissing(off.attempted_completed)) issues.push({ offense_id: off.id, offense_code: code, missing_field: 'attempted_completed', severity: 'error', message: `${code}: attempted/completed required` });
    if (off.victim_required && !(!isMissing(off.victim_person_id) || incidentHasVictim)) issues.push({ offense_id: off.id, offense_code: code, missing_field: 'victim', severity: 'error', message: `${code}: victim required` });
    if (off.weapon_required && isMissing(off.weapon_force)) issues.push({ offense_id: off.id, offense_code: code, missing_field: 'weapon_force', severity: 'error', message: `${code}: weapon/force required` });
    if (off.bias_required && isMissing(off.bias_motivation)) issues.push({ offense_id: off.id, offense_code: code, missing_field: 'bias_motivation', severity: 'warning', message: `${code}: bias should be set (use 88 if none)` });
    if (off.property_required && !incidentHasProperty) issues.push({ offense_id: off.id, offense_code: code, missing_field: 'property', severity: 'warning', message: `${code}: property/evidence expected` });
    if (isMissing(off.location_type)) issues.push({ offense_id: off.id, offense_code: code, missing_field: 'location_type', severity: 'warning', message: `${code}: location_type recommended` });
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return { incident_id: incidentId, valid: errors.length === 0, errors, warnings };
}

// ── Flat-file generator ──
function f(v: unknown, width: number, opts?: { zero?: boolean }): string {
  let s = v == null ? '' : String(v);
  s = s.replace(/[^\x20-\x7E]/g, ' ').slice(0, width);
  return opts?.zero ? s.padStart(width, '0') : s.padEnd(width, ' ');
}
function withLength(level: string, body: string): string { return level + f(6 + body.length, 4, { zero: true }) + body; }
function localParts(d: Date) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = Object.fromEntries(fmt.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return { year: parts.year || '0000', month: parts.month || '00', day: parts.day || '00', hour: (parts.hour === '24' ? '00' : parts.hour) || '00', minute: parts.minute || '00' };
}
function nibrsDate(v: string | Date | null | undefined): string {
  if (!v) return '        ';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (isNaN(d.getTime())) return '        ';
  const p = localParts(d); return p.year + p.month + p.day;
}
function nibrsDateTime(v: string | Date | null | undefined): string {
  if (!v) return '            ';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (isNaN(d.getTime())) return '            ';
  const p = localParts(d); return p.year + p.month + p.day + p.hour + p.minute;
}
const pickSex = (v: unknown): 'M'|'F'|'U' => { const s = String(v||'').toLowerCase(); return s.startsWith('m')?'M':s.startsWith('f')?'F':'U'; };
const pickRace = (v: unknown): 'W'|'B'|'I'|'A'|'P'|'U' => { const s = String(v||'').toLowerCase(); if(s.startsWith('w'))return 'W'; if(s.startsWith('b')||s.includes('african'))return 'B'; if(s.startsWith('i')||s.includes('indian'))return 'I'; if(s.startsWith('a'))return 'A'; if(s.startsWith('p'))return 'P'; return 'U'; };
const pickEthnicity = (v: unknown): 'H'|'N'|'U' => { const s = String(v||'').toLowerCase(); if(s.includes('hisp')||s.includes('latin'))return 'H'; if(s.includes('non')||s.startsWith('n'))return 'N'; return 'U'; };
function ageFromDOB(dob: string | null | undefined, asOf: Date): string {
  if (!dob) return '00';
  const d = new Date(dob); if (isNaN(d.getTime())) return '00';
  let age = asOf.getFullYear() - d.getFullYear();
  const m = asOf.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < d.getDate())) age--;
  if (age < 0 || age > 99) return '00';
  return age.toString().padStart(2, '0');
}

// ── Routes ──
nibrs.get('/codes', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const [offenses, locations, weapons, biases, properties, lossTypes] = await Promise.all([
      query(db, 'SELECT * FROM nibrs_offense_codes WHERE active = 1 ORDER BY ucr_group, code'),
      query(db, 'SELECT * FROM nibrs_location_codes ORDER BY code'),
      query(db, 'SELECT * FROM nibrs_weapon_codes ORDER BY code'),
      query(db, 'SELECT * FROM nibrs_bias_codes ORDER BY code'),
      query(db, 'SELECT * FROM nibrs_property_descriptions ORDER BY code'),
      query(db, 'SELECT * FROM nibrs_property_loss_types ORDER BY code'),
    ]);
    return c.json({ offenses, locations, weapons, biases, properties, lossTypes });
  } catch (err) {
    console.error('[nibrs] codes error', err);
    return c.json({ error: 'Failed to load NIBRS codes', code: 'NIBRS_ALL_ERR' }, 500);
  }
});

nibrs.get('/codes/offenses', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const group = (c.req.query('group') || '').toUpperCase();
    const activeOnly = c.req.query('active') !== '0';
    const wheres: string[] = []; const params: unknown[] = [];
    if (group === 'A' || group === 'B') { wheres.push('ucr_group = ?'); params.push(group); }
    if (activeOnly) wheres.push('active = 1');
    const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
    return c.json(await query(db, `SELECT * FROM nibrs_offense_codes ${where} ORDER BY ucr_group, code`, ...params));
  } catch (err) {
    console.error('[nibrs] offenses error', err);
    return c.json({ error: 'Failed to list NIBRS offenses', code: 'NIBRS_LIST_ERR' }, 500);
  }
});

const simpleList = (table: string, code: string) => async (c: any) => {
  try { return c.json(await query(getDb(c.env), `SELECT * FROM ${table} ORDER BY code`)); }
  catch (err) { console.error(`[nibrs] ${table} error`, err); return c.json({ error: `Failed to list ${table}`, code }, 500); }
};
nibrs.get('/codes/locations',  requireRole(...READ_ROLES), simpleList('nibrs_location_codes', 'NIBRS_LOC_ERR'));
nibrs.get('/codes/weapons',    requireRole(...READ_ROLES), simpleList('nibrs_weapon_codes', 'NIBRS_WEAPON_ERR'));
nibrs.get('/codes/biases',     requireRole(...READ_ROLES), simpleList('nibrs_bias_codes', 'NIBRS_BIAS_ERR'));
nibrs.get('/codes/properties', requireRole(...READ_ROLES), simpleList('nibrs_property_descriptions', 'NIBRS_PROP_ERR'));
nibrs.get('/codes/loss-types', requireRole(...READ_ROLES), simpleList('nibrs_property_loss_types', 'NIBRS_LOSS_ERR'));

// GET /api/nibrs/validate/:incidentId — preview NIBRS validation
// (the lean API doesn't yet have an incident-submit handler to gate;
// this is the standalone preview endpoint for when one lands.)
nibrs.get('/validate/:incidentId', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('incidentId') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid incident id', code: 'INVALID_ID' }, 400);
    return c.json(await validateIncidentForNibrs(db, id));
  } catch {
    return c.json({ error: 'Failed to validate', code: 'NIBRS_VALIDATE_ERR' }, 500);
  }
});

nibrs.post('/export', requireRole(...EXPORT_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user');
    const fromStr = c.req.query('from') || '';
    const toStr = c.req.query('to') || '';
    const fromDate = new Date(fromStr || '1970-01-01');
    const toDate = new Date(toStr || new Date().toISOString());
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) return c.json({ error: 'Invalid from/to date', code: 'NIBRS_BAD_DATES' }, 400);
    if (toDate < fromDate) return c.json({ error: 'to must be >= from', code: 'NIBRS_DATE_ORDER' }, 400);

    const dryRun = c.req.query('dryRun') === '1';
    const force = c.req.query('force') === '1' && user.role === 'admin';
    const ORI = ((c.env as any).NIBRS_AGENCY_ORI || 'UTRMPG000').slice(0, 9).padEnd(9, ' ');

    const incidents = await query<any>(db, `
      SELECT * FROM incidents
      WHERE status IN ('approved', 'closed')
        AND COALESCE(occurred_at, reported_at, created_at) >= ?
        AND COALESCE(occurred_at, reported_at, created_at) <= ?
      ORDER BY id`, fromDate.toISOString(), toDate.toISOString());

    const segments: string[] = [withLength('00', ORI + nibrsDate(new Date()) + nibrsDate(fromDate) + nibrsDate(toDate))];
    const included: { incident_id: number; incident_number: string; segments: number }[] = [];
    const excluded: { incident_id: number; incident_number: string; errors: { field: string; message: string }[] }[] = [];

    for (const inc of incidents) {
      if (!force) {
        const v = await validateIncidentForNibrs(db, inc.id);
        if (!v.valid) {
          excluded.push({ incident_id: inc.id, incident_number: inc.incident_number, errors: v.errors.map((e) => ({ field: e.missing_field, message: e.message })) });
          continue;
        }
      }
      const incidentNumber = inc.incident_number || `RMP${inc.id}`;
      let perIncidentCount = 0;

      segments.push(withLength('01', ORI + f(incidentNumber, 12) + nibrsDateTime(inc.occurred_at || inc.reported_at || inc.created_at) + f('N', 1) + nibrsDate(null) + f('N', 1)));
      perIncidentCount++;

      const offenses = await query<any>(db, 'SELECT * FROM incident_offenses WHERE incident_id = ?', inc.id);
      for (const off of offenses) {
        segments.push(withLength('02',
          ORI + f(incidentNumber, 12) + f(off.nibrs_code || '90Z', 3) +
          f(off.attempted_completed === 'attempted' ? 'A' : 'C', 1) +
          f(off.location_type || '25', 2) +
          f(String(off.weapon_force || '').replace(/[^0-9]/g, '').slice(0, 3), 3) +
          f((off.bias_motivation || '88').slice(0, 2), 2) +
          f('', 2, { zero: true }) + f('', 1) +
          f(String(off.criminal_activity || '').slice(0, 1), 1)));
        perIncidentCount++;
      }

      const persons = await query<any>(db, `
        SELECT ip.role, p.* FROM incident_persons ip
        JOIN persons p ON p.id = ip.person_id
        WHERE ip.incident_id = ? ORDER BY ip.id`, inc.id);
      let victimSeq = 0, offenderSeq = 0;
      const asOf = new Date(inc.occurred_at || inc.reported_at || inc.created_at);
      for (const p of persons) {
        if (p.role === 'victim') {
          victimSeq++;
          segments.push(withLength('04', ORI + f(incidentNumber, 12) + f(victimSeq, 3, { zero: true }) + f('I', 1) + f(ageFromDOB(p.dob, asOf), 4) + f(pickSex(p.gender), 1) + f(pickRace(p.race), 1) + f(pickEthnicity(p.ethnicity), 1) + f('U', 1) + f('', 5) + f('', 2)));
          perIncidentCount++;
        }
        if (p.role === 'suspect') {
          offenderSeq++;
          segments.push(withLength('05', ORI + f(incidentNumber, 12) + f(offenderSeq, 3, { zero: true }) + f(ageFromDOB(p.dob, asOf), 4) + f(pickSex(p.gender), 1) + f(pickRace(p.race), 1) + f(pickEthnicity(p.ethnicity), 1)));
          perIncidentCount++;
        }
      }
      included.push({ incident_id: inc.id, incident_number: incidentNumber, segments: perIncidentCount });
    }

    const result = { content: segments.join('\n') + '\n', included, excluded, totalSegments: segments.length };

    if (dryRun) return c.json({ from: fromStr, to: toStr, included: result.included, excluded: result.excluded, totalSegments: result.totalSegments, force });

    const filename = `nibrs-${fromStr || 'start'}-to-${toStr || 'now'}.dat`;
    return new Response(result.content, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-NIBRS-Included-Count': String(result.included.length),
        'X-NIBRS-Excluded-Count': String(result.excluded.length),
        'X-NIBRS-Segment-Count': String(result.totalSegments),
      },
    });
  } catch (err) {
    console.error('[nibrs] export error', err);
    return c.json({ error: 'NIBRS export failed', code: 'NIBRS_EXPORT_ERR' }, 500);
  }
});

export default nibrs;
