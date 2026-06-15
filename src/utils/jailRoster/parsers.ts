// ============================================================
// Jail Roster — county parsers (Worker-safe port of legacy jailRosterScraper).
// Each parser fetches a county's public jail roster and returns RosterEntry[].
// Phase 1 ships Salt Lake County (verified live 2026-06-15); the registry is
// the extension seam — add a county = add a CountyParser here + a seed row.
// All parsers use fetch + regex/JSON (no DOM/cheerio) so they run on Workers.
// ============================================================

const USER_AGENT = 'Mozilla/5.0 (compatible; RMPG-Flex/1.0; +https://rmpgutah.us)';
const REQUEST_TIMEOUT_MS = 20000;

export interface RosterEntry {
  roster_id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  middle_name: string;
  gender: string;
  booking_date: string;
  date_of_birth?: string;
  charges: string[];
  bail_amount: string;
  // Source-system detail tokens. For Salt Lake's IML these identify the inmate's
  // full profile document so the orchestrator can fetch + scrape it later (the
  // listing only carries name + booking #). Stored in arrest_records.raw_record.
  sys_id?: string;
  img_sys_id?: string;
}

// Full per-inmate detail scraped from a county's profile/print document — the
// rich data the search listing omits (booking date, charges, bond). Captured
// into arrest_records columns + raw_record. Fields are '' / [] / 0 when absent.
export interface InmateDetail {
  booking_date: string;        // ISO 'YYYY-MM-DD'
  charges: string[];           // 'CODE — DESCRIPTION'
  bail_amount: number;         // summed bond amounts
  so_number: string;
  housing: string;             // 'LOCATION / BLOCK / CELL / BED'
  projected_release: string;   // ISO 'YYYY-MM-DD'
}

// ISO timestamp -> 'YYYY-MM-DD' (empty on bad input).
function isoDate(v: unknown): string {
  if (typeof v !== 'string' || !v) return '';
  const t = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '';
}

