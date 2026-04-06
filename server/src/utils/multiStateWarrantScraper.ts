// ============================================================
// Multi-State Warrant Scraper
// ============================================================
// Scrapes active warrant / most-wanted lists from county sheriff
// websites across UT, CO, WY, ID, NV, AZ, NM, MT + federal (FBI). Also extracts
// warrant-related bookings from existing arrest_records.
//
// Complements the existing Utah-only warrants.utah.gov live-search
// (utahWarrantScraper.ts) by providing scheduled bulk scraping of
// county-published warrant pages across all configured states.
//
// Architecture (mirrors jailRosterScraper.ts):
//   - warrant_scraper_config table for source configuration
//   - scraped_warrants table for unified warrant cache
//   - Per-source parsers implement WarrantParser interface
//   - Circuit breaker + exponential backoff for failed sources
//   - Cross-links against persons table
//   - Scheduler: per-source configurable intervals
// ============================================================

import { getDb } from '../models/database';
import { localNow } from './timeUtils';

// ── Constants ───────────────────────────────────────────────

const USER_AGENT = 'RMPG-Flex/1.0 (Law Enforcement CAD/RMS)';
const REQUEST_TIMEOUT_MS = 15_000;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const STARTUP_DELAY_MS = 60_000;          // 60s after boot (let jail roster start first)
const BACKOFF_BASE_MS = 60 * 60_000;      // 1 hour
const BACKOFF_MAX_MS = 24 * 60 * 60_000;  // 24 hour cap

// ── Interfaces ──────────────────────────────────────────────

export interface WarrantEntry {
  warrant_id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  middle_name: string;
  date_of_birth: string;
  age: number | null;
  gender: string;
  race: string;
  city: string;
  state: string;
  warrant_type: string;       // arrest, bench, search, civil, fugitive
  case_number: string;
  court_name: string;
  issue_date: string;
  charge_description: string;
  bail_amount: string;
  offense_level: string;      // felony, misdemeanor, etc.
  photo_url: string;
  detail_url: string;
}

interface WarrantParser {
  sourceKey: string;
  parseWarrants(content: string): WarrantEntry[];
}

interface WarrantSourceConfig {
  id: number;
  source_key: string;
  display_name: string;
  source_url: string | null;
  source_type: string;
  state: string;
  county: string | null;
  enabled: number;
  scrape_interval_minutes: number;
  last_scrape_at: string | null;
  consecutive_errors: number;
  circuit_broken: number;
}

// ── Scheduler state ─────────────────────────────────────────

const sourceIntervals = new Map<string, ReturnType<typeof setInterval>>();
const backoffTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const backoffAttempts = new Map<string, number>();
let startupTimeout: ReturnType<typeof setTimeout> | null = null;

// ── HTTP helpers ────────────────────────────────────────────

async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Name splitter ───────────────────────────────────────────

function splitName(fullName: string): { first: string; middle: string; last: string } {
  const cleaned = (fullName || '').trim();
  if (!cleaned) return { first: '', middle: '', last: '' };
  if (cleaned.includes(',')) {
    const [last, rest] = cleaned.split(',', 2).map(s => s.trim());
    const parts = (rest || '').split(/\s+/);
    return { first: parts[0] || '', middle: parts.slice(1).join(' '), last };
  }
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], middle: '', last: '' };
  if (parts.length === 2) return { first: parts[0], middle: '', last: parts[1] };
  return { first: parts[0], middle: parts.slice(1, -1).join(' '), last: parts[parts.length - 1] };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '').trim();
}

// ════════════════════════════════════════════════════════════
//  GENERIC WARRANT PAGE PARSER
// ════════════════════════════════════════════════════════════
// Most sheriff warrant pages list wanted persons in HTML tables
// or card-style divs. This generic parser handles common patterns.

function createGenericWarrantParser(sourceKey: string): WarrantParser {
  return {
    sourceKey,
    parseWarrants(html: string): WarrantEntry[] {
      const entries: WarrantEntry[] = [];
      const stateCode = sourceKey.split('_')[0]?.toUpperCase() || '';

      // Strategy 1: Look for table rows with warrant data
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let match: RegExpExecArray | null;
      let tableRows = 0;

      while ((match = rowRegex.exec(html)) !== null) {
        const rowHtml = match[1];
        const cells: string[] = [];
        const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let tdMatch: RegExpExecArray | null;
        while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
          cells.push(stripHtml(tdMatch[1]));
        }
        if (cells.length < 2) continue;

        // Skip header rows
        if (cells[0].match(/^(Name|Inmate|Defendant|Subject|Warrant|#|ID)$/i)) continue;

        tableRows++;

        // Try to extract name and warrant info from cells
        let nameCell = '';
        let charges = '';
        let caseNum = '';
        let warrantType = '';
        let issueDate = '';
        let bail = '';

        for (const cell of cells) {
          if (!nameCell && cell.match(/[A-Z]{2,}/i) && (cell.includes(',') || cell.includes(' '))) {
            if (!cell.match(/^\d/) && cell.length > 3 && cell.length < 60) {
              nameCell = cell;
            }
          } else if (cell.match(/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/)) {
            issueDate = cell;
          } else if (cell.match(/\$([\d,.]+)/) || cell.match(/^\$?\d{1,3}(,\d{3})*(\.\d{2})?$/)) {
            bail = cell;
          } else if (cell.match(/(warrant|bench|arrest|fugitive|FTA|failure)/i)) {
            warrantType = cell;
          } else if (cell.match(/(case|CR|CF|MC|CV|DR)-?\d/i) || cell.match(/^\d{2,4}-[A-Z]{1,3}-\d+$/i)) {
            caseNum = cell;
          } else if (cell.length > 10 && !charges) {
            charges = cell;
          }
        }

        if (!nameCell) continue;

        const { first, middle, last } = splitName(nameCell);
        const wId = `${sourceKey}-${last}-${first}-${caseNum || issueDate || tableRows}`.replace(/[^a-zA-Z0-9-]/g, '').substring(0, 80);

        entries.push({
          warrant_id: wId,
          full_name: nameCell,
          first_name: first,
          last_name: last,
          middle_name: middle,
          date_of_birth: '',
          age: null,
          gender: '',
          race: '',
          city: '',
          state: stateCode,
          warrant_type: warrantType || 'arrest',
          case_number: caseNum,
          court_name: '',
          issue_date: issueDate,
          charge_description: charges,
          bail_amount: bail,
          offense_level: '',
          photo_url: '',
          detail_url: '',
        });
      }

      // Strategy 2: If no table rows found, try card/div patterns
      if (entries.length === 0) {
        // Look for "wanted" card patterns — name in h2/h3/strong tags
        const cardRegex = /<(?:div|article|section)[^>]*class="[^"]*(?:wanted|warrant|card|person|suspect)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|article|section)>/gi;
        let cardMatch: RegExpExecArray | null;
        let cardIdx = 0;

        while ((cardMatch = cardRegex.exec(html)) !== null) {
          const cardHtml = cardMatch[1];
          cardIdx++;

          // Extract name from heading tags
          const nameMatch = cardHtml.match(/<(?:h[1-6]|strong|b)[^>]*>([\s\S]*?)<\/(?:h[1-6]|strong|b)>/i);
          if (!nameMatch) continue;

          const nameText = stripHtml(nameMatch[1]);
          if (nameText.length < 3 || nameText.length > 60) continue;

          // Extract image
          const imgMatch = cardHtml.match(/<img[^>]+src="([^"]+)"/i);
          const photoUrl = imgMatch ? imgMatch[1] : '';

          // Extract charges/description
          const descText = stripHtml(cardHtml.replace(nameMatch[0], ''));
          const chargeMatch = descText.match(/(?:charge|offense|crime|wanted for)[:\s]*(.+?)(?:\.|$)/i);

          const { first, middle, last } = splitName(nameText);
          const wId = `${sourceKey}-${last}-${first}-${cardIdx}`.replace(/[^a-zA-Z0-9-]/g, '').substring(0, 80);

          entries.push({
            warrant_id: wId,
            full_name: nameText,
            first_name: first,
            last_name: last,
            middle_name: middle,
            date_of_birth: '',
            age: null,
            gender: '',
            race: '',
            city: '',
            state: stateCode,
            warrant_type: 'arrest',
            case_number: '',
            court_name: '',
            issue_date: '',
            charge_description: chargeMatch ? chargeMatch[1].trim() : '',
            bail_amount: '',
            offense_level: '',
            photo_url: photoUrl,
            detail_url: '',
          });
        }
      }

      return entries;
    },
  };
}


