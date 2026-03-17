// ============================================================
// OFAC Consolidated Sanctions Scraper & Local Search Engine
// ============================================================
// Downloads the official OFAC Consolidated Sanctions List from the
// U.S. Treasury and stores it in local SQLite for instant, free,
// offline-capable screening.
//
// The consolidated list is a superset of the SDN-only list — it
// includes SDN + SSI + FSE + PLC + CAPTA and other non-SDN
// sanctions programs. Same CSV format, more coverage.
//
// Data sources (public, authoritative):
//   Primary: treasury.gov/ofac/downloads/consolidated/
//     - cons_prim.csv:  All primary entries (consolidated)
//     - cons_alt.csv:   All aliases (consolidated)
//     - cons_add.csv:   All addresses (consolidated)
//   Fallback: treasury.gov/ofac/downloads/ (SDN-only)
//
// All data is real — sourced from the same U.S. Treasury files
// that commercial screening services (LexisNexis, MicroBilt, etc.) use.
// ============================================================

import { getDb } from '../models/database';
import { localNow } from './timeUtils';

// ── Treasury.gov download URLs ──────────────────────────────
// Primary: Consolidated list (SDN + non-SDN programs)
const CONS_BASE = 'https://www.treasury.gov/ofac/downloads/consolidated';
const CONS_PRIM_URL = `${CONS_BASE}/cons_prim.csv`;
const CONS_ALT_URL = `${CONS_BASE}/cons_alt.csv`;
const CONS_ADD_URL = `${CONS_BASE}/cons_add.csv`;

// Fallback: SDN-only list (if consolidated endpoint is down)
const OFAC_BASE = 'https://www.treasury.gov/ofac/downloads';
const SDN_CSV_URL = `${OFAC_BASE}/sdn.csv`;
const ADD_CSV_URL = `${OFAC_BASE}/add.csv`;
const ALT_CSV_URL = `${OFAC_BASE}/alt.csv`;
const SDN_COMMENTS_URL = `${OFAC_BASE}/sdn_comments.csv`;

// Sync interval: 24 hours
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

let syncIntervalHandle: ReturnType<typeof setInterval> | null = null;

// ── CSV Parser ──────────────────────────────────────────────
// OFAC CSV files use standard comma-delimited format with quoted fields.
// We parse without external deps to keep the server lightweight.

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // Skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCSV(text: string): string[][] {
  return text
    .split('\n')
    .map(line => line.replace(/\r$/, ''))
    .filter(line => line.trim().length > 0)
    .map(parseCSVLine);
}

// ── SDN Data Types ──────────────────────────────────────────

interface SdnEntry {
  ent_num: number;
  sdn_name: string;
  sdn_type: string;
  program: string;
  source_list: string;
  title: string;
  call_sign: string;
  vessel_type: string;
  tonnage: string;
  grt: string;
  vessel_flag: string;
  vessel_owner: string;
  remarks: string;
}

interface SdnAlias {
  ent_num: number;
  alt_num: number;
  alt_type: string;
  alt_name: string;
  alt_remarks: string;
}

interface SdnAddress {
  ent_num: number;
  add_num: number;
  address: string;
  city: string;
  state_province: string;
  postal_code: string;
  country: string;
  add_remarks: string;
}

// ── Download helper ─────────────────────────────────────────

async function downloadCSV(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'RMPG-Flex/1.0 OFAC-Compliance-Screening' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    throw new Error(`Failed to download ${url}: ${resp.status} ${resp.statusText}`);
  }
  return resp.text();
}

// ── Sync: Download & Store ──────────────────────────────────