// 'MM/DD/YYYY' (the IML profile date format) -> ISO 'YYYY-MM-DD' (empty if no match).
export function mdyToIso(s: string | null | undefined): string {
  const m = (s ?? '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

export interface CountyParser {
  // Fetch + parse the full current roster for the county. Throws on hard failure
  // (network/format) so the orchestrator can trip the circuit breaker.
  scrape(): Promise<RosterEntry[]>;
}

// "LAST , FIRST MIDDLE" -> parts. Tolerant of the ragged whitespace the county
// roster HTML uses ("ATWOOD              , COREY JAMES").
export function splitName(raw: string): { first: string; middle: string; last: string } {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  const comma = cleaned.indexOf(',');
  if (comma === -1) {
    const parts = cleaned.split(' ');
    return { first: parts[0] || '', middle: parts.slice(1, -1).join(' '), last: parts[parts.length - 1] || '' };
  }
  const last = cleaned.slice(0, comma).trim();
  const rest = cleaned.slice(comma + 1).trim().split(' ');
  return { first: rest[0] || '', middle: rest.slice(1).join(' '), last };
}

// Strip tags + collapse whitespace from a table cell's inner HTML.
function cellText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

// ── Salt Lake County (iml.saltlakecounty.gov) ───────────────
// Inmate Lookup Tool — POST per last-name letter, paginated by 500. Rows are
// <tr onClick="rowClicked('n','sysID','imgID')">. Verified live 2026-06-15.
export const saltLakeParser: CountyParser = {
  async scrape(): Promise<RosterEntry[]> {
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
    const seen = new Set<string>();
    const entries: RosterEntry[] = [];
    const rowRegex = /<tr[^>]*onClick="rowClicked\('[^']*','(\d+)','(\d+)'\)"[^>]*>([\s\S]*?)<\/tr>/gi;

    for (const letter of letters) {
      // One page per letter (pageSize 500 covers a letter for this jail).
      let html: string;
      try {
        const res = await fetch('https://iml.saltlakecounty.gov/IML', {
          method: 'POST',
          headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            flow_action: 'searchbyname', quantity: '500',
            systemUser_firstName: '', systemUser_lastName: letter,
            systemUser_includereleasedinmate: 'N', systemUser_includereleasedinmate2: 'N',
            currentStart: '1',
          }).toString(),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) continue;
        html = await res.text();
      } catch {
        continue; // skip a flaky letter rather than fail the whole scrape
      }

      let m: RegExpExecArray | null;
      while ((m = rowRegex.exec(html)) !== null) {
        const sysId = m[1];
        const imgSysId = m[2];
        const cells: string[] = [];
        const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let td: RegExpExecArray | null;
        while ((td = tdRe.exec(m[3])) !== null) cells.push(cellText(td[1]));
        if (cells.length < 2) continue;

        const rawName = cells[0] || '';
        const bookingNumber = (cells[1] || '').trim();
        const key = bookingNumber || sysId;
        if (seen.has(key)) continue;
        seen.add(key);

        const { first, middle, last } = splitName(rawName);
        entries.push({
          roster_id: key, full_name: rawName.replace(/\s+/g, ' ').trim(),
          first_name: first, last_name: last, middle_name: middle,
          gender: '', booking_date: '', charges: [], bail_amount: '',
          // Detail tokens for the per-inmate profile fetch (enrichment phase).
          sys_id: sysId, img_sys_id: imgSysId,
        });
      }
    }
    return entries;
  },
};

// ── Salt Lake County — full inmate detail document ──────────
// IML serves each inmate's full record as a print-styled profile page
// (flow_action=edit), NOT a downloadable PDF. Reaching it requires, in one
// session: (1) a JSESSIONID cookie, (2) a Referer header, and (3) at least one
// prior search to "arm" the edit flow (verified live 2026-06-15). sysIDs are
// stable across sessions, so the listing stores them and this enriches later.
const IML_BASE = 'https://iml.saltlakecounty.gov/IML';

function jsessionid(res: Response): string {
  const h = res.headers as unknown as { getSetCookie?: () => string[] };
  const raw = typeof h.getSetCookie === 'function'
    ? h.getSetCookie().join('; ')
    : (res.headers.get('set-cookie') || '');
  const m = raw.match(/JSESSIONID=[^;]+/);
  return m ? m[0] : '';
}

async function imlPost(cookie: string, fields: Record<string, string>): Promise<string> {
  const res = await fetch(IML_BASE, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: IML_BASE,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`IML HTTP ${res.status}`);
  return res.text();
}

// Open an IML session and arm the detail flow with one warmup search, returning
// the session cookie to reuse across detail fetches.
export async function openSaltLakeSession(): Promise<string> {
  const res = await fetch(IML_BASE, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const cookie = jsessionid(res);
  await res.text().catch(() => '');
  // A search (any letter) is required before flow_action=edit returns data.
  await imlPost(cookie, {
    flow_action: 'searchbyname', quantity: '500',
    systemUser_firstName: '', systemUser_lastName: 'a',
    systemUser_includereleasedinmate: 'N', systemUser_includereleasedinmate2: 'N',
    currentStart: '1',
  });
  return cookie;
}

// Fetch + parse one inmate's full profile document. Returns null when the
// document is blank (session lost / inmate released / sysID rotated).
export async function fetchSaltLakeDetail(
  cookie: string, sysID: string, imgSysID: string,
): Promise<InmateDetail | null> {
  let html: string;
  try {
    html = await imlPost(cookie, { flow_action: 'edit', sysID, imgSysID });
  } catch {
    return null;
  }
  const detail = parseInmateProfile(html);
  if (!detail.booking_date && detail.charges.length === 0 && !detail.so_number && !detail.housing) {
    return null; // empty template — nothing scraped
  }
  return detail;
}

// Pull the value cell that follows a labelled (class="bodysmallbold") cell.
function profileField(html: string, label: string): string {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `class="bodysmallbold"[^>]*>[\\s\\S]*?${esc}[\\s\\S]*?<\\/td>\\s*<td[^>]*class="bodysmall"[^>]*>([\\s\\S]*?)<\\/td>`,
    'i',
  );
  const m = html.match(re);
  return m ? cellText(m[1]) : '';
}

// Extract the rows of a labelled section's table as arrays of cell text.
function sectionRows(html: string, startLabel: string, endLabel: string): string[][] {
  const start = html.search(new RegExp(startLabel, 'i'));
  if (start === -1) return [];
  const tail = html.slice(start);
  const endIdx = endLabel ? tail.slice(startLabel.length).search(new RegExp(endLabel, 'i')) : -1;
  const seg = endIdx === -1 ? tail : tail.slice(0, startLabel.length + endIdx);
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(seg)) !== null) {
    const cells: string[] = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(tr[1])) !== null) cells.push(cellText(td[1]));
    if (cells.some((c) => c)) rows.push(cells);
  }
  return rows;
}