// ════════════════════════════════════════════════════════════
//  ARREST RECORD WARRANT EXTRACTOR
// ════════════════════════════════════════════════════════════
// Mines existing arrest_records for warrant-related bookings.
// This is the highest-ROI source because we already have this data.

const WARRANT_CHARGE_PATTERNS = [
  /\bwarrant\b/i,
  /\bFTA\b/,                          // Failure to Appear
  /\bfailure to appear\b/i,
  /\bbench\s*warrant\b/i,
  /\bfugitive\b/i,
  /\bbail\s*(?:jump|skip|violation)\b/i,
  /\bextradition\b/i,
  /\bparole\s*violation\b/i,
  /\bprobation\s*violation\b/i,
  /\bout of county\b.*\bwarrant\b/i,
  /\bhold for\b/i,
  /\bdetainer\b/i,
];

function extractWarrantsFromArrestRecords(): WarrantEntry[] {
  const db = getDb();
  const entries: WarrantEntry[] = [];

  try {
    // Get all active arrest records with their charges
    const records = db.prepare(`
      SELECT id, full_name, first_name, last_name, middle_name,
             date_of_birth, gender, race, charges, booking_date,
             county, state, bail_amount, booking_number, agency
      FROM arrest_records
      WHERE status = 'active'
        AND charges IS NOT NULL AND charges != '' AND charges != '[]'
      ORDER BY booking_date DESC
    `).all() as {
      id: number; full_name: string; first_name: string; last_name: string;
      middle_name: string; date_of_birth: string; gender: string; race: string;
      charges: string; booking_date: string; county: string; state: string;
      bail_amount: string; booking_number: string; agency: string;
    }[];

    for (const rec of records) {
      let chargesArr: string[] = [];
      try {
        const parsed = JSON.parse(rec.charges);
        chargesArr = Array.isArray(parsed) ? parsed : [String(parsed)];
      } catch {
        chargesArr = [rec.charges];
      }

      // Check each charge for warrant patterns
      const warrantCharges = chargesArr.filter(charge =>
        WARRANT_CHARGE_PATTERNS.some(pattern => pattern.test(charge))
      );

      if (warrantCharges.length === 0) continue;

      // Determine warrant type from charge text
      let warrantType = 'arrest';
      const chargeText = warrantCharges.join(' ').toLowerCase();
      if (chargeText.includes('bench') || chargeText.includes('fta') || chargeText.includes('failure to appear')) {
        warrantType = 'bench';
      } else if (chargeText.includes('fugitive') || chargeText.includes('extradition')) {
        warrantType = 'fugitive';
      } else if (chargeText.includes('parole') || chargeText.includes('probation')) {
        warrantType = 'parole_violation';
      }

      const wId = `arrest-${rec.id}-${rec.booking_number || rec.booking_date}`.replace(/[^a-zA-Z0-9-]/g, '').substring(0, 80);

      entries.push({
        warrant_id: wId,
        full_name: rec.full_name || `${rec.first_name} ${rec.last_name}`.trim(),
        first_name: rec.first_name || '',
        last_name: rec.last_name || '',
        middle_name: rec.middle_name || '',
        date_of_birth: rec.date_of_birth || '',
        age: null,
        gender: rec.gender || '',
        race: rec.race || '',
        city: '',
        state: rec.state || 'UT',
        warrant_type: warrantType,
        case_number: rec.booking_number || '',
        court_name: rec.agency || '',
        issue_date: rec.booking_date || '',
        charge_description: warrantCharges.join('; '),
        bail_amount: rec.bail_amount || '',
        offense_level: '',
        photo_url: '',
        detail_url: '',
      });
    }
  } catch (err) {
    console.error('[Warrant Scraper] Arrest record extraction error:', (err as Error).message);
  }

  return entries;
}


// ════════════════════════════════════════════════════════════
//  SPECIFIC STATE/COUNTY PARSERS
// ════════════════════════════════════════════════════════════

// ── El Paso County, CO ──────────────────────────────────────
// Sheriff publishes active warrants list

