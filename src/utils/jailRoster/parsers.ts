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
}

// ISO timestamp -> 'YYYY-MM-DD' (empty on bad input).
function isoDate(v: unknown): string {
  if (typeof v !== 'string' || !v) return '';
  const t = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '';
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
        });
      }
    }
    return entries;
  },
};

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