// PURE parser for an IML inmate profile document. Unit-tested against a live
// fixture. Charge cols: [Case#, OffenseDate, Code, Description, Grade, Degree].
// Bond cols (after dropping empties): [Amount, Status, SetDate].
export function parseInmateProfile(html: string): InmateDetail {
  const booking_date = mdyToIso(profileField(html, 'Booking Date:'));
  const so_number = profileField(html, 'SO#:');
  const projected_release = mdyToIso(profileField(html, 'Projected Release Date:'));

  const housing = [
    profileField(html, 'Current Location:'),
    profileField(html, 'Current Housing Block:'),
    profileField(html, 'Current Housing Cell:'),
    profileField(html, 'Current Housing Bed:'),
  ].map((s) => s.trim()).filter(Boolean).join(' / ');

  const charges: string[] = [];
  for (const cells of sectionRows(html, 'Charge Information', 'Copyright')) {
    if (cells.length < 4) continue;                       // &nbsp; / spacer rows
    const code = (cells[2] || '').trim();
    const desc = (cells[3] || '').trim();
    if (!code && !desc) continue;
    if (/^code$/i.test(code) || /offense date/i.test(cells[1] || '')) continue; // header
    charges.push(code && desc ? `${code} — ${desc}` : (desc || code));
  }

  let bail_amount = 0;
  for (const cells of sectionRows(html, 'Bond Information', 'Charge Information')) {
    // The amount is the cell holding a decimal money value (e.g. "¤ 1,000.00").
    // Case # is a bare integer and the Set Date has no ".dd", so neither matches
    // — this avoids summing case numbers as dollars. One amount per row.
    for (const c of cells) {
      const m = c.match(/[\d,]+\.\d{2}/);
      if (m) { bail_amount += parseFloat(m[0].replace(/,/g, '')); break; }
    }
  }

  return { booking_date, charges, bail_amount, so_number, housing, projected_release };
}

// ── Utah County (sheriff.utahcounty.gov JSON API) ───────────
// /api/search/name/<letter> returns all inmates whose name matches; status 'A'
// = currently in custody. Verified live 2026-06-15. JSON (no HTML parsing).
export const utahCountyParser: CountyParser = {
  async scrape(): Promise<RosterEntry[]> {
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
    const seen = new Set<string>();
    const entries: RosterEntry[] = [];

    for (const letter of letters) {
      let data: unknown;
      try {
        const res = await fetch(`https://sheriff.utahcounty.gov/api/search/name/${letter}`, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) continue;
        data = await res.json();
      } catch {
        continue;
      }
      if (!Array.isArray(data)) continue;

      for (const raw of data as Array<Record<string, unknown>>) {
        if (String(raw.status ?? '').toUpperCase() !== 'A') continue; // active only
        const id = String(raw.id ?? raw.zid ?? '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const rawName = String(raw.name ?? '').trim();
        const { first, middle, last } = splitName(rawName);
        entries.push({
          roster_id: id, full_name: rawName.replace(/\s+/g, ' ').trim(),
          first_name: first, last_name: last, middle_name: middle,
          gender: '', booking_date: isoDate(raw.date_in), date_of_birth: isoDate(raw.dob),
          charges: [], bail_amount: '',
        });
      }
    }
    return entries;
  },
};

// Parser registry — county key -> parser. The orchestrator looks counties up
// here; a county in jail_roster_config with no registered parser is skipped
// (auto-disabled by the orchestrator) rather than crashing.
export const COUNTY_PARSERS: Record<string, CountyParser> = {
  salt_lake: saltLakeParser,
  utah: utahCountyParser,
};

export function getAvailableParsers(): string[] {
  return Object.keys(COUNTY_PARSERS);
}