const elPasoCoWarrantParser: WarrantParser = {
  sourceKey: 'co_el_paso_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let match: RegExpExecArray | null;

    while ((match = rowRegex.exec(html)) !== null) {
      const cells: string[] = [];
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = tdRe.exec(match[1])) !== null) {
        cells.push(stripHtml(tdMatch[1]));
      }
      if (cells.length < 2) continue;
      if (cells[0].match(/^(Name|Defendant|Subject|Last)$/i)) continue;

      let nameCell = '';
      let charges = '';
      let caseNum = '';
      let warrantType = '';
      let issueDate = '';
      let bail = '';
      let dob = '';

      for (const cell of cells) {
        if (!nameCell && cell.includes(',') && cell.match(/[A-Z]/i) && cell.length > 3) {
          nameCell = cell;
        } else if (cell.match(/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/) && !issueDate) {
          if (!dob && cell.match(/\b(19|20)\d{2}/)) dob = cell;
          else issueDate = cell;
        } else if (cell.match(/\$[\d,.]+/)) {
          bail = cell;
        } else if (cell.match(/(warrant|bench|arrest|FTA)/i)) {
          warrantType = cell;
        } else if (cell.length > 5 && !charges) {
          charges = cell;
        }
      }
      if (!nameCell) continue;

      const { first, middle, last } = splitName(nameCell);
      const wId = `epc-${last}-${first}-${caseNum || entries.length}`.replace(/[^a-zA-Z0-9-]/g, '');

      entries.push({
        warrant_id: wId, full_name: nameCell, first_name: first, last_name: last,
        middle_name: middle, date_of_birth: dob, age: null, gender: '', race: '',
        city: '', state: 'CO', warrant_type: warrantType || 'arrest',
        case_number: caseNum, court_name: 'El Paso County Court',
        issue_date: issueDate, charge_description: charges, bail_amount: bail,
        offense_level: '', photo_url: '', detail_url: '',
      });
    }
    return entries;
  },
};

// ── Clark County / LVMPD, NV ────────────────────────────────
// LVMPD publishes most wanted suspects

const lvmpdWarrantParser: WarrantParser = {
  sourceKey: 'nv_clark_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];

    // LVMPD uses a card-based layout for wanted suspects
    const generic = createGenericWarrantParser('nv_clark_warrants');
    const genericResults = generic.parseWarrants(html);
    if (genericResults.length > 0) return genericResults;

    // Fallback: look for structured content with suspect names
    const nameRegex = /<(?:h[2-4]|strong|span)[^>]*class="[^"]*(?:name|title|suspect)[^"]*"[^>]*>([\s\S]*?)<\/(?:h[2-4]|strong|span)>/gi;
    let match: RegExpExecArray | null;
    let idx = 0;

    while ((match = nameRegex.exec(html)) !== null) {
      const nameText = stripHtml(match[1]);
      if (nameText.length < 3 || nameText.length > 60) continue;
      idx++;

      const { first, middle, last } = splitName(nameText);
      entries.push({
        warrant_id: `lvmpd-${last}-${first}-${idx}`.replace(/[^a-zA-Z0-9-]/g, ''),
        full_name: nameText, first_name: first, last_name: last, middle_name: middle,
        date_of_birth: '', age: null, gender: '', race: '', city: 'Las Vegas',
        state: 'NV', warrant_type: 'arrest', case_number: '', court_name: 'LVMPD',
        issue_date: '', charge_description: '', bail_amount: '', offense_level: '',
        photo_url: '', detail_url: '',
      });
    }
    return entries;
  },
};

// ── Maricopa County / MCSO, AZ ──────────────────────────────
// MCSO publishes "Most Wanted" list

const mcsoWarrantParser: WarrantParser = {
  sourceKey: 'az_maricopa_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];

    // MCSO most wanted uses card-style with images
    const cardRegex = /<(?:div|li|article)[^>]*class="[^"]*(?:wanted|most-wanted|card|mugshot|person)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|li|article)>/gi;
    let match: RegExpExecArray | null;
    let idx = 0;

    while ((match = cardRegex.exec(html)) !== null) {
      idx++;
      const card = match[1];

      // Name from heading/strong
      const nameMatch = card.match(/<(?:h[1-6]|strong|b|span[^>]*class="[^"]*name)[^>]*>([\s\S]*?)<\/(?:h[1-6]|strong|b|span)>/i);
      if (!nameMatch) continue;
      const nameText = stripHtml(nameMatch[1]);
      if (nameText.length < 3 || nameText.length > 60) continue;

      // Image
      const imgMatch = card.match(/<img[^>]+src="([^"]+)"/i);
      const photo = imgMatch ? imgMatch[1] : '';

      // Description/charges
      const descMatch = card.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      const desc = descMatch ? stripHtml(descMatch[1]) : '';

      const { first, middle, last } = splitName(nameText);
      entries.push({
        warrant_id: `mcso-${last}-${first}-${idx}`.replace(/[^a-zA-Z0-9-]/g, ''),
        full_name: nameText, first_name: first, last_name: last, middle_name: middle,
        date_of_birth: '', age: null, gender: '', race: '', city: 'Phoenix',
        state: 'AZ', warrant_type: 'arrest', case_number: '', court_name: 'MCSO',
        issue_date: '', charge_description: desc, bail_amount: '', offense_level: '',
        photo_url: photo, detail_url: '',
      });
    }

    // If card pattern didn't match, try generic
    if (entries.length === 0) {
      return createGenericWarrantParser('az_maricopa_warrants').parseWarrants(html);
    }
    return entries;
  },
};


// ── FBI Wanted API (Federal) ───────────────────────────────
// Fully public JSON API — best structured source available

const fbiWantedParser: WarrantParser = {
  sourceKey: 'federal_fbi_wanted',
  parseWarrants(content: string): WarrantEntry[] {
    try {
      const data = JSON.parse(content);
      const items = data.items || [];
      return items.map((item: any) => {
        const fullName = (item.title || '').trim();
        const { first, middle, last } = splitName(fullName);
        return {
          warrant_id: item.uid || `fbi-${(item['@id'] || '').split('/').pop() || ''}`,
          full_name: fullName,
          first_name: first,
          last_name: last,
          middle_name: middle,
          date_of_birth: item.dates_of_birth_used?.[0] || '',
          age: item.age_range ? parseInt(item.age_range) : null,
          gender: item.sex || '',
          race: item.race || '',
          city: '',
          state: 'US',
          warrant_type: item.person_classification === 'Main' ? 'fugitive' : 'arrest',
          case_number: item.ncic || '',
          court_name: 'Federal -- FBI',
          issue_date: item.publication || '',
          charge_description: item.description
            ? stripHtml(item.description).substring(0, 500)
            : (item.caution ? stripHtml(item.caution).substring(0, 500) : ''),
          bail_amount: item.reward_text || '',
          offense_level: 'felony',
          photo_url: item.images?.[0]?.large || item.images?.[0]?.thumb || '',
          detail_url: item.url || '',
        };
      });
    } catch {
      return [];
    }
  },
};