export async function syncOfacData(): Promise<{ entries: number; aliases: number; addresses: number; duration: number }> {
  const startTime = Date.now();
  const db = getDb();
  const now = localNow();

  console.log('[OFAC Sync] Starting consolidated sanctions download from U.S. Treasury...');

  try {
    // Try consolidated list first, fall back to SDN-only
    let sdnText: string, altText: string, addText: string, commentsText: string;
    let sourceUrl = CONS_PRIM_URL;
    let isConsolidated = true;

    try {
      [sdnText, altText, addText] = await Promise.all([
        downloadCSV(CONS_PRIM_URL),
        downloadCSV(CONS_ALT_URL),
        downloadCSV(CONS_ADD_URL),
      ]);
      // Consolidated has no separate comments file — remarks are in prim CSV
      commentsText = '';
      console.log('[OFAC Sync] Downloaded consolidated CSV files. Parsing...');
    } catch (consErr) {
      console.warn('[OFAC Sync] Consolidated download failed, falling back to SDN-only:', (consErr as Error).message);
      isConsolidated = false;
      sourceUrl = SDN_CSV_URL;
      [sdnText, altText, addText, commentsText] = await Promise.all([
        downloadCSV(SDN_CSV_URL),
        downloadCSV(ALT_CSV_URL),
        downloadCSV(ADD_CSV_URL),
        downloadCSV(SDN_COMMENTS_URL),
      ]);
      console.log('[OFAC Sync] Downloaded SDN-only CSV files. Parsing...');
    }

    // Parse SDN entries
    const sdnRows = parseCSV(sdnText);
    const entries: SdnEntry[] = sdnRows
      .filter(row => row.length >= 12 && row[0] && !isNaN(Number(row[0])))
      .map(row => ({
        ent_num: parseInt(row[0], 10),
        sdn_name: row[1] || '',
        sdn_type: normalizeSdnType(row[2]),
        program: row[3] || '',
        source_list: deriveSourceList(row[3] || '', isConsolidated),
        title: row[4] || '',
        call_sign: row[5] || '',
        vessel_type: row[6] || '',
        tonnage: row[7] || '',
        grt: row[8] || '',
        vessel_flag: row[9] || '',
        vessel_owner: row[10] || '',
        remarks: row[11] || '',
      }));

    // Parse aliases
    const altRows = parseCSV(altText);
    const aliases: SdnAlias[] = altRows
      .filter(row => row.length >= 5 && row[0] && !isNaN(Number(row[0])))
      .map(row => ({
        ent_num: parseInt(row[0], 10),
        alt_num: parseInt(row[1], 10),
        alt_type: row[2] || '',
        alt_name: row[3] || '',
        alt_remarks: row[4] || '',
      }));

    // Parse addresses
    // Treasury add.csv format: ent_num, add_num, address, city_state_zip, country, remarks
    const addRows = parseCSV(addText);
    const addresses: SdnAddress[] = addRows
      .filter(row => row.length >= 4 && row[0] && !isNaN(Number(row[0])))
      .map(row => {
        // City/state/zip are combined in column 3 — split intelligently
        const cityStateRaw = (row[3] || '').trim();
        let city = cityStateRaw;
        let stateProvince = '';
        let postalCode = '';

        // Try to extract postal code from end
        const postalMatch = cityStateRaw.match(/\b([A-Z0-9]{4,10})$/);
        if (postalMatch) {
          postalCode = postalMatch[1];
          city = cityStateRaw.slice(0, -postalMatch[0].length).trim().replace(/,\s*$/, '');
        }

        return {
          ent_num: parseInt(row[0], 10),
          add_num: parseInt(row[1], 10),
          address: (row[2] || '').replace(/^-0-\s*$/, '').trim(),
          city,
          state_province: stateProvince,
          postal_code: postalCode,
          country: (row[4] || '').replace(/^-0-\s*$/, '').trim(),
          add_remarks: (row[5] || '').replace(/^-0-\s*$/, '').trim(),
        };
      });

    // Parse comments/IDs (DOBs, passports, nationalities embedded in remarks)
    const commentRows = parseCSV(commentsText);

    // ── Transactional upsert ────────────────────────────────
    const insertTransaction = db.transaction(() => {
      // Clear existing data (full replace — Treasury provides complete list)
      db.prepare('DELETE FROM ofac_sdn_ids').run();
      db.prepare('DELETE FROM ofac_sdn_addresses').run();
      db.prepare('DELETE FROM ofac_sdn_aliases').run();
      db.prepare('DELETE FROM ofac_sdn_entries').run();

      // Insert SDN entries
      const insertEntry = db.prepare(`
        INSERT INTO ofac_sdn_entries (ent_num, sdn_name, sdn_type, program, source_list, title, remarks,
          call_sign, vessel_type, tonnage, grt, vessel_flag, vessel_owner, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const e of entries) {
        insertEntry.run(
          e.ent_num, e.sdn_name, e.sdn_type, e.program, e.source_list, e.title, e.remarks,
          e.call_sign, e.vessel_type, e.tonnage, e.grt, e.vessel_flag, e.vessel_owner, now
        );
      }

      // Insert aliases
      const insertAlias = db.prepare(`
        INSERT INTO ofac_sdn_aliases (ent_num, alt_num, alt_type, alt_name, alt_remarks)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const a of aliases) {
        insertAlias.run(a.ent_num, a.alt_num, a.alt_type, a.alt_name, a.alt_remarks);
      }

      // Insert addresses
      const insertAddress = db.prepare(`
        INSERT INTO ofac_sdn_addresses (ent_num, add_num, address, city, state_province, postal_code, country, add_remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const addr of addresses) {
        insertAddress.run(addr.ent_num, addr.add_num, addr.address, addr.city, addr.state_province, addr.postal_code, addr.country, addr.add_remarks);
      }

      // Parse and insert IDs from comments
      // sdn_comments.csv format: ent_num, remarks_field
      // Remarks contain structured data like:
      //   DOB 01 Jan 1960; POB Baghdad, Iraq; nationality Iraq; Passport A1234567
      const insertId = db.prepare(`
        INSERT INTO ofac_sdn_ids (ent_num, id_type, id_number, id_country, issue_date, expiration_date, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const row of commentRows) {
        if (row.length < 2 || !row[0] || isNaN(Number(row[0]))) continue;
        const entNum = parseInt(row[0], 10);
        const remarks = row.slice(1).join(',').trim();
        if (!remarks) continue;

        // Parse structured ID data from remarks
        const ids = parseRemarksToIds(entNum, remarks);
        for (const id of ids) {
          insertId.run(id.ent_num, id.id_type, id.id_number, id.id_country, id.issue_date, id.expiration_date, id.remarks);
        }
      }
    });

    insertTransaction();

    const duration = Date.now() - startTime;
    const stats = { entries: entries.length, aliases: aliases.length, addresses: addresses.length, duration };

    // Log sync result
    db.prepare(`
      INSERT INTO ofac_sync_log (source_url, entries_count, status, duration_ms, synced_at)
      VALUES (?, ?, 'success', ?, ?)
    `).run(sourceUrl, entries.length, duration, now);

    const listLabel = isConsolidated ? 'Consolidated' : 'SDN-only';
    console.log(`[OFAC Sync] ${listLabel} complete — ${entries.length} entries, ${aliases.length} aliases, ${addresses.length} addresses in ${duration}ms`);

    return stats;
  } catch (error: any) {
    const duration = Date.now() - startTime;

    db.prepare(`
      INSERT INTO ofac_sync_log (source_url, entries_count, status, error_message, duration_ms, synced_at)
      VALUES (?, 0, 'error', ?, ?, ?)
    `).run(CONS_PRIM_URL, error.message || 'Unknown error', duration, now);

    console.error('[OFAC Sync] Failed:', error.message);
    throw error;
  }
}

// ── Parse remarks string into structured ID records ─────────

interface ParsedId {
  ent_num: number;
  id_type: string;
  id_number: string;
  id_country: string | null;
  issue_date: string | null;
  expiration_date: string | null;
  remarks: string;
}

function parseRemarksToIds(entNum: number, remarks: string): ParsedId[] {
  const ids: ParsedId[] = [];

  // Split by semicolons — each segment may be an ID field
  const segments = remarks.split(';').map(s => s.trim()).filter(Boolean);

  for (const seg of segments) {
    const lower = seg.toLowerCase();

    if (lower.startsWith('dob ') || lower.startsWith('d.o.b.')) {
      ids.push({ ent_num: entNum, id_type: 'DOB', id_number: seg.replace(/^d\.?o\.?b\.?\s*/i, '').trim(), id_country: null, issue_date: null, expiration_date: null, remarks: seg });
    } else if (lower.startsWith('pob ') || lower.startsWith('p.o.b.')) {
      ids.push({ ent_num: entNum, id_type: 'POB', id_number: seg.replace(/^p\.?o\.?b\.?\s*/i, '').trim(), id_country: null, issue_date: null, expiration_date: null, remarks: seg });
    } else if (lower.startsWith('nationality')) {
      ids.push({ ent_num: entNum, id_type: 'NATIONALITY', id_number: seg.replace(/^nationality\s*/i, '').trim(), id_country: null, issue_date: null, expiration_date: null, remarks: seg });
    } else if (lower.startsWith('citizen')) {
      ids.push({ ent_num: entNum, id_type: 'CITIZENSHIP', id_number: seg.replace(/^citizen(ship)?\s*/i, '').trim(), id_country: null, issue_date: null, expiration_date: null, remarks: seg });
    } else if (lower.includes('passport')) {
      const match = seg.match(/passport\s*#?\s*(\S+)/i);
      const countryMatch = seg.match(/\(([^)]+)\)/);
      ids.push({
        ent_num: entNum, id_type: 'PASSPORT',
        id_number: match?.[1] || seg.replace(/^.*passport\s*#?\s*/i, '').trim(),
        id_country: countryMatch?.[1] || null,
        issue_date: null, expiration_date: null, remarks: seg,
      });
    } else if (lower.includes('national id') || lower.includes('cedula') || lower.includes('identification')) {
      const match = seg.match(/(?:national\s+id|cedula|identification)\s*(?:no\.?\s*)?#?\s*(\S+)/i);
      ids.push({
        ent_num: entNum, id_type: 'NATIONAL_ID',
        id_number: match?.[1] || seg,
        id_country: null, issue_date: null, expiration_date: null, remarks: seg,
      });
    } else if (lower.includes('ssn') || lower.includes('social security')) {
      ids.push({ ent_num: entNum, id_type: 'SSN', id_number: seg.replace(/^.*(?:ssn|social\s+security)\s*(?:no\.?\s*)?#?\s*/i, '').trim(), id_country: null, issue_date: null, expiration_date: null, remarks: seg });
    } else if (lower.includes('tax id') || lower.includes('tin ') || lower.match(/\btax\b/)) {
      ids.push({ ent_num: entNum, id_type: 'TAX_ID', id_number: seg.replace(/^.*(?:tax\s*id|tin)\s*(?:no\.?\s*)?#?\s*/i, '').trim(), id_country: null, issue_date: null, expiration_date: null, remarks: seg });
    } else if (lower.startsWith('alt.') || lower.startsWith('a.k.a.') || lower.startsWith('aka')) {
      ids.push({ ent_num: entNum, id_type: 'AKA', id_number: seg.replace(/^(?:alt\.?|a\.?k\.?a\.?)\s*/i, '').trim(), id_country: null, issue_date: null, expiration_date: null, remarks: seg });
    } else if (seg.length > 3) {
      // Catch-all for other structured data
      ids.push({ ent_num: entNum, id_type: 'OTHER', id_number: seg, id_country: null, issue_date: null, expiration_date: null, remarks: seg });
    }
  }

  return ids;
}

// ── SDN type normalizer ─────────────────────────────────────

function normalizeSdnType(raw: string): string {
  const lower = (raw || '').toLowerCase().trim();
  if (lower.includes('individual')) return 'individual';
  if (lower.includes('entity')) return 'entity';
  if (lower.includes('vessel')) return 'vessel';
  if (lower.includes('aircraft')) return 'aircraft';
  // Treasury uses "-0-" for entities (organizations, governments, etc.)
  if (lower === '-0-' || lower === '' || lower === 'unknown') return 'entity';
  return lower;
}

// ── Source list derivation from program field ───────────────
// The consolidated CSV's "program" column contains one or more
// program codes separated by semicolons, e.g. "SDGT; IRAN".
// We extract the primary list category from the first code.

function deriveSourceList(program: string, isConsolidated: boolean): string {
  if (!isConsolidated) return 'SDN';
  const firstProg = (program || '').split(';')[0].trim().toUpperCase();
  if (!firstProg || firstProg === '-0-') return 'SDN';
  // Map known program prefixes to list categories
  if (firstProg.startsWith('SSI')) return 'SSI';       // Sectoral Sanctions
  if (firstProg.startsWith('FSE')) return 'FSE';       // Foreign Sanctions Evaders
  if (firstProg === 'PLC' || firstProg.startsWith('PLC')) return 'PLC'; // Palestinian Legislative Council
  if (firstProg.startsWith('CAPTA')) return 'CAPTA';   // CAPTA List
  if (firstProg.startsWith('NS-')) return 'NS-MBS';    // Non-SDN Menu-Based Sanctions
  if (firstProg.startsWith('CMIC')) return 'CMIC';     // Chinese Military-Industrial Complex
  // Most programs (SDGT, IRAN, SYRIA, etc.) are on the core SDN list
  return 'SDN';
}

// ── List breakdown for admin dashboard ──────────────────────

export function getOfacListBreakdown(): { list: string; count: number }[] {
  const db = getDb();
  try {
    return db.prepare(
      "SELECT COALESCE(source_list, 'SDN') as list, COUNT(*) as count FROM ofac_sdn_entries GROUP BY source_list ORDER BY count DESC"
    ).all() as { list: string; count: number }[];
  } catch {
    // source_list column may not exist yet (pre-migration)
    const total = (db.prepare('SELECT COUNT(*) as count FROM ofac_sdn_entries').get() as any)?.count || 0;
    return [{ list: 'SDN', count: total }];
  }
}

// ── Local Search Engine ─────────────────────────────────────

export interface OfacSearchResult {
  ent_num: number;
  sdn_name: string;
  sdn_type: string;
  program: string;
  source_list: string;
  title: string;
  remarks: string;
  match_source: 'primary_name' | 'alias';
  match_score: number;
  aliases: { alt_name: string; alt_type: string }[];
  addresses: { address: string; city: string; state_province: string; country: string; postal_code: string }[];
  ids: { id_type: string; id_number: string; id_country: string | null; remarks: string }[];
}

export function searchOfacLocal(query: string, options?: {
  type?: 'person' | 'entity' | 'all';
  firstName?: string;
  lastName?: string;
  limit?: number;
}): OfacSearchResult[] {
  const db = getDb();
  const limit = options?.limit || 50;

  // Build search name from structured input or raw query
  let searchName = query.trim();
  if (options?.lastName && options?.firstName) {
    searchName = `${options.lastName}, ${options.firstName}`;
  } else if (options?.lastName) {
    searchName = options.lastName;
  }

  if (!searchName) return [];

  // Normalize for search
  const normalized = searchName.toUpperCase().replace(/[^A-Z0-9\s]/g, '');
  const words = normalized.split(/\s+/).filter(w => w.length > 1);
  if (words.length === 0) return [];

  // Build LIKE conditions — match ANY word in name
  const likeConditions = words.map(() => 'UPPER(name) LIKE ?').join(' AND ');
  const likeParams = words.map(w => `%${w}%`);

  // Type filter (handle legacy '-0-' values that haven't been re-synced yet)
  let typeFilter = '';
  if (options?.type === 'person') typeFilter = "AND e.sdn_type = 'individual'";
  else if (options?.type === 'entity') typeFilter = "AND e.sdn_type IN ('entity', '-0-')";

  // Search primary names + aliases in a UNION
  const sql = `
    SELECT e.ent_num, e.sdn_name, e.sdn_type, e.program, COALESCE(e.source_list, 'SDN') as source_list, e.title, e.remarks,
           'primary_name' as match_source, name as matched_name
    FROM ofac_sdn_entries e,
         (SELECT ent_num, sdn_name as name FROM ofac_sdn_entries
          WHERE ${likeConditions.replace(/name/g, 'sdn_name')}) m
    WHERE e.ent_num = m.ent_num ${typeFilter}

    UNION

    SELECT e.ent_num, e.sdn_name, e.sdn_type, e.program, COALESCE(e.source_list, 'SDN') as source_list, e.title, e.remarks,
           'alias' as match_source, a.alt_name as matched_name
    FROM ofac_sdn_entries e
    JOIN ofac_sdn_aliases a ON e.ent_num = a.ent_num
    WHERE ${likeConditions.replace(/name/g, 'a.alt_name')} ${typeFilter}

    LIMIT ?
  `;

  const allParams = [...likeParams, ...likeParams, limit];

  let rows: any[];
  try {
    rows = db.prepare(sql).all(...allParams);
  } catch {
    // Fallback: simple single-table search
    rows = db.prepare(`
      SELECT ent_num, sdn_name, sdn_type, program, COALESCE(source_list, 'SDN') as source_list, title, remarks,
             'primary_name' as match_source, sdn_name as matched_name
      FROM ofac_sdn_entries
      WHERE ${likeConditions.replace(/name/g, 'sdn_name')} ${typeFilter}
      LIMIT ?
    `).all(...likeParams, limit);
  }

  // Deduplicate by ent_num (prefer primary_name match)
  const seen = new Map<number, any>();
  for (const row of rows) {
    if (!seen.has(row.ent_num) || row.match_source === 'primary_name') {
      seen.set(row.ent_num, row);
    }
  }

  // Enrich each result with aliases, addresses, IDs
  const results: OfacSearchResult[] = [];
  for (const row of seen.values()) {
    const aliases = db.prepare(
      'SELECT alt_name, alt_type FROM ofac_sdn_aliases WHERE ent_num = ?'
    ).all(row.ent_num) as { alt_name: string; alt_type: string }[];

    const addresses = db.prepare(
      'SELECT address, city, state_province, country, postal_code FROM ofac_sdn_addresses WHERE ent_num = ?'
    ).all(row.ent_num) as { address: string; city: string; state_province: string; country: string; postal_code: string }[];

    const ids = db.prepare(
      'SELECT id_type, id_number, id_country, remarks FROM ofac_sdn_ids WHERE ent_num = ?'
    ).all(row.ent_num) as { id_type: string; id_number: string; id_country: string | null; remarks: string }[];

    // Simple relevance score: more matching words = higher score
    const nameUpper = (row.matched_name || row.sdn_name).toUpperCase();
    let score = 0;
    for (const w of words) {
      if (nameUpper.includes(w)) score += 1;
    }
    // Exact match bonus
    if (nameUpper === normalized || nameUpper.replace(/[^A-Z0-9\s]/g, '') === normalized) {
      score += 5;
    }

    results.push({
      ent_num: row.ent_num,
      sdn_name: row.sdn_name,
      sdn_type: row.sdn_type,
      program: row.program,
      source_list: row.source_list || 'SDN',
      title: row.title,
      remarks: row.remarks,
      match_source: row.match_source,
      match_score: score,
      aliases,
      addresses,
      ids,
    });
  }

  // Sort by relevance score descending
  results.sort((a, b) => b.match_score - a.match_score);

  return results;
}

// ── Sync Status ─────────────────────────────────────────────

export function getOfacSyncStatus(): {
  lastSync: string | null;
  entriesCount: number;
  status: string;
  lastError: string | null;
} {
  const db = getDb();

  const lastLog = db.prepare(
    "SELECT status, entries_count, error_message, synced_at FROM ofac_sync_log ORDER BY id DESC LIMIT 1"
  ).get() as { status: string; entries_count: number; error_message: string | null; synced_at: string } | undefined;

  const entryCount = (db.prepare('SELECT COUNT(*) as count FROM ofac_sdn_entries').get() as any)?.count || 0;

  return {
    lastSync: lastLog?.synced_at || null,
    entriesCount: entryCount,
    status: lastLog?.status || 'never_synced',
    lastError: lastLog?.status === 'error' ? lastLog.error_message : null,
  };
}

export function isOfacDataStale(): boolean {
  const db = getDb();
  const lastSuccess = db.prepare(
    "SELECT synced_at FROM ofac_sync_log WHERE status = 'success' ORDER BY id DESC LIMIT 1"
  ).get() as { synced_at: string } | undefined;

  if (!lastSuccess) return true;

  const lastSyncTime = new Date(lastSuccess.synced_at).getTime();
  return Date.now() - lastSyncTime > SYNC_INTERVAL_MS;
}

// ── Scheduler ───────────────────────────────────────────────

export function scheduleOfacSync(): void {
  if (syncIntervalHandle) return; // Already running

  console.log('[OFAC Sync] Scheduler starting — will sync daily');

  // Check on startup if data is stale
  setTimeout(async () => {
    try {
      if (isOfacDataStale()) {
        console.log('[OFAC Sync] Data is stale or missing — triggering initial sync...');
        await syncOfacData();
      } else {
        const status = getOfacSyncStatus();
        console.log(`[OFAC Sync] Data is current (${status.entriesCount} entries, last sync: ${status.lastSync})`);
      }
    } catch (err: any) {
      console.error('[OFAC Sync] Initial sync failed — will retry in 24h:', err?.message || "Unknown error");
    }
  }, 15_000); // Wait 15s after server start to avoid blocking startup

  // Daily sync — .unref() so it doesn't prevent graceful shutdown
  syncIntervalHandle = setInterval(async () => {
    try {
      console.log('[OFAC Sync] Daily scheduled sync...');
      await syncOfacData();
    } catch (err: any) {
      console.error('[OFAC Sync] Scheduled sync failed:', err?.message || "Unknown error");
    }
  }, SYNC_INTERVAL_MS);
  syncIntervalHandle.unref();
}

export function stopOfacSync(): void {
  if (syncIntervalHandle) {
    clearInterval(syncIntervalHandle);
    syncIntervalHandle = null;
    console.log('[OFAC Sync] Scheduler stopped');
  }
}
