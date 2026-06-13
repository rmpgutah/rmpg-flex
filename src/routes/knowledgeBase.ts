// ============================================================
// RMPG Flex — Knowledge Base (system-wide unified search)
//   GET /api/knowledge-base/search?q=&limit=
//
// One query fans out across every major record type and returns a single,
// normalized, ranked result list. Search + display are focused on the
// VISIBLE identifier a user actually sees — the call number, case/citation/
// warrant number, person name, plate, badge, unit call sign, statute cite —
// NOT the backend row id or internal code. (We never match or surface `id`.)
//
// Each source is independently guarded: a failing/absent table degrades to
// zero rows for that type instead of 500-ing the whole search. Columns were
// verified against the live schema (drifted from /migrations in places).
// ============================================================
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query } from '../utils/db';
import { codedLike } from '../utils/searchText';

const kb = new Hono<Env>();

export interface KbResult {
  /** Entity kind — drives the icon, group, and target route on the client. */
  type: string;
  /** The VISIBLE assignment number / name the user searches by. The headline. */
  label: string;
  /** Primary human descriptor (name, type, charge…). */
  title: string;
  /** Secondary line (status, location, dob…). */
  subtitle: string;
  /** Section route to open. */
  route: string;
  /** Row id — passed as a deep-link hint only; never shown as the search key. */
  recordId: number;
}

type Row = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? '' : String(v));
/** Drop sentinel placeholders the live DB stores as text ("None"/"N/A"/…). */
const clean = (v: unknown): string => {
  const t = s(v).trim();
  return /^(none|n\/?a|null|undefined|0|-)$/i.test(t) ? '' : t;
};
const joinDot = (...parts: string[]) => parts.map(clean).filter(Boolean).join(' · ');

/** Run one source query; never throws — a bad/missing table just yields []. */
async function source(name: string, run: () => Promise<KbResult[]>): Promise<KbResult[]> {
  try {
    return await run();
  } catch (err) {
    console.error('[knowledge-base] source failed:', name, err);
    return [];
  }
}