// ── Washoe County / Secret Witness (Reno NV) ──────────────
// WordPress blog with card layout

const washoeWarrantParser: WarrantParser = {
  sourceKey: 'nv_washoe_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];
    const postPattern = /<article[^>]*>[\s\S]*?<\/article>/gi;
    const posts = html.match(postPattern) || [];

    for (const post of posts) {
      const titleMatch = post.match(/<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      const contentMatch = post.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const imgMatch = post.match(/<img[^>]*src="([^"]*)"[^>]*/i);

      if (!titleMatch) continue;

      const fullName = stripHtml(titleMatch[2]);
      if (fullName.length < 3 || fullName.length > 80) continue;
      const detailUrl = titleMatch[1] || '';
      const content = contentMatch ? stripHtml(contentMatch[1]).substring(0, 500) : '';
      const photoUrl = imgMatch?.[1] || '';

      const { first, middle, last } = splitName(fullName);
      entries.push({
        warrant_id: `sw-${fullName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`.substring(0, 80),
        full_name: fullName,
        first_name: first,
        last_name: last,
        middle_name: middle,
        date_of_birth: '',
        age: null,
        gender: '',
        race: '',
        city: 'Reno',
        state: 'NV',
        warrant_type: 'fugitive',
        case_number: '',
        court_name: 'Washoe County',
        issue_date: '',
        charge_description: content,
        bail_amount: '',
        offense_level: content.toLowerCase().includes('felon') ? 'felony' : 'misdemeanor',
        photo_url: photoUrl,
        detail_url: detailUrl,
      });
    }
    return entries;
  },
};

// ── Pima County / 88-CRIME (Tucson AZ) ────────────────────
// WordPress card/grid layout for wanted fugitives

const pimaWarrantParser: WarrantParser = {
  sourceKey: 'az_pima_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];
    const postPattern = /<article[^>]*>[\s\S]*?<\/article>/gi;
    const posts = html.match(postPattern) || [];

    for (const post of posts) {
      const titleMatch = post.match(/<h[23][^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      const imgMatch = post.match(/<img[^>]*src="([^"]*)"[^>]*/i);
      const contentMatch = post.match(/<div[^>]*class="[^"]*(?:entry-content|excerpt)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

      if (!titleMatch) continue;

      const fullName = stripHtml(titleMatch[2]);
      if (/^(armed|robbery|homicide|shooting|burglary|theft|assault)/i.test(fullName)) continue;
      if (fullName.length < 3 || fullName.length > 80) continue;

      const detailUrl = titleMatch[1] || '';
      const content = contentMatch ? stripHtml(contentMatch[1]).substring(0, 500) : '';
      const photoUrl = imgMatch?.[1] || '';

      const { first, middle, last } = splitName(fullName);
      entries.push({
        warrant_id: `88c-${fullName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`.substring(0, 80),
        full_name: fullName,
        first_name: first,
        last_name: last,
        middle_name: middle,
        date_of_birth: '',
        age: null,
        gender: '',
        race: '',
        city: 'Tucson',
        state: 'AZ',
        warrant_type: 'fugitive',
        case_number: '',
        court_name: 'Pima County',
        issue_date: '',
        charge_description: content,
        bail_amount: '',
        offense_level: content.toLowerCase().includes('felon') ? 'felony' : 'misdemeanor',
        photo_url: photoUrl,
        detail_url: detailUrl,
      });
    }
    return entries;
  },
};

// ── Metro Denver Crime Stoppers (CO) ───────────────────────
// CMS-based layout with wanted person cards

const denverCrimeStoppersParser: WarrantParser = {
  sourceKey: 'co_denver_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];

    const postPattern = /<article[^>]*>[\s\S]*?<\/article>/gi;
    const posts = html.match(postPattern) || [];

    for (const post of posts) {
      const titleMatch = post.match(/<h[2-4][^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      const imgMatch = post.match(/<img[^>]*src="([^"]*)"[^>]*/i);
      const contentMatch = post.match(/<div[^>]*class="[^"]*(?:entry-content|excerpt|summary)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

      if (!titleMatch) continue;

      const fullName = stripHtml(titleMatch[2]);
      if (/^(armed|robbery|homicide|shooting|burglary|theft|assault|case|incident)/i.test(fullName)) continue;
      if (fullName.length < 3 || fullName.length > 80) continue;

      const detailUrl = titleMatch[1] || '';
      const content = contentMatch ? stripHtml(contentMatch[1]).substring(0, 500) : '';
      const photoUrl = imgMatch?.[1] || '';

      const { first, middle, last } = splitName(fullName);
      entries.push({
        warrant_id: `mdcs-${fullName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`.substring(0, 80),
        full_name: fullName,
        first_name: first,
        last_name: last,
        middle_name: middle,
        date_of_birth: '',
        age: null,
        gender: '',
        race: '',
        city: 'Denver',
        state: 'CO',
        warrant_type: 'fugitive',
        case_number: '',
        court_name: 'Metro Denver Crime Stoppers',
        issue_date: '',
        charge_description: content,
        bail_amount: '',
        offense_level: content.toLowerCase().includes('felon') ? 'felony' : 'misdemeanor',
        photo_url: photoUrl,
        detail_url: detailUrl,
      });
    }

    if (entries.length === 0) {
      return createGenericWarrantParser('co_denver_warrants').parseWarrants(html);
    }
    return entries;
  },
};

// ── Flathead County MT ─────────────────────────────────────
// Clean HTML table layout at apps.flathead.mt.gov

const flatheadWarrantParser: WarrantParser = {
  sourceKey: 'mt_flathead_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let match: RegExpExecArray | null;

    while ((match = rowRegex.exec(html)) !== null) {
      const cells: string[] = [];
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = tdRe.exec(match[1])) !== null) {
        cells.push(stripHtml(tdMatch[1]));
      }
      if (cells.length < 2) continue;

      if (cells[0].match(/^(Name|Defendant|Last|First|Warrant|#|ID)$/i)) continue;

      let nameCell = '';
      let charges = '';
      let caseNum = '';
      let warrantType = '';
      let issueDate = '';
      let bail = '';
      let dob = '';
      let age: number | null = null;
      let city = '';

      for (const cell of cells) {
        if (!nameCell && cell.match(/[A-Z]{2,}/i) && (cell.includes(',') || cell.includes(' '))) {
          if (!cell.match(/^\d/) && cell.length > 3 && cell.length < 60) {
            nameCell = cell;
          }
        } else if (cell.match(/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/) && !dob) {
          if (cell.match(/\b(19|20)\d{2}/)) dob = cell;
          else if (!issueDate) issueDate = cell;
        } else if (cell.match(/^\d{1,3}$/) && !age) {
          age = parseInt(cell);
        } else if (cell.match(/\$[\d,.]+/)) {
          bail = cell;
        } else if (cell.match(/(warrant|bench|arrest|FTA|fugitive)/i)) {
          warrantType = cell;
        } else if (cell.match(/(case|CR|CF|MC|CV|DR)-?\d/i) || cell.match(/^\d{2,4}-[A-Z]{1,3}-\d+$/i)) {
          caseNum = cell;
        } else if (cell.match(/^[A-Z][a-z]+(\s[A-Z][a-z]+)?$/)) {
          if (!city) city = cell;
        } else if (cell.length > 10 && !charges) {
          charges = cell;
        }
      }
      if (!nameCell) continue;

      const { first, middle, last } = splitName(nameCell);
      const wId = `fhc-${last}-${first}-${caseNum || entries.length}`.replace(/[^a-zA-Z0-9-]/g, '').substring(0, 80);

      entries.push({
        warrant_id: wId,
        full_name: nameCell,
        first_name: first,
        last_name: last,
        middle_name: middle,
        date_of_birth: dob,
        age,
        gender: '',
        race: '',
        city: city || 'Flathead County',
        state: 'MT',
        warrant_type: warrantType || 'arrest',
        case_number: caseNum,
        court_name: 'Flathead County',
        issue_date: issueDate,
        charge_description: charges,
        bail_amount: bail,
        offense_level: charges.toLowerCase().includes('felon') ? 'felony' : '',
        photo_url: '',
        detail_url: '',
      });
    }
    return entries;
  },
};


// ════════════════════════════════════════════════════════════
//  PARSER REGISTRY
// ════════════════════════════════════════════════════════════

const WARRANT_PARSERS: Record<string, WarrantParser> = {
  co_el_paso_warrants: elPasoCoWarrantParser,
  nv_clark_warrants: lvmpdWarrantParser,
  az_maricopa_warrants: mcsoWarrantParser,
  // ── New parsers ──
  federal_fbi_wanted: fbiWantedParser,
  nv_washoe_warrants: washoeWarrantParser,
  az_pima_warrants: pimaWarrantParser,
  co_denver_warrants: denverCrimeStoppersParser,
  mt_flathead_warrants: flatheadWarrantParser,
  // All other sources use createGenericWarrantParser() as fallback
};


// ════════════════════════════════════════════════════════════
//  UPSERT + CROSS-LINKING
// ════════════════════════════════════════════════════════════

function upsertWarrants(sourceKey: string, entries: WarrantEntry[]): { inserted: number; updated: number } {
  const db = getDb();
  const now = localNow();
  let inserted = 0;
  let updated = 0;

  const checkStmt = db.prepare(
    'SELECT id FROM scraped_warrants WHERE source_key = ? AND warrant_id = ?'
  );

  const insertStmt = db.prepare(`
    INSERT INTO scraped_warrants
      (source_key, warrant_id, full_name, first_name, last_name, middle_name,
       date_of_birth, age, gender, race, city, state, warrant_type,
       case_number, court_name, issue_date, charge_description, bail_amount,
       offense_level, photo_url, detail_url, status, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `);

  const updateStmt = db.prepare(`
    UPDATE scraped_warrants SET
      full_name = ?, first_name = ?, last_name = ?, middle_name = ?,
      date_of_birth = ?, age = ?, gender = ?, race = ?, city = ?,
      charge_description = ?, bail_amount = ?,
      photo_url = CASE WHEN ? != '' THEN ? ELSE photo_url END,
      status = 'active', last_seen_at = ?, cleared_at = NULL
    WHERE source_key = ? AND warrant_id = ?
  `);

  const txn = db.transaction(() => {
    for (const entry of entries) {
      const existing = checkStmt.get(sourceKey, entry.warrant_id);
      if (existing) {
        updateStmt.run(
          entry.full_name, entry.first_name, entry.last_name, entry.middle_name,
          entry.date_of_birth, entry.age, entry.gender, entry.race, entry.city,
          entry.charge_description, entry.bail_amount,
          entry.photo_url, entry.photo_url,
          now, sourceKey, entry.warrant_id
        );
        updated++;
      } else {
        insertStmt.run(
          sourceKey, entry.warrant_id, entry.full_name, entry.first_name, entry.last_name,
          entry.middle_name, entry.date_of_birth, entry.age, entry.gender, entry.race,
          entry.city, entry.state, entry.warrant_type, entry.case_number, entry.court_name,
          entry.issue_date, entry.charge_description, entry.bail_amount, entry.offense_level,
          entry.photo_url, entry.detail_url, now, now
        );
        inserted++;
      }
    }
  });

  txn();
  return { inserted, updated };
}

/**
 * Mark warrants that no longer appear in the scrape as "cleared".
 */
function detectClearedWarrants(sourceKey: string, currentWarrantIds: string[]): number {
  const db = getDb();
  const now = localNow();

  if (currentWarrantIds.length === 0) return 0;

  // Get all currently active warrants for this source
  const activeWarrants = db.prepare(
    "SELECT warrant_id FROM scraped_warrants WHERE source_key = ? AND status = 'active'"
  ).all(sourceKey) as { warrant_id: string }[];

  const currentSet = new Set(currentWarrantIds);
  let cleared = 0;

  const clearStmt = db.prepare(
    'UPDATE scraped_warrants SET status = ?, cleared_at = ? WHERE source_key = ? AND warrant_id = ?'
  );

  for (const active of activeWarrants) {
    if (!currentSet.has(active.warrant_id)) {
      clearStmt.run('cleared', now, sourceKey, active.warrant_id);
      cleared++;
    }
  }

  return cleared;
}