kb.get('/search', async (c) => {
  const q = (c.req.query('q') || '').trim();
  const limit = Math.min(80, Math.max(1, Number(c.req.query('limit')) || 50));
  if (q.length < 2) return c.json({ query: q, total: 0, results: [] });

  const db = getDb(c.env);
  const like = `%${q}%`;
  const PER = 6; // cap per source so no single type dominates

  const sources: Array<Promise<KbResult[]>> = [
    source('calls', async () => {
      const itLikeCall = codedLike('incident_type', q);
      const rows = await query<Row>(db,
        `SELECT id, call_number, incident_type, status, location_address FROM calls_for_service
         WHERE call_number LIKE ? OR ${itLikeCall.sql} OR location_address LIKE ?
         ORDER BY id DESC LIMIT ${PER}`, like, ...itLikeCall.binds, like);
      return rows.map((r) => ({
        type: 'call', recordId: Number(r.id),
        label: clean(r.call_number) || `Call #${r.id}`,
        title: clean(r.incident_type) || 'Call for service',
        subtitle: joinDot(s(r.status), s(r.location_address)),
        route: '/dispatch',
      }));
    }),
    source('persons', async () => {
      const rows = await query<Row>(db,
        `SELECT id, first_name, last_name, dob, address FROM persons
         WHERE first_name LIKE ? OR last_name LIKE ? OR (first_name || ' ' || last_name) LIKE ?
         ORDER BY id DESC LIMIT ${PER}`, like, like, like);
      return rows.map((r) => ({
        type: 'person', recordId: Number(r.id),
        label: joinDot(s(r.first_name) + ' ' + s(r.last_name)) || `Person #${r.id}`,
        title: 'Person record',
        subtitle: joinDot(s(r.dob) ? `DOB ${clean(r.dob)}` : '', s(r.address)),
        route: '/records',
      }));
    }),
    source('warrants', async () => {
      const rows = await query<Row>(db,
        `SELECT id, warrant_number, subject_name, charge_description, status FROM warrants
         WHERE warrant_number LIKE ? OR subject_name LIKE ? OR charge_description LIKE ?
         ORDER BY id DESC LIMIT ${PER}`, like, like, like);
      return rows.map((r) => ({
        type: 'warrant', recordId: Number(r.id),
        label: clean(r.warrant_number) || `Warrant #${r.id}`,
        title: clean(r.subject_name) || 'Warrant',
        subtitle: joinDot(s(r.charge_description), s(r.status)),
        route: '/warrants',
      }));
    }),
    source('citations', async () => {
      const rows = await query<Row>(db,
        `SELECT id, citation_number, violator_name, violation, status FROM citations
         WHERE citation_number LIKE ? OR violator_name LIKE ? OR violation LIKE ?
         ORDER BY id DESC LIMIT ${PER}`, like, like, like);
      return rows.map((r) => ({
        type: 'citation', recordId: Number(r.id),
        label: clean(r.citation_number) || `Citation #${r.id}`,
        title: clean(r.violator_name) || 'Citation',
        subtitle: joinDot(s(r.violation), s(r.status)),
        route: '/records',
      }));
    }),
    source('vehicles', async () => {
      const rows = await query<Row>(db,
        `SELECT id, plate_number, make, model, year, color, vin FROM vehicles_records
         WHERE plate_number LIKE ? OR vin LIKE ? OR make LIKE ? OR model LIKE ?
         ORDER BY id DESC LIMIT ${PER}`, like, like, like, like);
      return rows.map((r) => ({
        type: 'vehicle', recordId: Number(r.id),
        label: clean(r.plate_number) || clean(r.vin) || `Vehicle #${r.id}`,
        title: joinDot(s(r.year), s(r.color), s(r.make), s(r.model)) || 'Vehicle',
        subtitle: clean(r.vin) ? `VIN ${clean(r.vin)}` : '',
        route: '/records',
      }));
    }),
    source('incidents', async () => {
      const itLikeInc = codedLike('incident_type', q);
      const rows = await query<Row>(db,
        `SELECT id, incident_number, incident_type, status, location_address FROM incidents
         WHERE incident_number LIKE ? OR ${itLikeInc.sql} OR location_address LIKE ?
         ORDER BY id DESC LIMIT ${PER}`, like, ...itLikeInc.binds, like);
      return rows.map((r) => ({
        type: 'incident', recordId: Number(r.id),
        label: clean(r.incident_number) || `Incident #${r.id}`,
        title: clean(r.incident_type) || 'Incident',
        subtitle: joinDot(s(r.status), s(r.location_address)),
        route: '/incidents',
      }));
    }),
    source('personnel', async () => {
      const rows = await query<Row>(db,
        `SELECT id, full_name, first_name, last_name, badge_number, rank, role FROM users
         WHERE full_name LIKE ? OR badge_number LIKE ? OR first_name LIKE ? OR last_name LIKE ?
         ORDER BY id DESC LIMIT ${PER}`, like, like, like, like);
      return rows.map((r) => ({
        type: 'personnel', recordId: Number(r.id),
        label: clean(r.full_name) || joinDot(s(r.first_name) + ' ' + s(r.last_name)) || `User #${r.id}`,
        title: clean(r.badge_number) ? `Badge ${clean(r.badge_number)}` : 'Personnel',
        subtitle: joinDot(s(r.rank), s(r.role)),
        route: '/personnel',
      }));
    }),
    source('units', async () => {
      const rows = await query<Row>(db,
        `SELECT id, call_sign, status FROM units WHERE call_sign LIKE ?
         ORDER BY id DESC LIMIT ${PER}`, like);
      return rows.map((r) => ({
        type: 'unit', recordId: Number(r.id),
        label: clean(r.call_sign) || `Unit #${r.id}`,
        title: 'Unit',
        subtitle: clean(r.status),
        route: '/dispatch',
      }));
    }),
    source('evidence', async () => {
      const rows = await query<Row>(db,
        `SELECT id, evidence_number, description, evidence_type FROM evidence
         WHERE evidence_number LIKE ? OR description LIKE ?
         ORDER BY id DESC LIMIT ${PER}`, like, like);
      return rows.map((r) => ({
        type: 'evidence', recordId: Number(r.id),
        label: clean(r.evidence_number) || `Evidence #${r.id}`,
        title: clean(r.description) || 'Evidence',
        subtitle: clean(r.evidence_type),
        route: '/records',
      }));
    }),
    source('bolos', async () => {
      const rows = await query<Row>(db,
        `SELECT id, bolo_number, title, description, status FROM bolos
         WHERE bolo_number LIKE ? OR title LIKE ? OR description LIKE ?
         ORDER BY id DESC LIMIT ${PER}`, like, like, like);
      return rows.map((r) => ({
        type: 'bolo', recordId: Number(r.id),
        label: clean(r.bolo_number) || `BOLO #${r.id}`,
        title: clean(r.title) || 'BOLO',
        subtitle: joinDot(s(r.description), s(r.status)),
        route: '/communications',
      }));
    }),
    source('properties', async () => {
      const rows = await query<Row>(db,
        `SELECT id, name, address FROM properties
         WHERE name LIKE ? OR address LIKE ?
         ORDER BY id DESC LIMIT ${PER}`, like, like);
      return rows.map((r) => ({
        type: 'property', recordId: Number(r.id),
        label: clean(r.name) || `Property #${r.id}`,
        title: 'Property',
        subtitle: clean(r.address),
        route: '/records',
      }));
    }),
    source('arrests', async () => {
      const rows = await query<Row>(db,
        `SELECT id, booking_number, charges FROM arrest_records
         WHERE booking_number LIKE ? OR charges LIKE ?
         ORDER BY id DESC LIMIT ${PER}`, like, like);
      return rows.map((r) => ({
        type: 'arrest', recordId: Number(r.id),
        label: clean(r.booking_number) || `Booking #${r.id}`,
        title: 'Arrest / booking',
        subtitle: clean(r.charges),
        route: '/arrest-records',
      }));
    }),
    source('statutes', async () => {
      const rows = await query<Row>(db,
        `SELECT id, section, title FROM utah_statutes
         WHERE section LIKE ? OR title LIKE ?
         ORDER BY (section LIKE ?) DESC, id ASC LIMIT ${PER}`, like, like, like);
      return rows.map((r) => ({
        type: 'statute', recordId: Number(r.id),
        label: clean(r.section) ? `Utah Code § ${clean(r.section)}` : `Statute #${r.id}`,
        title: clean(r.title) || 'Statute',
        subtitle: '',
        route: '/law-book',
      }));
    }),
  ];

  const all = (await Promise.all(sources)).flat();

  // Rank by how the VISIBLE label/title matches the query: exact prefix on the
  // label (the assignment number / name) wins, then substring, then the rest.
  const ql = q.toLowerCase();
  const score = (r: KbResult): number => {
    const lab = r.label.toLowerCase();
    if (lab === ql) return 0;
    if (lab.startsWith(ql)) return 1;
    if (lab.includes(ql)) return 2;
    if (r.title.toLowerCase().includes(ql)) return 3;
    return 4;
  };
  all.sort((a, b) => score(a) - score(b));

  return c.json({ query: q, total: all.length, results: all.slice(0, limit) });
});

export default kb;