/**
 * Cross-link scraped warrants with persons in the database.
 * Uses DOB verification when available for higher-confidence matches.
 * Sets dob_verified=1 when DOB matches, providing a confidence indicator.
 */
function crossLinkWarrants(): void {
  const db = getDb();
  try {
    // Find scraped warrants without a person_id that match a known person
    const unlinked = db.prepare(`
      SELECT sw.id, sw.first_name, sw.last_name, sw.date_of_birth, sw.age
      FROM scraped_warrants sw
      WHERE sw.person_id IS NULL
        AND sw.first_name IS NOT NULL AND sw.first_name != ''
        AND sw.last_name IS NOT NULL AND sw.last_name != ''
    `).all() as { id: number; first_name: string; last_name: string; date_of_birth: string; age: number | null }[];

    const updateWithDob = db.prepare('UPDATE scraped_warrants SET person_id = ?, dob_verified = 1 WHERE id = ?');
    const updateWithoutDob = db.prepare('UPDATE scraped_warrants SET person_id = ?, dob_verified = 0 WHERE id = ?');
    let linkedDob = 0;
    let linkedName = 0;

    for (const sw of unlinked) {
      let person: { id: number; dob: string | null } | undefined;
      let dobVerified = false;

      // Strategy 1: Exact DOB match (highest confidence)
      if (sw.date_of_birth) {
        person = db.prepare(`
          SELECT id, dob FROM persons
          WHERE UPPER(first_name) = UPPER(?) AND UPPER(last_name) = UPPER(?)
          AND dob = ? AND archived_at IS NULL
          LIMIT 1
        `).get(sw.first_name, sw.last_name, sw.date_of_birth) as { id: number; dob: string | null } | undefined;

        if (person) dobVerified = true;
      }

      // Strategy 2: Age-based DOB verification (warrant has age, person has DOB)
      if (!person && sw.age != null) {
        const candidates = db.prepare(`
          SELECT id, dob FROM persons
          WHERE UPPER(first_name) = UPPER(?) AND UPPER(last_name) = UPPER(?)
          AND dob IS NOT NULL AND dob != ''
          AND archived_at IS NULL
        `).all(sw.first_name, sw.last_name) as { id: number; dob: string }[];

        for (const cand of candidates) {
          const candDob = new Date(cand.dob);
          if (isNaN(candDob.getTime())) continue;
          const now = new Date();
          const expectedAge = now.getFullYear() - candDob.getFullYear();
          // Allow ±1 year tolerance for age matching
          if (Math.abs(expectedAge - sw.age) <= 1) {
            person = cand;
            dobVerified = true;
            break;
          }
        }
      }

      // Strategy 3: Name-only match (lowest confidence — no DOB verification)
      if (!person) {
        person = db.prepare(`
          SELECT id, dob FROM persons
          WHERE UPPER(first_name) = UPPER(?) AND UPPER(last_name) = UPPER(?)
          AND archived_at IS NULL
          LIMIT 1
        `).get(sw.first_name, sw.last_name) as { id: number; dob: string | null } | undefined;
      }

      if (person) {
        if (dobVerified) {
          updateWithDob.run(person.id, sw.id);
          linkedDob++;
        } else {
          updateWithoutDob.run(person.id, sw.id);
          linkedName++;
        }
      }
    }

    if (linkedDob > 0 || linkedName > 0) {
      console.log(`[Warrant Scraper] Cross-linked ${linkedDob + linkedName} warrants (${linkedDob} DOB-verified, ${linkedName} name-only)`);
    }
  } catch (err) {
    console.error('[Warrant Scraper] Cross-link error:', (err as Error).message);
  }
}


// ════════════════════════════════════════════════════════════
//  SCRAPE ENGINE
// ════════════════════════════════════════════════════════════

function getSourceConfigs(): WarrantSourceConfig[] {
  const db = getDb();
  return db.prepare('SELECT * FROM warrant_scraper_config ORDER BY source_key').all() as WarrantSourceConfig[];
}

function getSourceConfig(sourceKey: string): WarrantSourceConfig | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM warrant_scraper_config WHERE source_key = ?').get(sourceKey) as WarrantSourceConfig | undefined;
}

/**
 * Scrape warrants from a single source.
 */
async function scrapeSource(sourceKey: string): Promise<{
  records_found: number;
  inserted: number;
  updated: number;
  cleared: number;
}> {
  const config = getSourceConfig(sourceKey);
  if (!config) throw new Error(`Unknown warrant source: ${sourceKey}`);

  // Handle arrest record extraction (special case — no HTTP fetch)
  if (config.source_type === 'arrest_extract') {
    console.log(`[Warrant Scraper] Extracting warrant-related bookings from arrest records...`);
    const entries = extractWarrantsFromArrestRecords();
    const { inserted, updated } = upsertWarrants(sourceKey, entries);
    crossLinkWarrants();

    console.log(`[Warrant Scraper] Arrest extraction: ${entries.length} found, ${inserted} new, ${updated} updated`);
    return { records_found: entries.length, inserted, updated, cleared: 0 };
  }

  // Handle sources with no URL or marked as 'none'
  if (config.source_type === 'none' || !config.source_url) {
    return { records_found: 0, inserted: 0, updated: 0, cleared: 0 };
  }

  // API sources without a dedicated parser (like Utah warrants.utah.gov)
  // are handled by utahWarrantScraper -- skip them here.
  // API sources WITH a registered parser (e.g. FBI API) get fetched + parsed normally.
  if (config.source_type === 'api' && !WARRANT_PARSERS[sourceKey]) {
    return { records_found: 0, inserted: 0, updated: 0, cleared: 0 };
  }

  // Get parser (specific or generic fallback)
  const parser = WARRANT_PARSERS[sourceKey] || createGenericWarrantParser(sourceKey);

  // Fetch page content
  const content = await fetchPage(config.source_url);

  // Parse warrants
  const entries = parser.parseWarrants(content);
  const { inserted, updated } = upsertWarrants(sourceKey, entries);
  const cleared = detectClearedWarrants(sourceKey, entries.map(e => e.warrant_id));

  // Cross-link with persons
  crossLinkWarrants();

  return { records_found: entries.length, inserted, updated, cleared };
}


// ════════════════════════════════════════════════════════════
//  SYNC ORCHESTRATOR
// ════════════════════════════════════════════════════════════

async function syncSource(sourceKey: string): Promise<void> {
  const db = getDb();
  const config = getSourceConfig(sourceKey);
  if (!config || !config.enabled) return;

  try {
    console.log(`[Warrant Scraper] ── ${config.display_name} ──`);
    const result = await scrapeSource(sourceKey);

    // Success — reset error counter
    db.prepare(`
      UPDATE warrant_scraper_config
      SET last_scrape_at = ?, consecutive_errors = 0, circuit_broken = 0
      WHERE source_key = ?
    `).run(localNow(), sourceKey);

    backoffAttempts.delete(sourceKey);

    console.log(`[Warrant Scraper] ${config.display_name}: ${result.records_found} found, ${result.inserted} new, ${result.updated} updated, ${result.cleared} cleared`);

  } catch (err) {
    const errMsg = (err as Error).message;
    console.error(`[Warrant Scraper] ${config.display_name} error: ${errMsg}`);

    // Increment error counter
    const errResult = db.prepare(`
      UPDATE warrant_scraper_config
      SET consecutive_errors = consecutive_errors + 1
      WHERE source_key = ?
      RETURNING consecutive_errors
    `).get(sourceKey) as { consecutive_errors: number } | undefined;

    const errorCount = errResult?.consecutive_errors ?? 1;

    if (errorCount >= CIRCUIT_BREAKER_THRESHOLD) {
      console.warn(`[Warrant Scraper] CIRCUIT BREAKER TRIPPED for ${config.display_name} after ${errorCount} errors`);

      db.prepare('UPDATE warrant_scraper_config SET circuit_broken = 1 WHERE source_key = ?').run(sourceKey);

      // Stop the interval
      const interval = sourceIntervals.get(sourceKey);
      if (interval) {
        clearInterval(interval);
        sourceIntervals.delete(sourceKey);
      }

      // Schedule exponential backoff recovery
      const attempt = (backoffAttempts.get(sourceKey) || 0) + 1;
      backoffAttempts.set(sourceKey, attempt);
      const backoffMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt - 1), BACKOFF_MAX_MS);
      const backoffHours = (backoffMs / 3_600_000).toFixed(1);

      console.log(`[Warrant Scraper] Auto-recovery for ${config.display_name} in ${backoffHours}h (attempt ${attempt})`);

      const recoveryTimeout = setTimeout(() => {
        console.log(`[Warrant Scraper] Auto-recovery: resetting ${config.display_name}`);
        db.prepare('UPDATE warrant_scraper_config SET consecutive_errors = 0, circuit_broken = 0 WHERE source_key = ?').run(sourceKey);
        scheduleSource(sourceKey);
      }, backoffMs);

      if (recoveryTimeout.unref) recoveryTimeout.unref();
      backoffTimeouts.set(sourceKey, recoveryTimeout);
    }
  }
}


// ════════════════════════════════════════════════════════════
//  SCHEDULER
// ════════════════════════════════════════════════════════════

function scheduleSource(sourceKey: string): void {
  // Clear existing interval
  const existing = sourceIntervals.get(sourceKey);
  if (existing) {
    clearInterval(existing);
    sourceIntervals.delete(sourceKey);
  }

  const config = getSourceConfig(sourceKey);
  if (!config || !config.enabled || config.circuit_broken) return;

  const intervalMs = (config.scrape_interval_minutes || 120) * 60_000;

  // Initial scrape
  syncSource(sourceKey).catch(err => {
    console.error(`[Warrant Scraper] Initial scrape error for ${sourceKey}:`, (err as Error).message);
  });

  // Schedule recurring
  const interval = setInterval(() => {
    syncSource(sourceKey).catch(err => {
      console.error(`[Warrant Scraper] Scrape error for ${sourceKey}:`, (err as Error).message);
    });
  }, intervalMs);

  if (interval.unref) interval.unref();
  sourceIntervals.set(sourceKey, interval);
}

export function scheduleWarrantScraper(): void {
  console.log('[Warrant Scraper] Multi-state warrant scraper initializing...');

  startupTimeout = setTimeout(async () => {
    const configs = getSourceConfigs();
    const enabled = configs.filter(c => c.enabled);
    const disabled = configs.length - enabled.length;

    console.log(`[Warrant Scraper] ${enabled.length} sources enabled, ${disabled} disabled`);

    for (const config of enabled) {
      if (config.circuit_broken) {
        // Schedule recovery with backoff
        const attempt = (backoffAttempts.get(config.source_key) || 0) + 1;
        backoffAttempts.set(config.source_key, attempt);
        const backoffMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt - 1), BACKOFF_MAX_MS);

        console.log(`[Warrant Scraper] ${config.display_name} circuit-broken — recovery in ${(backoffMs / 3_600_000).toFixed(1)}h`);

        const timeout = setTimeout(() => {
          const db = getDb();
          db.prepare('UPDATE warrant_scraper_config SET consecutive_errors = 0, circuit_broken = 0 WHERE source_key = ?')
            .run(config.source_key);
          scheduleSource(config.source_key);
        }, backoffMs);

        if (timeout.unref) timeout.unref();
        backoffTimeouts.set(config.source_key, timeout);
      } else {
        scheduleSource(config.source_key);
      }

      // Stagger starts to avoid burst
      await sleep(3000);
    }
  }, STARTUP_DELAY_MS);

  if (startupTimeout.unref) startupTimeout.unref();
}

export function stopWarrantScraper(): void {
  if (startupTimeout) {
    clearTimeout(startupTimeout);
    startupTimeout = null;
  }
  for (const [, interval] of sourceIntervals) clearInterval(interval);
  sourceIntervals.clear();
  for (const [, timeout] of backoffTimeouts) clearTimeout(timeout);
  backoffTimeouts.clear();
  backoffAttempts.clear();
}


// ════════════════════════════════════════════════════════════
//  PUBLIC API — For routes
// ════════════════════════════════════════════════════════════

/**
 * Search scraped warrants by name.
 */
export function searchScrapedWarrants(query: string, options?: {
  state?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): { data: any[]; total: number } {
  const db = getDb();
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const parts = query.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) return { data: [], total: 0 };

  let where = 'WHERE 1=1';
  const params: any[] = [];

  if (parts.length >= 2) {
    where += ' AND ((UPPER(sw.first_name) LIKE UPPER(?) AND UPPER(sw.last_name) LIKE UPPER(?)) OR (UPPER(sw.first_name) LIKE UPPER(?) AND UPPER(sw.last_name) LIKE UPPER(?)))';
    params.push(`%${parts[0]}%`, `%${parts[1]}%`, `%${parts[1]}%`, `%${parts[0]}%`);
  } else {
    where += ' AND (UPPER(sw.first_name) LIKE UPPER(?) OR UPPER(sw.last_name) LIKE UPPER(?) OR UPPER(sw.full_name) LIKE UPPER(?))';
    params.push(`%${parts[0]}%`, `%${parts[0]}%`, `%${parts[0]}%`);
  }

  if (options?.state) {
    where += ' AND sw.state = ?';
    params.push(options.state);
  }
  if (options?.status) {
    where += ' AND sw.status = ?';
    params.push(options.status);
  }

  // COUNT query uses the same table alias for consistency with the WHERE clause
  const total = (db.prepare(`SELECT COUNT(*) as count FROM scraped_warrants sw ${where}`).get(...params) as any).count;
  const data = db.prepare(`
    SELECT sw.*, wsc.display_name as source_display_name
    FROM scraped_warrants sw
    LEFT JOIN warrant_scraper_config wsc ON sw.source_key = wsc.source_key
    ${where}
    ORDER BY sw.last_seen_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return { data, total };
}

/**
 * Get all active warrants (for dashboard/alerts).
 */
export function getActiveScrapedWarrants(options?: {
  state?: string;
  limit?: number;
}): any[] {
  const db = getDb();
  const limit = options?.limit ?? 200;

  let where = "WHERE sw.status = 'active'";
  const params: any[] = [];

  if (options?.state) {
    where += ' AND sw.state = ?';
    params.push(options.state);
  }

  return db.prepare(`
    SELECT sw.*, wsc.display_name as source_display_name
    FROM scraped_warrants sw
    LEFT JOIN warrant_scraper_config wsc ON sw.source_key = wsc.source_key
    ${where}
    ORDER BY sw.last_seen_at DESC
    LIMIT ?
  `).all(...params, limit);
}

/**
 * Get warrant scraper status for all sources.
 */
export function getWarrantScraperStatus(): any[] {
  const db = getDb();

  const configs = db.prepare('SELECT * FROM warrant_scraper_config ORDER BY state, source_key').all() as WarrantSourceConfig[];

  return configs.map(c => {
    const activeCount = (db.prepare(
      "SELECT COUNT(*) as count FROM scraped_warrants WHERE source_key = ? AND status = 'active'"
    ).get(c.source_key) as any)?.count ?? 0;

    const totalCount = (db.prepare(
      'SELECT COUNT(*) as count FROM scraped_warrants WHERE source_key = ?'
    ).get(c.source_key) as any)?.count ?? 0;

    return {
      ...c,
      active_warrants: activeCount,
      total_warrants: totalCount,
      auto_recovering: backoffTimeouts.has(c.source_key),
      backoff_attempt: backoffAttempts.get(c.source_key) || 0,
    };
  });
}

/**
 * Get warrant stats summary across all sources.
 */
export function getWarrantScraperStats(): {
  total_active: number;
  total_cleared: number;
  total_sources: number;
  enabled_sources: number;
  by_state: Record<string, number>;
  by_type: Record<string, number>;
} {
  const db = getDb();

  const active = (db.prepare("SELECT COUNT(*) as c FROM scraped_warrants WHERE status = 'active'").get() as any).c;
  const cleared = (db.prepare("SELECT COUNT(*) as c FROM scraped_warrants WHERE status = 'cleared'").get() as any).c;
  const totalSources = (db.prepare('SELECT COUNT(*) as c FROM warrant_scraper_config').get() as any).c;
  const enabledSources = (db.prepare('SELECT COUNT(*) as c FROM warrant_scraper_config WHERE enabled = 1').get() as any).c;

  const byState: Record<string, number> = {};
  const stateRows = db.prepare("SELECT state, COUNT(*) as c FROM scraped_warrants WHERE status = 'active' GROUP BY state").all() as { state: string; c: number }[];
  for (const row of stateRows) byState[row.state] = row.c;

  const byType: Record<string, number> = {};
  const typeRows = db.prepare("SELECT warrant_type, COUNT(*) as c FROM scraped_warrants WHERE status = 'active' GROUP BY warrant_type").all() as { warrant_type: string; c: number }[];
  for (const row of typeRows) byType[row.warrant_type] = row.c;

  return { total_active: active, total_cleared: cleared, total_sources: totalSources, enabled_sources: enabledSources, by_state: byState, by_type: byType };
}

/**
 * Manually trigger a scrape for a specific source.
 */
export async function manualScrapeSource(sourceKey: string): Promise<any> {
  return scrapeSource(sourceKey);
}

/**
 * Reset errors and re-enable a warrant source.
 */
export function resetWarrantSourceErrors(sourceKey: string): void {
  const db = getDb();
  db.prepare('UPDATE warrant_scraper_config SET consecutive_errors = 0, circuit_broken = 0 WHERE source_key = ?').run(sourceKey);

  // Clear backoff state
  const timeout = backoffTimeouts.get(sourceKey);
  if (timeout) {
    clearTimeout(timeout);
    backoffTimeouts.delete(sourceKey);
  }
  backoffAttempts.delete(sourceKey);

  // Restart scheduler
  scheduleSource(sourceKey);
}

/**
 * Enable/disable a warrant source.
 */
export function setWarrantSourceEnabled(sourceKey: string, enabled: boolean): void {
  const db = getDb();
  db.prepare('UPDATE warrant_scraper_config SET enabled = ? WHERE source_key = ?').run(enabled ? 1 : 0, sourceKey);

  if (enabled) {
    scheduleSource(sourceKey);
  } else {
    const interval = sourceIntervals.get(sourceKey);
    if (interval) {
      clearInterval(interval);
      sourceIntervals.delete(sourceKey);
    }
  }
}

/**
 * Check if a specific person has active scraped warrants.
 */
export function checkPersonWarrants(personId: number): any[] {
  const db = getDb();
  return db.prepare(`
    SELECT sw.*, wsc.display_name as source_display_name
    FROM scraped_warrants sw
    LEFT JOIN warrant_scraper_config wsc ON sw.source_key = wsc.source_key
    WHERE sw.person_id = ? AND sw.status = 'active'
    ORDER BY sw.last_seen_at DESC
  `).all(personId);
}
