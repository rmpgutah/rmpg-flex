// ============================================================
// Multi-State County Jail Roster Scraper
// ============================================================
// Scrapes inmate roster data from county jail websites across
// Utah and surrounding states (CO, WY, ID, NV, AZ, NM), stores
// records in arrest_records with entry_source='scraper'.
//
// Supported formats:
//   HTML: Weber, Davis, Salt Lake, Beaver, Carbon, Tooele (UT)
//   JSON: Iron, Utah County (UT); JailTracker counties (multi-state)
//   PDF:  Uinta, Summit (UT)
//
// JailTracker (public-safety-cloud.com):
//   Generic parser handles ~50 counties across 6 states using
//   the same JSON API pattern. County-specific URL parameters
//   are stored in jail_roster_config.
//
// Design:
//   - Per-county parsers implement CountyParser interface
//   - JailTracker generic parser handles many counties at once
//   - Polite scraping: 1.5s between detail fetches, circuit breaker
//   - Release detection: inmates gone from roster → status='released'
//   - Cross-linking: warrants, court events, persons (reuses arrestScraper)
//   - Scheduler: configurable per-county intervals
// ============================================================

import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import { crossLinkArrests } from './arrestScraper';

// ── Constants ───────────────────────────────────────────────

// Browser-like UA required by several jail roster sites (Clark NV, El Paso CO block custom UAs)
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_DELAY_MS = 1_500;          // Between detail page fetches
const MAX_DETAIL_BATCH = 50;             // Max detail pages per scrape cycle
const CIRCUIT_BREAKER_THRESHOLD = 5;     // Consecutive errors → pause county (raised from 3)
const DEFAULT_INTERVAL_MS = 30 * 60_000; // 30 minutes
const STARTUP_DELAY_MS = 30_000;         // 30s after server start
const BACKOFF_BASE_MS = 60 * 60_000;     // 1 hour base for exponential backoff
const BACKOFF_MAX_MS = 24 * 60 * 60_000; // 24 hour max backoff

// ── Interfaces ──────────────────────────────────────────────

interface RosterEntry {
  roster_id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  middle_name: string;
  gender: string;
  age: number | null;
  booking_date: string;
  charges: string[];
  bail_amount: string;
  detail_url: string;
}

interface DetailFields {
  height: string;
  weight: string;
  hair_color: string;
  eye_color: string;
  charges: string[];
  case_number: string;
  bail_type: string;
}

interface CountyParser {
  county: string;
  parseRoster(content: string): RosterEntry[];
  parseDetail?(html: string): DetailFields;
  buildDetailUrl?(rosterId: string): string;
}

interface CountyConfig {
  id: number;
  county: string;
  display_name: string;
  roster_url: string;
  roster_type: string;
  enabled: number;
  scrape_interval_minutes: number;
  last_scrape_at: string | null;
  consecutive_errors: number;
  state: string;
}

// ── Scheduler state ─────────────────────────────────────────

const countyIntervals = new Map<string, ReturnType<typeof setInterval>>();
const backoffTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const backoffAttempts = new Map<string, number>(); // Track how many times a county has auto-recovered
let startupTimeout: ReturnType<typeof setTimeout> | null = null;

// ── HTTP helpers ────────────────────────────────────────────

const MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10 MB — reject oversized responses to prevent memory exhaustion

async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const contentLength = res.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
      throw new Error(`Response too large (${contentLength} bytes) from ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPdf(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching PDF ${url}`);
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } finally {
    clearTimeout(timeout);
  }
}

async function parsePdfText(url: string): Promise<string> {
  // pdf-parse v2 — uses PDFParse class with url option + getText()
  const mod = await import('pdf-parse');
  const PDFParse = (mod as any).PDFParse || (mod as any).default?.PDFParse;
  if (!PDFParse) throw new Error('pdf-parse module did not export PDFParse class');
  const parser = new PDFParse({ url });
  const result = await parser.getText();
  return result.text;
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

// ════════════════════════════════════════════════════════════
//  COUNTY PARSERS
// ════════════════════════════════════════════════════════════

// ── Weber County (HTML) ─────────────────────────────────────
// Roster uses flex-table layout with flex-table-row divs.
// Columns: WHEN BOOKED, LAST NAME, FIRST NAME, MIDDLE NAME, GENDER, AGE, Details(link)
// Detail page at roster_details1.php?roster_number=<id>

const weberParser: CountyParser = {
  county: 'weber',

  parseRoster(html: string): RosterEntry[] {
    const entries: RosterEntry[] = [];
    const linkRegex = /roster_details1\.php\?roster_number=(\d+)/i;

    // Match each flex-table-row block — single or double quotes on class attr
    const blockRegex = /<div[^>]*class=['"]?[^'"]*flex-table-row[^'"]*['"]?[^>]*>([\s\S]*?)(?=<div[^>]*class=['"]?[^'"]*flex-table-row|$)/gi;
    let match: RegExpExecArray | null;

    while ((match = blockRegex.exec(html)) !== null) {
      const block = match[1];
      const linkMatch = linkRegex.exec(block);
      if (!linkMatch) continue;

      const rosterId = linkMatch[1];

      // Extract all flex-table-column cell values (single or double quotes)
      const cells: string[] = [];
      const cellRe = /<div[^>]*class=['"]?[^'"]*flex-table-column[^'"]*['"]?[^>]*>([\s\S]*?)<\/div>/gi;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRe.exec(block)) !== null) {
        cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
      }

      // Columns: [0]=WHEN BOOKED, [1]=LAST NAME, [2]=FIRST NAME, [3]=MIDDLE NAME, [4]=GENDER, [5]=AGE
      if (cells.length < 4) continue;

      const bookingDate = cells[0] || '';
      const lastName = (cells[1] || '').trim();
      const firstName = (cells[2] || '').trim();
      const middleName = (cells[3] || '').trim();
      const gender = (cells[4] || '').charAt(0).toUpperCase();
      const age = parseInt(cells[5], 10) || null;
      const fullName = middleName ? `${lastName}, ${firstName} ${middleName}` : `${lastName}, ${firstName}`;

      entries.push({
        roster_id: rosterId,
        full_name: fullName,
        first_name: firstName,
        last_name: lastName,
        middle_name: middleName,
        gender,
        age,
        booking_date: bookingDate,
        charges: [],
        bail_amount: '',
        detail_url: `https://www.webercountyutah.gov/sheriff/roster/roster_details1.php?roster_number=${rosterId}`,
      });
    }

    return entries;
  },

  parseDetail(html: string): DetailFields {
    const fields: DetailFields = {
      height: '', weight: '', hair_color: '', eye_color: '',
      charges: [], case_number: '', bail_type: '',
    };

    // Extract physical descriptors from the detail page
    const extract = (label: string): string => {
      const re = new RegExp(label + '[:\\s]*([^<]+)', 'i');
      const m = re.exec(html);
      return m ? m[1].trim() : '';
    };

    fields.height = extract('Height');
    fields.weight = extract('Weight');
    fields.hair_color = extract('Hair');
    fields.eye_color = extract('Eyes');

    // Extract charges from the charges table
    const chargeRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const chargesSection = html.match(/charges[\s\S]*?<table[\s\S]*?<\/table>/i);
    if (chargesSection) {
      let cm: RegExpExecArray | null;
      const chargeRe = /<tr[^>]*>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/gi;
      while ((cm = chargeRe.exec(chargesSection[0])) !== null) {
        const charge = cm[1].replace(/<[^>]+>/g, '').trim();
        if (charge && charge.toLowerCase() !== 'charge' && charge.toLowerCase() !== 'charges') {
          fields.charges.push(charge);
        }
      }
    }

    // Bail amount from detail
    const bailMatch = html.match(/bail[:\s]*\$?([\d,]+\.?\d*)/i);
    if (bailMatch) {
      fields.bail_type = `$${bailMatch[1]}`;
    }

    return fields;
  },

  buildDetailUrl(rosterId: string): string {
    return `https://www.webercountyutah.gov/sheriff/roster/roster_details1.php?roster_number=${rosterId}`;
  },
};

// ── Davis County (HTML) ─────────────────────────────────────
// Server-rendered HTML table (Sitefinity CMS).
// Columns: Booking Date, First Name, Last Name, Gender, Age, Details
// Detail button: onClick="getInmateRosterDetail('ID')" → AJAX to /sheriff/inmate-roster/GetDetail/?id=ID

const davisParser: CountyParser = {
  county: 'davis',

  parseRoster(html: string): RosterEntry[] {
    const entries: RosterEntry[] = [];

    // Find ALL <tbody> sections (paginated HTML has one per page)
    const tbodyRegex = /<tbody[^>]*>([\s\S]*?)<\/tbody>/gi;
    let tbodyMatch: RegExpExecArray | null;
    let allRowsHtml = '';
    while ((tbodyMatch = tbodyRegex.exec(html)) !== null) {
      allRowsHtml += tbodyMatch[1] + '\n';
    }
    if (!allRowsHtml) return entries;

    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let match: RegExpExecArray | null;

    while ((match = rowRegex.exec(allRowsHtml)) !== null) {
      const rowHtml = match[1];

      // Extract cells
      const cells: string[] = [];
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
        cells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
      }
      if (cells.length < 5) continue;

      // Columns: [0]=Booking Date, [1]=First Name, [2]=Last Name, [3]=Gender, [4]=Age, [5]=Details(text)
      // Extract roster ID from getInmateRosterDetail('ID') in the row HTML
      const idMatch = rowHtml.match(/getInmateRosterDetail\(['"](\d+)['"]\)/);
      const rosterId = idMatch ? idMatch[1] : `${cells[1]}-${cells[2]}-${cells[0]}`.toLowerCase().replace(/\s+/g, '-');

      const firstName = (cells[1] || '').trim();
      const lastName = (cells[2] || '').trim();
      const fullName = lastName && firstName ? `${lastName}, ${firstName}` : `${lastName}${firstName}`;

      entries.push({
        roster_id: rosterId,
        full_name: fullName,
        first_name: firstName,
        last_name: lastName,
        middle_name: '',
        gender: (cells[3] || '').charAt(0).toUpperCase(),
        age: parseInt(cells[4], 10) || null,
        booking_date: cells[0] || '',
        charges: [],
        bail_amount: '',
        detail_url: idMatch
          ? `https://www.daviscountyutah.gov/sheriff/inmate-roster/GetDetail/?id=${idMatch[1]}`
          : '',
      });
    }

    return entries;
  },

  parseDetail(html: string): DetailFields {
    const fields: DetailFields = {
      height: '', weight: '', hair_color: '', eye_color: '',
      charges: [], case_number: '', bail_type: '',
    };

    // Extract modal content between markers
    const modalMatch = html.match(/<!-- Modal Start-->([\s\S]*?)<!-- Modal End-->/i);
    const content = modalMatch ? modalMatch[1] : html;

    // Arresting Agency
    const agencyMatch = content.match(/Arresting Agency\s*:\s*([^<]+)/i);
    if (agencyMatch) fields.case_number = agencyMatch[1].trim();

    // Charges from bondsAndCharges section
    const chargesSection = content.match(/bondsAndCharges[\s\S]*?<table[\s\S]*?<\/table>/i);
    if (chargesSection) {
      const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let cm: RegExpExecArray | null;
      while ((cm = rowRe.exec(chargesSection[0])) !== null) {
        const tdRe2 = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        const rowCells: string[] = [];
        let td2: RegExpExecArray | null;
        while ((td2 = tdRe2.exec(cm[1])) !== null) {
          rowCells.push(td2[1].replace(/<[^>]+>/g, '').trim());
        }
        // First cell is typically the charge description
        if (rowCells[0] && !rowCells[0].match(/^(charge|offense|bond|type)/i)) {
          fields.charges.push(rowCells[0]);
        }
      }
    }

    return fields;
  },

  buildDetailUrl(rosterId: string): string {
    return `https://www.daviscountyutah.gov/sheriff/inmate-roster/GetDetail/?id=${rosterId}`;
  },
};

// ── Iron County (JSON API) ───────────────────────────────────
// Next.js site fetches from api2025.ironcounty.net/inmate-bookings.
// We hit the JSON API directly — no browser rendering needed.
// Schema: { Inmate_FirstName, Inmate_LastName, Inmate_BookingDate,
//           Inmate_CurrentBookingNumber, Offenses[{ Offense_Description,
//           Offense_Statute, Offense_Counts, Offense_BondReqAmount, Offense_BondType }] }

const ironParser: CountyParser = {
  county: 'iron',

  parseRoster(content: string): RosterEntry[] {
    const entries: RosterEntry[] = [];

    let data: any[];
    try {
      data = JSON.parse(content);
    } catch {
      console.error('[Jail Roster] Iron County: failed to parse JSON response');
      return entries;
    }

    if (!Array.isArray(data)) return entries;

    for (const inmate of data) {
      const firstName = (inmate.Inmate_FirstName || '').trim();
      const lastName = (inmate.Inmate_LastName || '').trim();
      const bookingNumber = String(inmate.Inmate_CurrentBookingNumber || '');
      const fullName = lastName && firstName ? `${lastName}, ${firstName}` : `${lastName}${firstName}`;

      // Parse booking date from ISO string
      let bookDate = '';
      if (inmate.Inmate_BookingDate) {
        try {
          const d = new Date(inmate.Inmate_BookingDate);
          bookDate = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
        } catch { /* use empty string */ }
      }

      // Parse offenses into charges + bail
      const charges: string[] = [];
      let totalBail = 0;
      if (Array.isArray(inmate.Offenses)) {
        for (const off of inmate.Offenses) {
          const desc = (off.Offense_Description || '').trim();
          const statute = (off.Offense_Statute || '').trim();
          if (desc) {
            charges.push(statute ? `${desc} (${statute})` : desc);
          }
          if (off.Offense_BondReqAmount && off.Offense_BondReqAmount !== 'Not Set') {
            const amt = parseFloat(String(off.Offense_BondReqAmount).replace(/[$,]/g, ''));
            if (!isNaN(amt)) totalBail += amt;
          }
        }
      }

      entries.push({
        roster_id: bookingNumber,
        full_name: fullName,
        first_name: firstName,
        last_name: lastName,
        middle_name: '',
        gender: '',
        age: null,
        booking_date: bookDate,
        charges,
        bail_amount: totalBail > 0 ? `$${totalBail.toFixed(2)}` : '',
        detail_url: '',
      });
    }

    return entries;
  },
};

// ── Uinta County (PDF) ─────────────────────────────────────
// Auto-generated PDF roster. Actual format from pdf-parse v2:
//   LAST, FIRST MIDDLE
//   Booking Disp: STATUS [Bond Amt:$X.XX Type: TYPE]
//   [optional continuation lines / additional bonds]
//   Booking Date: HH:MM:SS MM/DD/YY
//
// Page separators: "-- N of N --", "Current Inmates\tPage N of N", date line "MM/DD/YY"

const uintaParser: CountyParser = {
  county: 'uinta',

  parseRoster(text: string): RosterEntry[] {
    const entries: RosterEntry[] = [];
    const lines = text.split('\n');

    let currentName = '';
    let currentDisp = '';
    let currentBail = '';
    let currentBailType = '';

    const finalize = (bookingDate: string) => {
      if (!currentName) return;
      const { first, middle, last } = splitName(currentName);
      const rosterId = `uinta-${currentName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;

      entries.push({
        roster_id: rosterId,
        full_name: currentName,
        first_name: first,
        last_name: last,
        middle_name: middle,
        gender: '',
        age: null,
        booking_date: bookingDate,
        charges: currentDisp ? [currentDisp] : [],
        bail_amount: currentBail,
        detail_url: '',
      });

      currentName = '';
      currentDisp = '';
      currentBail = '';
      currentBailType = '';
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Skip page separators and headers
      if (line.match(/^--\s*\d+\s*of\s*\d+\s*--$/) ||
          line.match(/^Current Inmates/) ||
          line.match(/^\d{2}\/\d{2}\/\d{2}$/) ||
          line.match(/^Page \d+ of \d+/) ||
          line.match(/^Uinta County/i)) {
        continue;
      }

      // Booking Date line finalizes the current inmate
      const bookingDateMatch = line.match(/^Booking Date:\s*[\d:]+\s*(\d{2}\/\d{2}\/\d{2,4})/i);
      if (bookingDateMatch) {
        finalize(bookingDateMatch[1]);
        continue;
      }

      // Booking Disp line
      const dispMatch = line.match(/^Booking Disp:\s*(.+)/i);
      if (dispMatch) {
        let dispVal = dispMatch[1].trim();
        // Extract bond if on same line
        const bondMatch = dispVal.match(/Bond Amt:\$?([\d,.]+)\s*Type:\s*(.+)/i);
        if (bondMatch) {
          currentBail = bondMatch[1];
          currentBailType = bondMatch[2].trim();
          dispVal = dispVal.replace(/Bond Amt:.*$/i, '').trim();
        }
        currentDisp = dispVal;
        continue;
      }

      // Standalone Bond Amt line
      const bondLine = line.match(/^Bond Amt:\$?([\d,.]+)\s*Type:\s*(.+)/i);
      if (bondLine) {
        if (!currentBail) {
          currentBail = bondLine[1];
          currentBailType = bondLine[2].trim();
        }
        continue;
      }

      // Disposition continuation (e.g., "SENTENCE" after "CONVICTED PENDING")
      if (currentName && currentDisp && !line.includes(',') &&
          line.match(/^[A-Z]/) && line.length < 40 &&
          !line.match(/^(Booking|Bond|Current|Page|Uinta)/i)) {
        currentDisp += ' ' + line;
        continue;
      }

      // Name line: ALL CAPS, contains comma (LAST, FIRST MIDDLE)
      if (line.match(/^[A-Z][A-Z\s,.\-']+$/) && line.includes(',') &&
          !line.match(/^(BOOKING|BOND|CURRENT|PAGE|SENTENCE)/i)) {
        // If there's a pending entry without a booking date, skip it
        if (currentName) {
          // Previous entry had no booking date — still add it
          finalize('');
        }
        currentName = line;
        currentDisp = '';
        currentBail = '';
        currentBailType = '';
        continue;
      }
    }

    // Handle last entry if no trailing booking date
    if (currentName) finalize('');

    return entries;
  },
};

// ── Summit County (PDF) ─────────────────────────────────────
// Date-stamped PDF rosters. Actual format from pdf-parse v2:
//   Name                     Booking #  Location                  Time      Date
//   Basilio, Salvador        24-00517   JAIL-GHU-- G HOUSING UNIT 13:50:36  04/23/24
//
// Note: Some names run into booking # without space:
//   Hernandez Estrada, Luis Angel25-00273 JAIL-GHU-- ...
//
// Pattern: Name(with comma) + BookingNumber(YY-NNNNN) + Location + Time + Date

const summitParser: CountyParser = {
  county: 'summit',

  parseRoster(text: string): RosterEntry[] {
    const entries: RosterEntry[] = [];
    const lines = text.split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Skip header / report lines
      if (line.match(/^(Report Includes|rpjlcil|Summit County|Current Inmate|Name Booking|All )/i)) continue;

      // Match: Name (has comma), Booking # (YY-NNNNN), then Location, Time HH:MM:SS, Date MM/DD/YY
      // The booking number pattern: 2-digit year, dash, 5-digit number
      const inmateMatch = line.match(
        /^(.+?)\s*(\d{2}-\d{4,6})\s+([A-Z][\w\-]+.*?)\s+(\d{2}:\d{2}:\d{2})\s+(\d{2}\/\d{2}\/\d{2,4})\s*$/
      );

      if (inmateMatch && inmateMatch[1].includes(',')) {
        const fullName = inmateMatch[1].trim();
        const bookingNumber = inmateMatch[2];
        const location = inmateMatch[3].trim();
        const bookingDate = inmateMatch[5]; // MM/DD/YY

        const { first, middle, last } = splitName(fullName);

        entries.push({
          roster_id: bookingNumber,
          full_name: fullName,
          first_name: first,
          last_name: last,
          middle_name: middle,
          gender: '',
          age: null,
          booking_date: bookingDate,
          charges: location ? [`Location: ${location}`] : [],
          bail_amount: '',
          detail_url: '',
        });
      }
    }

    return entries;
  },
};

// ── Salt Lake County (IML search) ────────────────────────────
// Search-only interface at iml.saltlakecounty.gov/IML.
// Requires POST requests for each letter A-Z to get all inmates.
// Results are paginated (30 per page). Roster fields:
//   Inmate Name (last, first middle), Booking Number, SO #

const saltLakeParser: CountyParser = {
  county: 'salt_lake',

  // This parser is special — it gets pre-fetched aggregated HTML from
  // the custom scrape function below, not a single page fetch
  parseRoster(html: string): RosterEntry[] {
    const entries: RosterEntry[] = [];

    // Parse rows: <tr ... onClick="rowClicked('N','sysID','imgSysID')">
    const rowRegex = /<tr[^>]*onClick="rowClicked\('[^']*','(\d+)','(\d+)'\)"[^>]*>([\s\S]*?)<\/tr>/gi;
    let match: RegExpExecArray | null;

    while ((match = rowRegex.exec(html)) !== null) {
      const sysId = match[1];
      const rowHtml = match[3];

      // Extract cells — name, booking#, SO#
      const cells: string[] = [];
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
        cells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
      }
      if (cells.length < 2) continue;

      // Name is in format: "ATWOOD              , COREY JAMES"
      const rawName = (cells[0] || '').replace(/\s+/g, ' ').trim();
      const bookingNumber = (cells[1] || '').trim();
      const { first, middle, last } = splitName(rawName);
      const fullName = rawName;

      entries.push({
        roster_id: bookingNumber || sysId,
        full_name: fullName,
        first_name: first,
        last_name: last,
        middle_name: middle,
        gender: '',
        age: null,
        booking_date: '',
        charges: [],
        bail_amount: '',
        detail_url: '',
      });
    }

    return entries;
  },
};

/**
 * Salt Lake County requires multiple POST requests (one per letter A-Z)
 * plus pagination. This custom fetch function handles that pattern.
 */
async function fetchSaltLakeRoster(): Promise<string> {
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const allHtml: string[] = [];
  const seen = new Set<string>(); // Deduplicate by booking number

  for (const letter of letters) {
    let start = 1;
    let hasMore = true;

    while (hasMore) {
      const body = new URLSearchParams({
        flow_action: 'searchbyname',
        quantity: '500',
        systemUser_firstName: '',
        systemUser_lastName: letter,
        systemUser_includereleasedinmate: 'N',
        systemUser_includereleasedinmate2: 'N',
        currentStart: String(start),
      });

      try {
        const res = await fetch('https://iml.saltlakecounty.gov/IML', {
          method: 'POST',
          headers: {
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) break;
        const html = await res.text();

        // Check for results
        const totalMatch = html.match(/of\s+(\d+)\s+results/);
        const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;
        if (total === 0) break;

        // Extract rows and check for duplicates
        const rows = html.match(/<tr[^>]*onClick="rowClicked[^"]*"[^>]*>[\s\S]*?<\/tr>/gi) || [];
        let newRows = 0;
        for (const row of rows) {
          const bookMatch = row.match(/>\s*(\d{8,})\s*</);
          const key = bookMatch ? bookMatch[1] : row.substring(0, 100);
          if (!seen.has(key)) {
            seen.add(key);
            allHtml.push(row);
            newRows++;
          }
        }

        // Check if there are more pages
        const showingMatch = html.match(/Showing\s+\d+\s+to\s+(\d+)/s);
        const currentEnd = showingMatch ? parseInt(showingMatch[1], 10) : 0;
        if (currentEnd >= total || newRows === 0) {
          hasMore = false;
        } else {
          start = currentEnd + 1;
          await sleep(REQUEST_DELAY_MS);
        }
      } catch (err) {
        console.error(`[Jail Roster] SLCo fetch error for letter ${letter}:`, (err as Error).message);
        break;
      }
    }

    // Polite delay between letters
    await sleep(500);
  }

  console.log(`[Jail Roster] Salt Lake County: aggregated ${allHtml.length} unique inmate rows`);
  return allHtml.join('\n');
}

/**
 * Davis County has paginated results — /sheriff/inmate-roster/Index/{page}/
 * Page 1 is the base URL, pages 2+ are /Index/2/, /Index/3/, etc.
 * Fetches all pages and concatenates the HTML.
 */
async function fetchDavisRoster(): Promise<string> {
  const baseUrl = 'https://www.daviscountyutah.gov/sheriff/inmate-roster';
  const allHtml: string[] = [];

  // Fetch page 1 to determine total pages
  const page1 = await fetchPage(baseUrl);
  allHtml.push(page1);

  // Extract total pages from "Page 1 of 29"
  const pagesMatch = page1.match(/Page\s+\d+\s+of\s+(\d+)/i);
  const totalPages = pagesMatch ? parseInt(pagesMatch[1], 10) : 1;

  console.log(`[Jail Roster] Davis County: ${totalPages} pages to fetch`);

  // Fetch remaining pages
  for (let p = 2; p <= totalPages; p++) {
    await sleep(REQUEST_DELAY_MS);
    try {
      const html = await fetchPage(`${baseUrl}/Index/${p}/`);
      allHtml.push(html);
    } catch (err) {
      console.error(`[Jail Roster] Davis page ${p} fetch error:`, (err as Error).message);
    }
  }

  return allHtml.join('\n');
}

// ════════════════════════════════════════════════════════════
//  JAILTRACKER GENERIC PARSER (multi-state)
// ════════════════════════════════════════════════════════════
// JailTracker (public-safety-cloud.com) is used by ~50+ counties
// across CO, WY, ID, NV, AZ, NM. All share the same JSON API
// pattern — only the county-specific session/parameters differ.
//
// The parser dynamically creates sessions per county and fetches
// the /Inmates/InmatesJSON endpoint which returns structured data.
//
// JailTracker county name mappings (legacy API county parameter values):
// NOTE: As of 2025, JailTracker migrated from ASP.NET MVC to Blazor WASM.
// The old /jtclientweb/JTClientWeb/ path is DEAD — returns HTML for all routes.
// The new API is at /publicroster-api/api/{agencyCode}/search-offenders (POST).
// Counties without a publicroster agency code use the legacy jtclientwebofficial path.
const JAILTRACKER_COUNTY_NAMES: Record<string, string> = {
  // Utah
  ut_washington: 'Washington County',
  // Colorado
  co_mesa: 'Mesa County', co_pueblo: 'Pueblo County', co_larimer: 'Larimer County',
  co_weld: 'Weld County', co_arapahoe: 'Arapahoe County', co_adams: 'Adams County',
  co_jefferson: 'Jefferson County', co_denver: 'Denver County', co_douglas: 'Douglas County',
  co_boulder: 'Boulder County', co_garfield: 'Garfield County',
  // Wyoming
  wy_natrona: 'Natrona County', wy_laramie: 'Laramie County', wy_sweetwater: 'Sweetwater County',
  wy_fremont: 'Fremont County', wy_campbell: 'Campbell County', wy_albany: 'Albany County',
  wy_uinta: 'Uinta County', wy_lincoln: 'Lincoln County', wy_teton: 'Teton County',
  // Idaho
  id_canyon: 'Canyon County', id_bannock: 'Bannock County', id_bonneville: 'Bonneville County',
  id_twin_falls: 'Twin Falls County', id_kootenai: 'Kootenai County', id_bingham: 'Bingham County',
  id_madison: 'Madison County',
  // Nevada
  nv_washoe: 'Washoe County', nv_elko: 'Elko County', nv_lyon: 'Lyon County',
  nv_nye: 'Nye County', nv_carson: 'Carson City', nv_churchill: 'Churchill County',
  nv_white_pine: 'White Pine County',
  // Arizona — Most AZ counties have LEFT JailTracker as of 2025
  az_pima: 'Pima County', az_yavapai: 'Yavapai County', az_mohave: 'Mohave County',
  az_coconino: 'Coconino County', az_yuma: 'Yuma County', az_navajo: 'Navajo County',
  az_apache: 'Apache County', az_cochise: 'Cochise County',
  // New Mexico
  nm_dona_ana: 'Dona Ana County', nm_san_juan: 'San Juan County', nm_sandoval: 'Sandoval County',
  nm_santa_fe: 'Santa Fe County', nm_lea: 'Lea County', nm_chaves: 'Chaves County',
  nm_otero: 'Otero County',
};

// JailTracker facility name mappings for the jtclientwebofficial path
// Format: county_key -> facility name used in URL path (e.g., "Henry_County_MO")
const JAILTRACKER_FACILITY_NAMES: Record<string, string> = {
  // Utah
  ut_washington: 'Washington_County_UT',
  // Colorado
  co_mesa: 'Mesa_County_CO', co_pueblo: 'Pueblo_County_CO', co_larimer: 'Larimer_County_CO',
  co_weld: 'Weld_County_CO', co_arapahoe: 'Arapahoe_County_CO', co_adams: 'Adams_County_CO',
  co_jefferson: 'Jefferson_County_CO', co_denver: 'Denver_County_CO', co_douglas: 'Douglas_County_CO',
  co_boulder: 'Boulder_County_CO', co_garfield: 'Garfield_County_CO',
  // Wyoming
  wy_natrona: 'Natrona_County_WY', wy_laramie: 'Laramie_County_WY', wy_sweetwater: 'Sweetwater_County_WY',
  wy_fremont: 'Fremont_County_WY', wy_campbell: 'Campbell_County_WY', wy_albany: 'Albany_County_WY',
  wy_uinta: 'Uinta_County_WY', wy_lincoln: 'Lincoln_County_WY', wy_teton: 'Teton_County_WY',
  // Idaho
  id_canyon: 'Canyon_County_ID', id_bannock: 'Bannock_County_ID', id_bonneville: 'Bonneville_County_ID',
  id_twin_falls: 'Twin_Falls_County_ID', id_kootenai: 'Kootenai_County_ID', id_bingham: 'Bingham_County_ID',
  id_madison: 'Madison_County_ID',
  // Nevada
  nv_washoe: 'Washoe_County_NV', nv_elko: 'Elko_County_NV', nv_lyon: 'Lyon_County_NV',
  nv_nye: 'Nye_County_NV', nv_carson: 'Carson_City_NV', nv_churchill: 'Churchill_County_NV',
  nv_white_pine: 'White_Pine_County_NV',
  // Arizona
  az_pima: 'Pima_County_AZ', az_yavapai: 'Yavapai_County_AZ', az_mohave: 'Mohave_County_AZ',
  az_coconino: 'Coconino_County_AZ', az_yuma: 'Yuma_County_AZ', az_navajo: 'Navajo_County_AZ',
  az_apache: 'Apache_County_AZ', az_cochise: 'Cochise_County_AZ',
  // New Mexico
  nm_dona_ana: 'Dona_Ana_County_NM', nm_san_juan: 'San_Juan_County_NM', nm_sandoval: 'Sandoval_County_NM',
  nm_santa_fe: 'Santa_Fe_County_NM', nm_lea: 'Lea_County_NM', nm_chaves: 'Chaves_County_NM',
  nm_otero: 'Otero_County_NM',
};

/**
 * Create a JailTracker parser for a specific county.
 * Handles BOTH the legacy JSON shape (Inmates array) AND the new
 * publicroster-api shape (data array with detailsJson).
 */
function createJailTrackerParser(countyKey: string): CountyParser {
  return {
    county: countyKey,

    parseRoster(content: string): RosterEntry[] {
      const entries: RosterEntry[] = [];

      // Guard: if content looks like HTML, it's the Blazor WASM error page
      const trimmed = content.trim();
      if (trimmed.startsWith('<!') || trimmed.startsWith('<html') || trimmed.startsWith('<head')) {
        const htmlErr = new Error(`JailTracker returned HTML instead of JSON for ${countyKey} — platform has migrated to Blazor WASM`);
        (htmlErr as any).noRoster = true;
        throw htmlErr;
      }

      try {
        const data = JSON.parse(content);

        // ── New publicroster-api format ──────────────────────────
        // Shape: { success: true, data: [{ firstName, lastName, middleName, gender,
        //   agencyOffenderId, bookDate, detailsJson: "[{filename:'CriminalOffenses',...}]" }] }
        if (data.success !== undefined && Array.isArray(data.data)) {
          for (const inmate of data.data) {
            const lastName = (inmate.lastName || '').trim();
            const firstName = (inmate.firstName || '').trim();
            const middleName = (inmate.middleName || inmate.nameSuffix || '').trim();
            if (!lastName && !firstName) continue;

            const fullName = middleName
              ? `${lastName}, ${firstName} ${middleName}`
              : `${lastName}, ${firstName}`;

            const rosterId = inmate.agencyOffenderId || inmate.agencyOffenderPermanentId
              || `${lastName}-${firstName}-${Date.now()}`;

            const gender = (inmate.gender || '').charAt(0).toUpperCase();
            const bookingDate = inmate.bookDate || '';

            // Parse charges from detailsJson
            const charges: string[] = [];
            let bail = '';
            let age: number | null = null;
            try {
              const details = typeof inmate.detailsJson === 'string'
                ? JSON.parse(inmate.detailsJson) : (inmate.detailsJson || []);
              for (const section of details) {
                if (section.filename === 'CriminalOffenses' && Array.isArray(section.data)) {
                  for (const offense of section.data) {
                    const charge = offense.Offense || offense.offense || '';
                    if (charge) charges.push(charge);
                    if (!bail && (offense.BondAmount || offense.bondAmount)) {
                      bail = offense.BondAmount || offense.bondAmount;
                    }
                  }
                }
                if (section.filename === 'AdditionalInfo' && Array.isArray(section.data)) {
                  for (const info of section.data) {
                    if (info.Name === 'Age' && info.Value) age = Number(info.Value) || null;
                  }
                }
              }
            } catch { /* detailsJson parse failed — not critical */ }

            entries.push({
              roster_id: String(rosterId),
              full_name: fullName,
              first_name: firstName,
              last_name: lastName,
              middle_name: middleName,
              gender,
              age,
              booking_date: bookingDate,
              charges,
              bail_amount: String(bail || ''),
              detail_url: inmate.multiAgencyName || '',
            });
          }
          return entries;
        }

        // ── Legacy JailTracker JSON shape ────────────────────────
        // Shape: { Inmates: [{ ArrestNo, LastName, FirstName, MiddleName,
        //   Gender, DateOfBirth, BookingDate, TotalBond, Charges: "charge1\ncharge2" }] }
        const inmates = data.Inmates || data.inmates || data.data || [];

        for (const inmate of inmates) {
          const lastName = (inmate.LastName || inmate.lastName || inmate.last_name || '').trim();
          const firstName = (inmate.FirstName || inmate.firstName || inmate.first_name || '').trim();
          const middleName = (inmate.MiddleName || inmate.middleName || inmate.middle_name || '').trim();
          const fullName = middleName
            ? `${lastName}, ${firstName} ${middleName}`
            : `${lastName}, ${firstName}`;

          if (!lastName && !firstName) continue;

          const rosterId = inmate.ArrestNo || inmate.arrestNo || inmate.BookingNo
            || inmate.bookingNo || inmate.InmateID || inmate.inmateId
            || `${lastName}-${firstName}-${Date.now()}`;

          const gender = (inmate.Gender || inmate.gender || '').charAt(0).toUpperCase();

          const bookingDate = inmate.BookingDate || inmate.bookingDate
            || inmate.booking_date || inmate.ArrestDate || '';

          const chargesRaw = inmate.Charges || inmate.charges || inmate.ChargeDescription || '';
          const charges = typeof chargesRaw === 'string'
            ? chargesRaw.split(/[\n;|]+/).map((c: string) => c.trim()).filter(Boolean)
            : Array.isArray(chargesRaw)
              ? chargesRaw.map((c: any) => typeof c === 'string' ? c : c.Description || c.description || '')
              : [];

          const bail = inmate.TotalBond || inmate.totalBond || inmate.BondAmount
            || inmate.bondAmount || inmate.BailAmount || '';

          entries.push({
            roster_id: String(rosterId),
            full_name: fullName,
            first_name: firstName,
            last_name: lastName,
            middle_name: middleName,
            gender,
            age: inmate.Age || inmate.age || null,
            booking_date: bookingDate,
            charges,
            bail_amount: String(bail || ''),
            detail_url: '',
          });
        }
      } catch (err) {
        // Re-throw — don't silently swallow parse errors
        throw new Error(`[JailTracker] Parse error for ${countyKey}: ${(err as Error).message}`);
      }

      return entries;
    },
  };
}

/**
 * Fetch inmate data from a JailTracker deployment.
 *
 * Strategy (as of 2025 platform migration):
 * 1. Try the NEW publicroster-api REST endpoint (POST /search-offenders)
 *    - This is the current production API used by the Blazor WASM frontend
 *    - Requires an agency code (checked via /get-agency-info first)
 * 2. Fall back to the LEGACY jtclientwebofficial MVC path
 *    - Session-based, uses GetInmates with ExtJS-style params
 *    - Still works for many counties but some have left JailTracker
 * 3. If both fail, throw a clear error (NOT silently return 0 records)
 *
 * The OLD /jtclientweb/JTClientWeb/ path is DEAD — Blazor WASM catches all
 * routes and returns HTML. We no longer attempt it.
 */
async function fetchJailTrackerRoster(countyKey: string): Promise<string> {
  const countyName = JAILTRACKER_COUNTY_NAMES[countyKey] || countyKey;
  const facilityName = JAILTRACKER_FACILITY_NAMES[countyKey] || '';

  // ── Strategy 1: New publicroster-api ──────────────────────
  // Try to look up this county's agency code by probing the facility name
  // The publicroster API uses internal agency codes, not county names
  try {
    const infoRes = await fetch(
      `https://omsweb.public-safety-cloud.com/publicroster-api/api/${facilityName}/get-agency-info`,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );

    if (infoRes.ok) {
      const infoData = await infoRes.json();

      // "Invalid facility" from publicroster-api — record this for later
      // (don't auto-disable yet, try legacy jtclientwebofficial first)
      if (infoData.success === false && infoData.errorMessage?.includes?.('Invalid facility')) {
        console.log(`[JailTracker] ${countyKey}: publicroster-api says Invalid facility`);
        // Fall through to Strategy 2
      } else if (infoData.success && infoData.data) {
        console.log(`[JailTracker] ${countyKey}: publicroster-api available (agency: ${facilityName})`);

        // Fetch all current offenders via the search endpoint
        const searchRes = await fetch(
          `https://omsweb.public-safety-cloud.com/publicroster-api/api/${facilityName}/search-offenders`,
          {
            method: 'POST',
            headers: {
              'User-Agent': USER_AGENT,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }
        );

        if (searchRes.ok) {
          const searchText = await searchRes.text();
          // Validate it's JSON, not HTML
          if (searchText.trim().startsWith('{') || searchText.trim().startsWith('[')) {
            return searchText;
          }
        }
      }
    }
  } catch (err) {
    // Re-throw noRoster errors
    if ((err as any).noRoster) throw err;
    console.log(`[JailTracker] ${countyKey}: publicroster-api probe failed:`, (err as Error).message);
  }

  // ── Strategy 2: Legacy jtclientwebofficial path ───────────
  if (facilityName) {
    try {
      const pageUrl = `https://omsweb.public-safety-cloud.com/jtclientwebofficial/jailtracker/index/${facilityName}`;
      const pageRes = await fetch(pageUrl, {
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const pageHtml = await pageRes.text();

      // Check for "Invalid Facility" — county has permanently left JailTracker
      // Throw noRoster error to auto-disable instead of retrying
      if (pageHtml.includes('Invalid Facility')) {
        const err = new Error(`JailTracker: ${countyName} is no longer on JailTracker (Invalid Facility) — auto-disabling`);
        (err as any).noRoster = true;
        throw err;
      }

      // Extract session from Settings.init('sessionId', ...)
      const sessionMatch = pageHtml.match(/Settings\.init\('([^']+)'/);
      if (sessionMatch) {
        const sessionId = sessionMatch[1];
        const apiUrl = `https://omsweb.public-safety-cloud.com/jtclientwebofficial/(S(${sessionId}))/JailTracker/GetInmates?start=0&limit=1000&searchtype=current`;

        const apiRes = await fetch(apiUrl, {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
            Referer: pageRes.url,
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (apiRes.ok) {
          const apiText = await apiRes.text();
          // Validate it's JSON, not HTML
          if (apiText.trim().startsWith('{') || apiText.trim().startsWith('[')) {
            // Check for valid data (not session-time-out or empty string)
            const parsed = JSON.parse(apiText);
            if (parsed.error === 'session-time-out') {
              console.log(`[JailTracker] ${countyKey}: jtclientwebofficial session timed out`);
            } else {
              return apiText;
            }
          }
        }
      }
    } catch (err) {
      // If it's a noRoster error (Invalid Facility, etc.), re-throw — don't fall through
      if ((err as any).noRoster || (err as Error).message.includes('Invalid Facility') || (err as Error).message.includes('no longer on JailTracker')) {
        throw err;
      }
      console.log(`[JailTracker] ${countyKey}: jtclientwebofficial fallback failed:`, (err as Error).message);
    }
  }

  // ── Both strategies failed — auto-disable ────────────────
  const bothFailedErr = new Error(
    `JailTracker API unavailable for ${countyName} — both publicroster-api and jtclientwebofficial failed. Auto-disabling.`
  );
  (bothFailedErr as any).noRoster = true;
  throw bothFailedErr;
}

// ════════════════════════════════════════════════════════════
//  ADDITIONAL UTAH COUNTY PARSERS
// ════════════════════════════════════════════════════════════

// ── Beaver County (HTML) ──────────────────────────────────
// Server-rendered page at beavercountyut.cleanwebdesign.com.
// One <table> per inmate; name in <b>, booking # after "Number:",
// arrest date after "Arrest Date:", charges in <a> tags inside
// div.charge elements. "IN CUSTODY" flag indicates current inmates.

const beaverParser: CountyParser = {
  county: 'ut_beaver',

  parseRoster(html: string): RosterEntry[] {
    const entries: RosterEntry[] = [];

    // Split on <hr> which separates each inmate's table block
    const blocks = html.split(/<tr><td colspan="2"><hr><\/td><\/tr>\s*<\/table>/i);

    for (const block of blocks) {
      // Name: inside <b>NAME</b>
      const nameMatch = block.match(/<b>([^<]+)<\/b>/);
      if (!nameMatch) continue;
      const rawName = nameMatch[1].trim();
      if (!rawName || rawName.length < 3) continue;

      const { first, middle, last } = splitName(rawName);

      // Booking number: "Number: 12345"
      const numMatch = block.match(/Number:\s*(\d+)/);
      const bookingNumber = numMatch ? numMatch[1].trim() : '';

      // Arrest date: "Arrest Date: HH:MM:SS MM/DD/YY"
      const dateMatch = block.match(/Arrest Date:\s*([\d:]+)\s+(\d{2}\/\d{2}\/\d{2,4})/);
      let bookingDate = '';
      if (dateMatch) {
        const [, time, date] = dateMatch;
        // Convert MM/DD/YY to ISO-ish
        const parts = date.split('/');
        if (parts.length === 3) {
          const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
          bookingDate = `${year}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')} ${time}`;
        }
      }

      // Charges: text inside <a> tags within div.charge
      const charges: string[] = [];
      const chargeRegex = /class="charge"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/gi;
      let chargeMatch: RegExpExecArray | null;
      while ((chargeMatch = chargeRegex.exec(block)) !== null) {
        const charge = chargeMatch[1].trim();
        if (charge) charges.push(charge);
      }

      entries.push({
        roster_id: bookingNumber || `beaver-${last}-${first}`,
        full_name: rawName,
        first_name: first,
        last_name: last,
        middle_name: middle,
        gender: '',
        age: null,
        booking_date: bookingDate,
        charges,
        bail_amount: '',
        detail_url: '',
      });
    }

    return entries;
  },
};

// ── Utah County (JSON API) ─────────────────────────────────
// JSON API at sheriff.utahcounty.gov/api/search/name/{letter}
// Returns array of { name, id, status, date_in, dob, person_ptr }
// Status: "A" = active (in custody), "O" = out/released
// We search A-Z and collect all active inmates.

const utahCountyParser: CountyParser = {
  county: 'ut_utah',

  parseRoster(content: string): RosterEntry[] {
    const entries: RosterEntry[] = [];

    try {
      const inmates = JSON.parse(content);
      if (!Array.isArray(inmates)) return entries;

      for (const inmate of inmates) {
        // Only include active inmates
        if (inmate.status !== 'A') continue;

        const rawName = (inmate.name || '').trim();
        if (!rawName) continue;
        const { first, middle, last } = splitName(rawName);

        // Parse date_in ISO date
        let bookingDate = '';
        if (inmate.date_in) {
          const d = new Date(inmate.date_in);
          if (!isNaN(d.getTime())) {
            bookingDate = d.toISOString().split('T')[0];
          }
        }

        entries.push({
          roster_id: String(inmate.id || inmate.zid || `utah-${last}-${first}`),
          full_name: rawName,
          first_name: first,
          last_name: last,
          middle_name: middle,
          gender: '',
          age: null,
          booking_date: bookingDate,
          charges: [],
          bail_amount: '',
          detail_url: '',
        });
      }
    } catch (err) {
      console.error('[Jail Roster] Utah County parse error:', (err as Error).message);
    }

    return entries;
  },
};

/**
 * Utah County uses a JSON API — fetch all active inmates by querying
 * each letter A-Z and aggregating results. Only "A" (active) status inmates
 * are included.
 */
async function fetchUtahCountyRoster(): Promise<string> {
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const allInmates: any[] = [];
  const seen = new Set<number>();

  for (const letter of letters) {
    try {
      const url = `https://sheriff.utahcounty.gov/api/search/name/${encodeURIComponent(letter)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data)) continue;

      for (const inmate of data) {
        // Only active inmates, and deduplicate by ID
        if (inmate.status === 'A' && inmate.id && !seen.has(inmate.id)) {
          seen.add(inmate.id);
          allInmates.push(inmate);
        }
      }
    } catch (err) {
      console.error(`[Jail Roster] Utah County letter ${letter} error:`, (err as Error).message);
    }

    // Polite delay between letter queries
    await sleep(500);
  }

  console.log(`[Jail Roster] Utah County: aggregated ${allInmates.length} active inmates from A-Z search`);
  return JSON.stringify(allInmates);
}

// ── Tooele County (HTML POST → DataTable) ─────────────────
// POST to /Roster/Search with empty last/first returns full roster.
// HTML table rows with: <a id="NUM"> link, last name, first name, middle.
// Detail via GET /roster/viewinmate?num={id}.

const tooeleParser: CountyParser = {
  county: 'ut_tooele',

  parseRoster(html: string): RosterEntry[] {
    const entries: RosterEntry[] = [];

    // Each row: <tr>  <td><a id="12345" ...>icon</a></td>  <td>LAST</td>  <td>FIRST</td>  <td>MIDDLE</td>  </tr>
    const rowRegex = /<tr>\s*<td[^>]*>\s*<a\s+id="(\d+)"[^>]*>[\s\S]*?<\/a>\s*<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>/gi;
    let match: RegExpExecArray | null;

    while ((match = rowRegex.exec(html)) !== null) {
      const inmateId = match[1];
      const lastName = match[2].trim();
      const firstName = match[3].trim();
      const middleName = match[4].trim();

      if (!lastName && !firstName) continue;

      const fullName = middleName
        ? `${lastName}, ${firstName} ${middleName}`
        : `${lastName}, ${firstName}`;

      entries.push({
        roster_id: inmateId,
        full_name: fullName,
        first_name: firstName,
        last_name: lastName,
        middle_name: middleName,
        gender: '',
        age: null,
        booking_date: '',
        charges: [],
        bail_amount: '',
        detail_url: `https://inmate.tooelecountysheriff.org/roster/viewinmate?num=${inmateId}`,
      });
    }

    return entries;
  },

  parseDetail(html: string): DetailFields {
    const fields: DetailFields = {
      height: '', weight: '', hair_color: '', eye_color: '',
      charges: [], case_number: '', bail_type: '',
    };

    // Tooele detail modal typically has structured content
    // Extract charges from table rows
    const chargeRegex = /<td[^>]*>([^<]*(?:FELONY|MISDEMEANOR|INFRACTION|DUI|ASSAULT|THEFT|DRUG|BURGLARY)[^<]*)<\/td>/gi;
    let chargeMatch: RegExpExecArray | null;
    while ((chargeMatch = chargeRegex.exec(html)) !== null) {
      const charge = chargeMatch[1].trim();
      if (charge) fields.charges.push(charge);
    }

    return fields;
  },

  buildDetailUrl(rosterId: string): string {
    return `https://inmate.tooelecountysheriff.org/roster/viewinmate?num=${rosterId}`;
  },
};

/**
 * Tooele County requires a POST to /Roster/Search with empty fields
 * to get the full roster. Also needs the antiforgery token.
 */
async function fetchTooeleRoster(): Promise<string> {
  // Step 1: GET the search page to extract the antiforgery token
  const searchPage = await fetchPage('https://inmate.tooelecountysheriff.org/roster/search');
  const tokenMatch = searchPage.match(/name="__RequestVerificationToken"\s+(?:type="hidden"\s+)?value="([^"]+)"/);
  const token = tokenMatch ? tokenMatch[1] : '';

  // Step 2: POST with empty search to get all inmates
  const body = new URLSearchParams({
    last: '',
    first: '',
  });
  if (token) {
    body.set('__RequestVerificationToken', token);
  }

  const res = await fetch('https://inmate.tooelecountysheriff.org/Roster/Search', {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`Tooele roster HTTP ${res.status}`);
  return await res.text();
}

// ── Carbon County (wpDataTable AJAX) ──────────────────────
// WordPress site with wpDataTable plugin at carbon.utah.gov.
// Table has: LAST_NAME, FIRST_NAME, BookingNo, Arrival, HOLDS1-3.
// Data loaded via admin-ajax.php — we try direct HTML fetch first.

const carbonParser: CountyParser = {
  county: 'ut_carbon',

  parseRoster(html: string): RosterEntry[] {
    const entries: RosterEntry[] = [];

    // wpDataTable renders <table> with <tr> rows after AJAX load.
    // If we got the page HTML, it may have pre-rendered data in some cases,
    // or we may get the AJAX response directly.

    // Try JSON parse first (in case we got AJAX response)
    try {
      const data = JSON.parse(html);
      // wpDataTable AJAX returns { draw, recordsTotal, recordsFiltered, data: [[col1, col2, ...], ...] }
      if (data.data && Array.isArray(data.data)) {
        for (const row of data.data) {
          const lastName = (row[0] || '').replace(/<[^>]+>/g, '').trim();
          const firstName = (row[1] || '').replace(/<[^>]+>/g, '').trim();
          const bookingNo = (row[2] || '').replace(/<[^>]+>/g, '').trim();
          const arrival = (row[3] || '').replace(/<[^>]+>/g, '').trim();
          const holds1 = (row[4] || '').replace(/<[^>]+>/g, '').trim();
          const holds2 = (row[5] || '').replace(/<[^>]+>/g, '').trim();
          const holds3 = (row[6] || '').replace(/<[^>]+>/g, '').trim();

          if (!lastName && !firstName) continue;

          const fullName = `${lastName}, ${firstName}`;
          const charges = [holds1, holds2, holds3].filter(Boolean);

          entries.push({
            roster_id: bookingNo || `carbon-${lastName}-${firstName}`,
            full_name: fullName,
            first_name: firstName,
            last_name: lastName,
            middle_name: '',
            gender: '',
            age: null,
            booking_date: arrival,
            charges,
            bail_amount: '',
            detail_url: '',
          });
        }
        return entries;
      }
    } catch { /* not JSON, try HTML */ }

    // Fallback: parse HTML table rows
    const rowRegex = /<tr[^>]*>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>/gi;
    let match: RegExpExecArray | null;

    while ((match = rowRegex.exec(html)) !== null) {
      const lastName = match[1].trim();
      const firstName = match[2].trim();
      const bookingNo = match[3].trim();
      const arrival = match[4].trim();
      const holds1 = match[5].trim();
      const holds2 = match[6].trim();
      const holds3 = match[7].trim();

      // Skip header row
      if (lastName === 'LAST_NAME') continue;
      if (!lastName && !firstName) continue;

      const fullName = `${lastName}, ${firstName}`;
      const charges = [holds1, holds2, holds3].filter(Boolean);

      entries.push({
        roster_id: bookingNo || `carbon-${lastName}-${firstName}`,
        full_name: fullName,
        first_name: firstName,
        last_name: lastName,
        middle_name: '',
        gender: '',
        age: null,
        booking_date: arrival,
        charges,
        bail_amount: '',
        detail_url: '',
      });
    }

    return entries;
  },
};

// ── Utah State Prison (UDC — Utah Dept of Corrections) ──────
// Searches the UDC offender search by letter A-Z and aggregates
// results. This is similar to the Utah County A-Z search pattern.

const utStatePrisonParser: CountyParser = {
  county: 'ut_state_prison',

  parseRoster(content: string): RosterEntry[] {
    const entries: RosterEntry[] = [];
    try {
      const inmates = JSON.parse(content);
      if (!Array.isArray(inmates)) return entries;

      for (const inmate of inmates) {
        // API returns offenderName in "LAST, FIRST MIDDLE" format
        const rawName = (inmate.offenderName || '').trim();
        if (!rawName) continue;

        const offenderId = String(inmate.offenderNumber || '');
        if (!offenderId) continue;

        // Parse "LAST, FIRST MIDDLE" → first, middle, last
        let first = '', middle = '', last = '';
        const commaIdx = rawName.indexOf(',');
        if (commaIdx > 0) {
          last = rawName.substring(0, commaIdx).trim();
          const rest = rawName.substring(commaIdx + 1).trim().split(/\s+/);
          first = rest[0] || '';
          middle = rest.slice(1).join(' ');
        } else {
          // Fallback to splitName if no comma
          const parsed = splitName(rawName);
          first = parsed.first;
          middle = parsed.middle;
          last = parsed.last;
        }

        // Reconstruct as "FIRST MIDDLE LAST" for display
        const displayName = [first, middle, last].filter(Boolean).join(' ');

        // Parse DOB — API returns "YYYY-MM-DD"
        const dob = inmate.dateOfBirth || '';

        // Location from detail fetch (if available)
        const location = inmate.location || '';

        entries.push({
          roster_id: offenderId,
          full_name: displayName || rawName,
          first_name: first,
          last_name: last,
          middle_name: middle,
          gender: '',
          age: null,
          booking_date: dob, // UDC doesn't expose admission date in public API — use DOB for reference
          charges: [],
          bail_amount: '',
          detail_url: location ? `Facility: ${location}` : '',
        });
      }
    } catch (err) {
      console.error('[Jail Roster] UT State Prison parse error:', (err as Error).message);
    }

    return entries;
  },
};

/**
 * Utah Department of Corrections (UDC) offender search via api.utah.gov.
 *
 * API endpoints discovered from corrections.utah.gov/inmate-services/offender-search/:
 *   Search: GET https://api.utah.gov/udc/v1/public/rest/offenders/name?first={f}&last={l}&index={i}&pageCount=100
 *   Detail: GET https://api.utah.gov/udc/v1/public/rest/offenders/{offenderNumber}
 *
 * The search API returns { results: [{offenderNumber, offenderName, dateOfBirth}], totalCount }.
 * Name matching is broad (contains, not starts-with), so searching A-Z last names
 * with first=a provides near-complete coverage. We paginate each letter up to 10 pages
 * (1,000 results per letter) to balance coverage vs. API load.
 */
async function fetchUtStatePrisonRoster(): Promise<string> {
  const UDC_API = 'https://api.utah.gov/udc/v1/public/rest/offenders/name';
  const PAGE_SIZE = 100;
  const MAX_PAGES_PER_LETTER = 10; // Cap at 1,000 results per letter search
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const allInmates: any[] = [];
  const seen = new Set<number>();
  let successCount = 0;

  for (const letter of letters) {
    let index = 0;
    let pages = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (pages >= MAX_PAGES_PER_LETTER) break;

      try {
        const url = `${UDC_API}?first=a&last=${letter}&index=${index}&pageCount=${PAGE_SIZE}`;
        const res = await fetch(url, {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) break;

        const data = await res.json();
        const results = Array.isArray(data?.results) ? data.results : [];

        if (results.length === 0) break;

        for (const inmate of results) {
          const id = inmate.offenderNumber;
          if (id != null && !seen.has(id)) {
            seen.add(id);
            allInmates.push(inmate);
          }
        }

        successCount++;
        pages++;
        index += PAGE_SIZE;

        // If we got fewer than a full page, no more results
        if (results.length < PAGE_SIZE) break;
        // If totalCount tells us we've fetched everything
        if (data.totalCount && index >= data.totalCount) break;
      } catch {
        break; // Network/timeout error — move to next letter
      }

      await sleep(500); // Polite delay between pages
    }

    await sleep(300); // Brief delay between letters
  }

  if (successCount === 0) {
    console.warn('[Jail Roster] UT State Prison: no API responses received. Check api.utah.gov endpoint.');
  }

  console.log(`[Jail Roster] UT State Prison: aggregated ${allInmates.length} offenders from ${successCount} API pages`);
  return JSON.stringify(allInmates);
}

// ── Parser registry ─────────────────────────────────────────

// ════════════════════════════════════════════════════════════
//  MULTI-STATE CUSTOM PARSERS (non-JailTracker)
// ════════════════════════════════════════════════════════════

// ── Clark County, NV (Las Vegas CCDC) ──────────────────────
// ASP.NET form-based search at redrock.clarkcountynv.gov.
// We search A-Z by last name to build the full roster.

const clarkNvParser: CountyParser = {
  county: 'nv_clark',

  parseRoster(html: string): RosterEntry[] {
    const entries: RosterEntry[] = [];

    // Parse result rows from the combined HTML
    // CCDC results: table rows with ID, Name, Age, Race, Sex, Case, Charge, Status, Arrest Date, etc.
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let match: RegExpExecArray | null;

    while ((match = rowRegex.exec(html)) !== null) {
      const rowHtml = match[1];
      const cells: string[] = [];
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
        cells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
      }

      // Columns: Select(0), InmateID(1), Name(2), ArrestDate(3), Select(4), CaseNo(5), Age(6), Race(7), Sex(8)
      if (cells.length < 7) continue;

      // Skip header rows
      if (cells[1] === 'Inmate ID' || cells[2] === 'Name' || cells[0] === 'Select') continue;

      const inmateId = cells[1] || '';
      const fullName = (cells[2] || '').trim();
      if (!fullName || !inmateId || !inmateId.match(/^\d+$/)) continue;

      const { first, middle, last } = splitName(fullName);
      const gender = (cells[8] || '').charAt(0).toUpperCase();
      const charge = (cells[5] || '').trim(); // Case No
      const arrestDate = (cells[3] || '').trim();

      entries.push({
        roster_id: inmateId,
        full_name: fullName,
        first_name: first,
        last_name: last,
        middle_name: middle,
        gender,
        age: parseInt(cells[6], 10) || null,
        booking_date: arrestDate,
        charges: charge ? [charge] : [],
        bail_amount: '',
        detail_url: '',
      });
    }

    return entries;
  },
};

/**
 * Clark County NV requires A-Z POST searches to build the full roster.
 * ASP.NET form at redrock.clarkcountynv.gov.
 * Form fields: txtName (search input), SearchName (submit button).
 */
async function fetchClarkNvRoster(): Promise<string> {
  const baseUrl = 'https://redrock.clarkcountynv.gov/ccdcincustody/incustodysearch.aspx';
  // Clark County requires 2+ character search prefix — single letters return empty.
  // ASP.NET ViewState breaks after first search, so we need a fresh GET for each prefix.
  // Use 2-letter combinations (AA..ZZ = 676 combos) to cover all last names.
  const allHtml: string[] = [];
  const seen = new Set<string>();
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const prefixes: string[] = [];
  for (const a of alpha) {
    for (const b of alpha) {
      prefixes.push(a + b);
    }
  }

  for (const prefix of prefixes) {
    try {
      // Fresh GET for each search (ASP.NET ViewState is single-use)
      const searchPage = await fetch(baseUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }).then(r => r.text());

      const vsMatch = searchPage.match(/id="__VIEWSTATE"\s+value="([^"]*)"/);
      const evMatch = searchPage.match(/id="__EVENTVALIDATION"\s+value="([^"]*)"/);
      const vsgMatch = searchPage.match(/id="__VIEWSTATEGENERATOR"\s+value="([^"]*)"/);

      const params: Record<string, string> = {
        __VIEWSTATE: vsMatch ? vsMatch[1] : '',
        __EVENTVALIDATION: evMatch ? evMatch[1] : '',
        txtName: prefix,
        SearchName: '  Submit  ',
      };
      if (vsgMatch) params.__VIEWSTATEGENERATOR = vsgMatch[1];

      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) continue;
      const html = await res.text();

      // Extract result rows with inmate IDs, deduplicate
      const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
      let added = 0;
      for (const row of rows) {
        const idMatch = row.match(/<td[^>]*>(\d{5,})<\/td>/);
        if (idMatch && !seen.has(idMatch[1])) {
          seen.add(idMatch[1]);
          allHtml.push(row);
          added++;
        }
      }
    } catch {
      // Skip this prefix
    }

    // Minimal delay — 200ms between requests to avoid overloading
    await sleep(200);
  }

  console.log(`[Jail Roster] Clark County NV: aggregated ${seen.size} unique inmates from ${prefixes.length} prefixes`);
  return allHtml.join('\n');
}

// ── El Paso County, CO ────────────────────────────────────
// JSON API at epcsheriffsoffice.com/search.php. Search A-Z by last name.
// API returns: [{booking_no, name_last, name_first, name_middle, dob, sex, race,
//   building, inmate_charges: [{court_case_no, BondAmount}], inmate_warrants: [{...}]}]

const elPasoCoParser: CountyParser = {
  county: 'co_el_paso',

  parseRoster(content: string): RosterEntry[] {
    const entries: RosterEntry[] = [];
    try {
      const inmates = JSON.parse(content);
      if (!Array.isArray(inmates)) return entries;

      for (const inmate of inmates) {
        const lastName = (inmate.name_last || '').trim();
        const firstName = (inmate.name_first || '').trim();
        const middleName = (inmate.name_middle || '').trim();
        if (!lastName && !firstName) continue;

        const fullName = middleName
          ? `${lastName}, ${firstName} ${middleName}`
          : `${lastName}, ${firstName}`;

        const charges: string[] = [];
        if (Array.isArray(inmate.inmate_charges)) {
          for (const ch of inmate.inmate_charges) {
            if (ch.court_case_no) charges.push(ch.court_case_no);
          }
        }
        if (Array.isArray(inmate.inmate_warrants)) {
          for (const w of inmate.inmate_warrants) {
            if (w.WarrantDescription) {
              charges.push(`${w.WarrantDescription} (${w.WarrantLevel || 'Unknown'})`);
            }
          }
        }

        // Sum bond amounts
        let totalBond = 0;
        if (Array.isArray(inmate.inmate_charges)) {
          for (const ch of inmate.inmate_charges) {
            const amt = parseFloat(String(ch.BondAmount || '0').replace(/[,$]/g, ''));
            if (!isNaN(amt)) totalBond += amt;
          }
        }

        entries.push({
          roster_id: inmate.booking_no || `elpaso-${lastName}-${firstName}`,
          full_name: fullName,
          first_name: firstName,
          last_name: lastName,
          middle_name: middleName,
          gender: inmate.sex || '',
          age: null,
          booking_date: '',
          charges,
          bail_amount: totalBond > 0 ? `$${totalBond.toLocaleString()}` : '',
          detail_url: inmate.building ? `Facility: ${inmate.building}` : '',
        });
      }
    } catch (err) {
      console.error('[Jail Roster] El Paso CO parse error:', (err as Error).message);
    }

    return entries;
  },
};

/**
 * El Paso County CO — JSON API search by last name.
 * API: GET https://epcsheriffsoffice.com/search.php?searchName={name}&searchBooking=
 * Note: API requires full last names (4+ chars) — short prefixes return empty.
 * We search the top ~200 US surnames to cover most inmates.
 */
async function fetchElPasoCoRoster(): Promise<string> {
  const apiUrl = 'https://epcsheriffsoffice.com/search.php';
  const allInmates: any[] = [];
  const seen = new Set<string>();

  // Top 200 US surnames by frequency — covers ~90% of the population
  const surnames = [
    'smith','johnson','williams','brown','jones','garcia','miller','davis','rodriguez','martinez',
    'hernandez','lopez','gonzalez','wilson','anderson','thomas','taylor','moore','jackson','martin',
    'lee','perez','thompson','white','harris','sanchez','clark','ramirez','lewis','robinson',
    'walker','young','allen','king','wright','scott','torres','nguyen','hill','flores',
    'green','adams','nelson','baker','hall','rivera','campbell','mitchell','carter','roberts',
    'gomez','phillips','evans','turner','diaz','parker','cruz','edwards','collins','reyes',
    'stewart','morris','morales','murphy','cook','rogers','gutierrez','ortiz','morgan','cooper',
    'peterson','bailey','reed','kelly','howard','ramos','kim','cox','ward','richardson',
    'watson','brooks','chavez','wood','james','bennett','gray','mendoza','ruiz','hughes',
    'price','alvarez','castillo','sanders','patel','myers','long','ross','foster','jimenez',
    'powell','jenkins','perry','russell','sullivan','bell','coleman','butler','henderson','barnes',
    'gonzales','fisher','vasquez','simmons','griffin','alexander','romero','hunt','mason','dixon',
    'munoz','hunt','hicks','moreno','harvey','palmer','wagner','wallace','gibson','robertson',
    'freeman','black','burns','webb','grant','simpson','hart','craig','hayes','carroll',
    'olson','meyer','hamilton','ford','graham','medina','duncan','ford','carlson','daniels',
    'lynch','vargas','riley','shaw','weaver','snyder','spencer','elliott','jordan','holland',
    'rice','mcdonald','stephens','stone','fernandez','hart','chambers','hawkins','dunn','silva',
    'beck','gordon','harrison','james','berry','bishop','carpenter','welch','stanley','owens',
    'tucker','lane','reynolds','warner','newman','montgomery','soto','perkins','mann','watts',
    'howell','larson','garrett','fields','frank','hines','dean','austin','mendez','cruz',
  ];

  for (const name of surnames) {
    try {
      const url = `${apiUrl}?searchName=${encodeURIComponent(name)}&searchBooking=`;
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', Referer: 'https://epcsheriffsoffice.com/' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) continue;
      const text = await res.text();
      if (!text || text.length < 5) {
        await sleep(300);
        continue;
      }

      let data: any[];
      try {
        data = JSON.parse(text);
      } catch {
        continue;
      }
      if (!Array.isArray(data) || data.length === 0) {
        await sleep(300);
        continue;
      }

      for (const inmate of data) {
        const key = inmate.booking_no || `${inmate.name_last}-${inmate.name_first}`;
        if (!seen.has(key)) {
          seen.add(key);
          allInmates.push(inmate);
        }
      }
    } catch {
      // Skip this name
    }
    await sleep(500);
  }

  console.log(`[Jail Roster] El Paso County CO: aggregated ${allInmates.length} unique inmates from ${surnames.length} surname searches`);
  return JSON.stringify(allInmates);
}

// ── Ada County, ID ────────────────────────────────────────
// ASP.NET WebForms at apps.adacounty.id.gov. Uses postback mechanism.
// Roster refreshes every 24 hours. Search A-Z by last name initials.

const adaIdParser: CountyParser = {
  county: 'id_ada',

  parseRoster(html: string): RosterEntry[] {
    const entries: RosterEntry[] = [];

    // Ada County uses div-based layout with ArrestClickJS(id, this) onclick handlers.
    // Structure: <div onclick="ArrestClickJS(ID, this)">
    //   <div class='myNameTitle'><strong>Last, First Middle</strong></div>
    //   <div class='info'>JID Number: <strong>01234567</strong><br/>Age: 42<br/>Arresting Agency: ...
    //     <div>Charge Count: <span class='badge'>N</span></div>
    //   </div>
    //   ... charge table rows follow ...
    // </div>

    // Match each inmate block by ArrestClickJS call
    const blockRegex = /ArrestClickJS\((\d+),\s*this\)/g;
    let match: RegExpExecArray | null;

    while ((match = blockRegex.exec(html)) !== null) {
      const jid = match[1];
      // Extract a chunk of HTML after this match to parse details
      // Note: must be large enough to skip past base64 mugshot images (~15KB each)
      const startIdx = match.index;
      const chunk = html.substring(startIdx, startIdx + 25000);

      // Name: <strong>Last, First Middle</strong> inside myNameTitle
      const nameMatch = chunk.match(/myNameTitle[\s\S]*?<strong>([^<]+)<\/strong>/);
      if (!nameMatch) continue;
      const nameCell = nameMatch[1].trim();

      // Age
      const ageMatch = chunk.match(/Age:\s*(\d+)/);
      const age = ageMatch ? parseInt(ageMatch[1], 10) : null;

      // Arresting agency (use as detail)
      const agencyMatch = chunk.match(/Arresting Agency:\s*([^<]+)/);
      const agency = agencyMatch ? agencyMatch[1].trim() : '';

      // Charges from charge table rows
      const charges: string[] = [];
      const chargeRegex = /<td[^>]*>([^<]+)<\/td><td>([^<]+)<\/td>/g;
      let chargeMatch: RegExpExecArray | null;
      while ((chargeMatch = chargeRegex.exec(chunk)) !== null) {
        const severity = chargeMatch[1].trim();
        const charge = chargeMatch[2].trim();
        // Skip header rows and severity-only rows
        if (severity === 'Severity' || charge === 'Criminal Charge' || charge === 'Type') continue;
        if (/^[FM]$/.test(severity) && charge.length > 3) {
          charges.push(`${charge} (${severity === 'F' ? 'Felony' : 'Misdemeanor'})`);
        } else if (charge.length > 3) {
          charges.push(charge);
        }
      }

      // Bail total
      const bailMatch = chunk.match(/Bail Total:\s*\$?([\d,]+\.?\d*)/);
      const bail = bailMatch ? `$${bailMatch[1]}` : '';

      const { first, middle, last } = splitName(nameCell);
      const rosterId = `ada-${jid}`;

      entries.push({
        roster_id: rosterId,
        full_name: nameCell,
        first_name: first,
        last_name: last,
        middle_name: middle,
        gender: '',
        age,
        booking_date: '',
        charges,
        bail_amount: bail,
        detail_url: agency ? `Agency: ${agency}` : '',
      });
    }

    return entries;
  },
};

/**
 * Ada County ID — ASP.NET postback-based search. Query A-Z.
 */
async function fetchAdaIdRoster(): Promise<string> {
  const baseUrl = 'https://apps.adacounty.id.gov/sheriff/reports/inmates.aspx';
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  // Collect full HTML pages (parser needs ArrestClickJS div blocks, not just <tr> rows)
  const allPages: string[] = [];
  const seenIds = new Set<string>();

  // ASP.NET ViewState breaks after first search — get fresh page for each letter.
  // The search button is an <a> tag using __doPostBack, so we use __EVENTTARGET.
  for (const letter of letters) {
    try {
      // Fresh GET to get valid ViewState
      const page = await fetch(baseUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }).then(r => r.text());

      const vsMatch = page.match(/id="__VIEWSTATE"\s+value="([^"]*)"/);
      const evMatch = page.match(/id="__EVENTVALIDATION"\s+value="([^"]*)"/);
      const vsgMatch = page.match(/id="__VIEWSTATEGENERATOR"\s+value="([^"]*)"/);

      const params: Record<string, string> = {
        __VIEWSTATE: vsMatch ? vsMatch[1] : '',
        __EVENTVALIDATION: evMatch ? evMatch[1] : '',
        __EVENTTARGET: 'ctl00$ContentPlaceHolder1$btnFilter',
        __EVENTARGUMENT: '',
        'ctl00$ContentPlaceHolder1$txtFilter': letter,
      };
      if (vsgMatch) params.__VIEWSTATEGENERATOR = vsgMatch[1];

      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) continue;
      const html = await res.text();

      // Count new unique inmates in this page
      const idMatches = html.matchAll(/ArrestClickJS\((\d+)/g);
      let newCount = 0;
      for (const m of idMatches) {
        if (!seenIds.has(m[1])) {
          seenIds.add(m[1]);
          newCount++;
        }
      }

      // Only add pages that contain new inmates (avoid duplicating data)
      if (newCount > 0) {
        allPages.push(html);
      }
    } catch {
      // Skip this letter
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`[Jail Roster] Ada County ID: aggregated ${seenIds.size} unique inmates across ${allPages.length} pages`);
  return allPages.join('\n<!-- PAGE_BREAK -->\n');
}

// ── Maricopa County, AZ (MCSO) ───────────────────────────
// Form-based search at mcso.org. Supports name + DOB search.
// We search A-Z by last name.

const maricopaAzParser: CountyParser = {
  county: 'az_maricopa',

  parseRoster(html: string): RosterEntry[] {
    const entries: RosterEntry[] = [];

    // MCSO results display: Name at booking, booking number, charges, facility, status
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let match: RegExpExecArray | null;

    while ((match = rowRegex.exec(html)) !== null) {
      const rowHtml = match[1];
      const cells: string[] = [];
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
        cells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
      }

      if (cells.length < 2) continue;
      if (cells[0].match(/^(Name|Booking|Inmate|Charge)$/i)) continue;

      // Look for name and booking number
      let nameCell = '';
      let bookingNo = '';
      let charge = '';
      let facility = '';

      for (const cell of cells) {
        if (cell.includes(',') && cell.match(/[A-Z]{2,}/i) && !nameCell) {
          nameCell = cell;
        } else if (cell.match(/^[A-Z]?\d{6,}$/i) && !bookingNo) {
          bookingNo = cell;
        } else if (cell.length > 10 && !cell.match(/^\d+$/) && !charge) {
          charge = cell;
        } else if (cell.match(/^(durango|estrella|towers|lower|intake)/i)) {
          facility = cell;
        }
      }

      if (!nameCell) continue;

      const { first, middle, last } = splitName(nameCell);

      entries.push({
        roster_id: bookingNo || `maricopa-${last}-${first}`,
        full_name: nameCell,
        first_name: first,
        last_name: last,
        middle_name: middle,
        gender: '',
        age: null,
        booking_date: '',
        charges: charge ? [charge] : [],
        bail_amount: '',
        detail_url: facility ? `Facility: ${facility}` : '',
      });
    }

    return entries;
  },
};

/**
 * Maricopa County AZ (MCSO) — search by last name.
 *
 * As of 2025, MCSO moved from /InmateSearch to /InmateInfo and added
 * reCAPTCHA (Google reCAPTCHA v2). The old A-Z POST search no longer works.
 * The new /InmateInfo page requires:
 *   1. GET /InmateInfo to obtain __RequestVerificationToken cookie
 *   2. reCAPTCHA challenge (blocks automated access)
 *   3. POST with token + CAPTCHA solution + search params
 *
 * Since reCAPTCHA blocks automated scraping, this function now throws
 * a clear error instead of silently returning 0 results.
 */
async function fetchMaricopaAzRoster(): Promise<string> {
  // Step 1: Check if the new URL is accessible
  const infoUrl = 'https://www.mcso.org/InmateInfo';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(infoUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Maricopa County MCSO returned HTTP ${res.status} — /InmateInfo page unavailable`);
    }

    const html = await res.text();

    // Check for reCAPTCHA — if present, we can't automate
    if (html.includes('reCaptcha') || html.includes('recaptcha') || html.includes('g-recaptcha')) {
      throw new Error(
        'Maricopa County MCSO (mcso.org/InmateInfo) now requires reCAPTCHA — ' +
        'automated scraping is blocked. Manual search only at https://www.mcso.org/InmateInfo'
      );
    }

    // If somehow no reCAPTCHA, try the old POST approach with new URL
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
    const allHtml: string[] = [];
    const seen = new Set<string>();

    for (const letter of letters) {
      try {
        const body = new URLSearchParams({
          txtInmateLastName: letter,
          txtInmateFirstName: '',
          txtInmateDob: '',
        });

        const searchRes = await fetch(infoUrl, {
          method: 'POST',
          headers: {
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!searchRes.ok) continue;
        const searchHtml = await searchRes.text();

        const rows = searchHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
        for (const row of rows) {
          const key = row.substring(0, 100);
          if (!seen.has(key)) {
            seen.add(key);
            allHtml.push(row);
          }
        }
      } catch {
        // Skip this letter
      }
      await sleep(REQUEST_DELAY_MS);
    }

    console.log(`[Jail Roster] Maricopa County AZ: aggregated ${allHtml.length} unique rows`);
    return allHtml.join('\n');
  } finally {
    clearTimeout(timeout);
  }
}

// ── Bernalillo County, NM ─────────────────────────────────
// Server-rendered table at viaintfacep2.bernco.gov/custodylist/Results.
// Full list available without search — just fetch the results page.
// Columns: Inmate (name), Booking Date, Booking Number, Inmate ID, YOB, Housing

const bernalilloNmParser: CountyParser = {
  county: 'nm_bernalillo',

  parseRoster(html: string): RosterEntry[] {
    const entries: RosterEntry[] = [];

    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let match: RegExpExecArray | null;

    while ((match = rowRegex.exec(html)) !== null) {
      const rowHtml = match[1];
      const cells: string[] = [];
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
        cells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
      }

      // Expected: Inmate, Booking Date, Booking Number, Inmate ID, YOB, Housing
      if (cells.length < 4) continue;
      if (cells[0].match(/^(Inmate|Name|#)$/i)) continue;

      const fullName = (cells[0] || '').trim();
      if (!fullName || fullName.length < 3) continue;

      const { first, middle, last } = splitName(fullName);
      const bookingDate = (cells[1] || '').trim();
      const bookingNumber = (cells[2] || '').trim();
      const inmateId = (cells[3] || '').trim();
      const yob = (cells[4] || '').trim();

      // Calculate approximate age from YOB
      let age: number | null = null;
      if (yob && yob.match(/^\d{4}$/)) {
        age = new Date().getFullYear() - parseInt(yob, 10);
      }

      entries.push({
        roster_id: bookingNumber || inmateId || `bernalillo-${last}-${first}`,
        full_name: fullName,
        first_name: first,
        last_name: last,
        middle_name: middle,
        gender: '',
        age,
        booking_date: bookingDate,
        charges: [],
        bail_amount: '',
        detail_url: '',
      });
    }

    return entries;
  },
};

// ── Parser registry ─────────────────────────────────────────

// Start with Utah-specific parsers
const COUNTY_PARSERS: Record<string, CountyParser> = {
  weber: weberParser,
  davis: davisParser,
  iron: ironParser,
  uinta: uintaParser,
  summit: summitParser,
  salt_lake: saltLakeParser,
  ut_beaver: beaverParser,
  ut_utah: utahCountyParser,
  ut_tooele: tooeleParser,
  ut_carbon: carbonParser,
  ut_state_prison: utStatePrisonParser,
  // Multi-state custom parsers
  nv_clark: clarkNvParser,
  co_el_paso: elPasoCoParser,
  id_ada: adaIdParser,
  az_maricopa: maricopaAzParser,
  nm_bernalillo: bernalilloNmParser,
};

// Register JailTracker parsers for all counties in the name map
for (const countyKey of Object.keys(JAILTRACKER_COUNTY_NAMES)) {
  COUNTY_PARSERS[countyKey] = createJailTrackerParser(countyKey);
}

/**
 * Dynamically register parsers at runtime for any DB counties marked
 * as 'jailtracker' that aren't already in JAILTRACKER_COUNTY_NAMES.
 * Called once during scheduler startup so newly-added counties work
 * without a code change.
 */
function ensureJailTrackerParsers(): void {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT county, display_name FROM jail_roster_config WHERE roster_type = 'jailtracker'"
    ).all() as { county: string; display_name: string }[];

    for (const row of rows) {
      if (!COUNTY_PARSERS[row.county]) {
        // Derive a facility name from the county key if not in the map
        // e.g. "co_mesa" → "Mesa_County_CO" (best guess)
        const parts = row.county.split('_');
        const stateAbbr = (parts[0] || '').toUpperCase();
        const countyWords = parts.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1));
        const facilityGuess = [...countyWords, 'County', stateAbbr].join('_');

        if (!JAILTRACKER_COUNTY_NAMES[row.county]) {
          JAILTRACKER_COUNTY_NAMES[row.county] = row.display_name.replace(/,.*/, '').trim();
        }
        if (!JAILTRACKER_FACILITY_NAMES[row.county]) {
          JAILTRACKER_FACILITY_NAMES[row.county] = facilityGuess;
        }
        COUNTY_PARSERS[row.county] = createJailTrackerParser(row.county);
        console.log(`[JailTracker] Auto-registered parser for ${row.county} (facility: ${facilityGuess})`);
      }
    }
  } catch {
    // DB not ready yet — parsers will be registered on first scrape attempt
  }
}

// ════════════════════════════════════════════════════════════
//  SCRAPE ENGINE
// ════════════════════════════════════════════════════════════

function getCountyConfigs(): CountyConfig[] {
  const db = getDb();
  return db.prepare('SELECT * FROM jail_roster_config ORDER BY county').all() as CountyConfig[];
}

function getCountyConfig(county: string): CountyConfig | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM jail_roster_config WHERE county = ?').get(county) as CountyConfig | undefined;
}

// ── Upsert records into arrest_records ──────────────────────

function upsertRosterRecords(county: string, entries: RosterEntry[]): { inserted: number; updated: number } {
  const db = getDb();
  let inserted = 0;
  let updated = 0;

  // Get display name from config, falling back to formatted county key
  const config = getCountyConfig(county);
  const displayName = config?.display_name || `${county.replace(/_/g, ' ').toUpperCase()} Jail`;
  const state = config?.state || 'UT';

  const upsert = db.prepare(`
    INSERT INTO arrest_records (
      jailbase_id, source_id, source_name,
      full_name, first_name, last_name, middle_name,
      booking_date, charges, gender, bail_amount,
      county, state, status, entry_source, detail_fetched,
      created_at, updated_at
    ) VALUES (
      @jailbase_id, @source_id, @source_name,
      @full_name, @first_name, @last_name, @middle_name,
      @booking_date, @charges, @gender, @bail_amount,
      @county, @state, 'active', 'scraper', 0,
      @now, @now
    )
    ON CONFLICT(jailbase_id, source_id) DO UPDATE SET
      full_name = @full_name,
      booking_date = @booking_date,
      charges = @charges,
      gender = @gender,
      bail_amount = @bail_amount,
      state = @state,
      status = 'active',
      updated_at = @now
  `);

  const check = db.prepare('SELECT id FROM arrest_records WHERE jailbase_id = ?');

  const now = localNow();

  const transaction = db.transaction(() => {
    for (const entry of entries) {
      const jailbaseId = `roster-${county}-${entry.roster_id}`;
      const existing = check.get(jailbaseId) as { id: number } | undefined;

      upsert.run({
        jailbase_id: jailbaseId,
        source_id: county,
        source_name: displayName,
        full_name: entry.full_name,
        first_name: entry.first_name,
        last_name: entry.last_name,
        middle_name: entry.middle_name,
        booking_date: entry.booking_date,
        charges: JSON.stringify(entry.charges),
        gender: entry.gender,
        bail_amount: entry.bail_amount ? parseFloat(entry.bail_amount.replace(/[$,]/g, '')) || 0 : 0,
        county: county,
        state,
        now,
      });

      if (existing) updated++;
      else inserted++;
    }
  });

  transaction();
  return { inserted, updated };
}

// ── Release detection ───────────────────────────────────────
// Inmates no longer on the roster are marked as released

function detectReleases(county: string, currentRosterIds: string[]): number {
  const db = getDb();
  const now = localNow();

  // Build jailbase_id prefix for this county
  const prefix = `roster-${county}-`;

  // Get all active scraper records for this county
  const activeRecords = db.prepare(`
    SELECT id, jailbase_id FROM arrest_records
    WHERE source_id = ? AND entry_source = 'scraper' AND status = 'active'
  `).all(county) as { id: number; jailbase_id: string }[];

  const currentIds = new Set(currentRosterIds.map(id => `${prefix}${id}`));
  let released = 0;

  const markReleased = db.prepare(`
    UPDATE arrest_records SET status = 'released', release_date = ?, updated_at = ? WHERE id = ?
  `);

  const transaction = db.transaction(() => {
    for (const rec of activeRecords) {
      if (!currentIds.has(rec.jailbase_id)) {
        markReleased.run(now, now, rec.id);
        released++;
      }
    }
  });

  transaction();
  return released;
}

// ── Detail page fetching ────────────────────────────────────

async function fetchDetailPages(county: string, parser: CountyParser): Promise<number> {
  if (!parser.parseDetail || !parser.buildDetailUrl) return 0;

  const db = getDb();
  let fetched = 0;

  // Get records that haven't had details fetched yet
  const unfetched = db.prepare(`
    SELECT id, jailbase_id FROM arrest_records
    WHERE source_id = ? AND entry_source = 'scraper'
      AND detail_fetched = 0 AND status = 'active'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(county, MAX_DETAIL_BATCH) as { id: number; jailbase_id: string }[];

  const updateDetail = db.prepare(`
    UPDATE arrest_records SET
      height = ?, weight = ?, hair_color = ?, eye_color = ?,
      charges = ?, bail_amount = ?,
      detail_fetched = 1, updated_at = ?
    WHERE id = ?
  `);

  for (const rec of unfetched) {
    try {
      // Extract roster_id from jailbase_id (format: roster-county-id)
      const rosterId = rec.jailbase_id.replace(`roster-${county}-`, '');
      const detailUrl = parser.buildDetailUrl(rosterId);

      await sleep(REQUEST_DELAY_MS);

      const html = await fetchPage(detailUrl);
      const detail = parser.parseDetail(html);

      const now = localNow();
      const charges = detail.charges.length > 0 ? JSON.stringify(detail.charges) : null;
      const bail = detail.bail_type ? parseFloat(detail.bail_type.replace(/[$,]/g, '')) || 0 : null;

      updateDetail.run(
        detail.height || null,
        detail.weight || null,
        detail.hair_color || null,
        detail.eye_color || null,
        charges,
        bail,
        now,
        rec.id,
      );

      fetched++;
    } catch (err) {
      console.error(`[Jail Roster] Error fetching detail for ${rec.jailbase_id}:`, (err as Error).message);
    }
  }

  return fetched;
}

// ── Main scrape cycle for a single county ───────────────────

async function scrapeCounty(county: string): Promise<{
  records_found: number; records_new: number; records_updated: number;
  records_released: number; details_fetched: number;
}> {
  const config = getCountyConfig(county);
  if (!config) throw new Error(`No config for county: ${county}`);

  // Gracefully skip counties with no scrapable roster — auto-disable, don't count as errors
  if (config.roster_type === 'none') {
    const err = new Error(`No public roster available for ${county} (roster_type: none)`);
    (err as any).noRoster = true;
    throw err;
  }

  // If the county has no URL AND no registered parser, it's not scrapable
  if (!config.roster_url && !COUNTY_PARSERS[county]) {
    const err = new Error(`No roster URL or parser configured for ${county} — auto-disabling`);
    (err as any).noRoster = true;
    throw err;
  }

  if (config.consecutive_errors >= CIRCUIT_BREAKER_THRESHOLD) {
    // Mark as circuit-broken error type so syncCounty doesn't re-increment
    const err = new Error(`Circuit breaker active for ${county} (${config.consecutive_errors} errors)`);
    (err as any).circuitBreaker = true;
    throw err;
  }

  // For 'jailtracker' counties, dynamically create a parser if missing
  if (config.roster_type === 'jailtracker' && !COUNTY_PARSERS[county]) {
    const displayName = config.display_name || county;
    JAILTRACKER_COUNTY_NAMES[county] = displayName.replace(/,.*/, '').trim();
    // Best-guess facility name: "co_mesa" → "Mesa_County_CO"
    const parts = county.split('_');
    const stateAbbr = (parts[0] || '').toUpperCase();
    const countyWords = parts.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1));
    JAILTRACKER_FACILITY_NAMES[county] = [...countyWords, 'County', stateAbbr].join('_');
    COUNTY_PARSERS[county] = createJailTrackerParser(county);
    console.log(`[JailTracker] On-demand parser created for ${county}`);
  }

  const parser = COUNTY_PARSERS[county];
  if (!parser) {
    // No parser and not jailtracker — auto-disable instead of crashing
    const err = new Error(`No parser implemented for ${county} (type: ${config.roster_type}) — auto-disabling. Enable when a parser is available.`);
    (err as any).noRoster = true;
    throw err;
  }

  let content: string;

  if (county === 'salt_lake') {
    // Salt Lake County uses a multi-request search pattern
    content = await fetchSaltLakeRoster();
  } else if (county === 'davis') {
    // Davis County has paginated HTML (29 pages)
    content = await fetchDavisRoster();
  } else if (county === 'ut_utah') {
    // Utah County uses a JSON API — search A-Z and aggregate
    content = await fetchUtahCountyRoster();
  } else if (county === 'ut_tooele') {
    // Tooele County requires POST with antiforgery token
    content = await fetchTooeleRoster();
  } else if (county === 'ut_state_prison') {
    // Utah State Prison (UDC) uses A-Z offender search API
    content = await fetchUtStatePrisonRoster();
  } else if (county === 'nv_clark') {
    // Clark County NV — ASP.NET postback search, aggregate A-Z
    content = await fetchClarkNvRoster();
  } else if (county === 'co_el_paso') {
    // El Paso County CO — A-Z letter search aggregation
    content = await fetchElPasoCoRoster();
  } else if (county === 'id_ada') {
    // Ada County ID — ASP.NET WebForms with A-Z search
    content = await fetchAdaIdRoster();
  } else if (county === 'az_maricopa') {
    // Maricopa County AZ — MCSO inmate search API
    content = await fetchMaricopaAzRoster();
  } else if (config.roster_type === 'jailtracker') {
    // JailTracker (public-safety-cloud.com) — tries publicroster-api then legacy jtclientwebofficial
    content = await fetchJailTrackerRoster(county);
  } else if (config.roster_type === 'pdf') {
    content = await parsePdfText(config.roster_url);
  } else {
    // 'html' and 'json' both use fetchPage (returns text — JSON parser handles parsing)
    content = await fetchPage(config.roster_url);
  }

  const entries = parser.parseRoster(content);
  const { inserted, updated } = upsertRosterRecords(county, entries);
  const released = detectReleases(county, entries.map(e => e.roster_id));
  const detailsFetched = await fetchDetailPages(county, parser);

  // Cross-link newly scraped records
  try {
    crossLinkArrests();
  } catch (err) {
    console.error(`[Jail Roster] Cross-link error for ${county}:`, (err as Error).message);
  }

  return {
    records_found: entries.length,
    records_new: inserted,
    records_updated: updated,
    records_released: released,
    details_fetched: detailsFetched,
  };
}

// ── Sync wrapper with logging + circuit breaker ─────────────

async function syncCounty(county: string): Promise<void> {
  const db = getDb();
  const startTime = Date.now();

  try {
    console.log(`[Jail Roster] Scraping ${county}...`);
    const result = await scrapeCounty(county);
    const duration = Date.now() - startTime;

    // Log success
    db.prepare(`
      INSERT INTO jail_roster_sync_log (county, records_found, records_new, records_updated, records_released, details_fetched, status, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, 'success', ?)
    `).run(county, result.records_found, result.records_new, result.records_updated, result.records_released, result.details_fetched, duration);

    // Reset errors + update last_scrape_at
    db.prepare(`
      UPDATE jail_roster_config SET last_scrape_at = ?, consecutive_errors = 0, updated_at = ? WHERE county = ?
    `).run(localNow(), localNow(), county);

    // Successful scrape — reset backoff counter so next failure starts at 1h backoff
    backoffAttempts.delete(county);

    console.log(`[Jail Roster] ${county}: ${result.records_found} found, ${result.records_new} new, ${result.records_updated} updated, ${result.records_released} released, ${result.details_fetched} details (${duration}ms)`);

  } catch (err) {
    // If circuit breaker threw, don't re-increment or spam logs
    if ((err as any).circuitBreaker) return;

    // If no roster available, disable the county and stop silently
    if ((err as any).noRoster) {
      console.log(`[Jail Roster] ${county}: no public roster — auto-disabling`);
      db.prepare('UPDATE jail_roster_config SET enabled = 0, updated_at = ? WHERE county = ?').run(localNow(), county);
      const h = countyIntervals.get(county);
      if (h) { clearInterval(h); countyIntervals.delete(county); }
      return;
    }

    const duration = Date.now() - startTime;
    const errorMsg = (err as Error).message;

    // Log error
    db.prepare(`
      INSERT INTO jail_roster_sync_log (county, records_found, records_new, records_updated, records_released, details_fetched, status, error_message, duration_ms)
      VALUES (?, 0, 0, 0, 0, 0, 'error', ?, ?)
    `).run(county, errorMsg, duration);

    // Increment consecutive errors
    db.prepare(`
      UPDATE jail_roster_config SET consecutive_errors = consecutive_errors + 1, updated_at = ? WHERE county = ?
    `).run(localNow(), county);

    const currentConfig = getCountyConfig(county);
    if (currentConfig && currentConfig.consecutive_errors >= CIRCUIT_BREAKER_THRESHOLD) {
      // Schedule auto-recovery with exponential backoff
      const attempt = (backoffAttempts.get(county) || 0) + 1;
      backoffAttempts.set(county, attempt);
      const backoffMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt - 1), BACKOFF_MAX_MS);
      const backoffHrs = (backoffMs / 3_600_000).toFixed(1);

      console.warn(`[Jail Roster] CIRCUIT BREAKER: ${county} paused after ${currentConfig.consecutive_errors} errors — auto-retry in ${backoffHrs}h (attempt ${attempt})`);

      // Clear any existing backoff timeout for this county
      const existingBackoff = backoffTimeouts.get(county);
      if (existingBackoff) clearTimeout(existingBackoff);

      // Schedule automatic recovery
      const recoveryTimeout = setTimeout(() => {
        backoffTimeouts.delete(county);
        console.log(`[Jail Roster] Auto-recovering ${county} after backoff (attempt ${attempt})`);
        // Reset error counter and try again
        db.prepare('UPDATE jail_roster_config SET consecutive_errors = 0, updated_at = ? WHERE county = ?').run(localNow(), county);
        scheduleCounty(county);
      }, backoffMs);
      backoffTimeouts.set(county, recoveryTimeout);
    } else {
      console.error(`[Jail Roster] Error scraping ${county} (${currentConfig?.consecutive_errors || '?'}/${CIRCUIT_BREAKER_THRESHOLD}):`, errorMsg);
    }
  }
}

// ════════════════════════════════════════════════════════════
//  PUBLIC API
// ════════════════════════════════════════════════════════════

/** Schedule (or re-schedule) a single county's scraper interval */
function scheduleCounty(county: string, initialDelayMs = 0): void {
  // Clear any existing interval for this county
  const existing = countyIntervals.get(county);
  if (existing) {
    clearInterval(existing);
    countyIntervals.delete(county);
  }

  const config = getCountyConfig(county);
  if (!config || !config.enabled) return;

  const intervalMs = (config.scrape_interval_minutes || 30) * 60_000;

  const start = () => {
    syncCounty(county);

    const handle = setInterval(() => {
      const current = getCountyConfig(county);
      if (current && current.consecutive_errors >= CIRCUIT_BREAKER_THRESHOLD) {
        // Circuit breaker tripped — stop interval (auto-recovery is scheduled in syncCounty error handler)
        const h = countyIntervals.get(county);
        if (h) clearInterval(h);
        countyIntervals.delete(county);
        return;
      }
      syncCounty(county);
    }, intervalMs);
    if (handle.unref) handle.unref();
    countyIntervals.set(county, handle);
  };

  if (initialDelayMs > 0) {
    setTimeout(start, initialDelayMs);
  } else {
    start();
  }
}

/** Start the scheduler — call from server startup */
export function scheduleJailRosterSync(): void {
  console.log('[Jail Roster] Scheduler starting in', STARTUP_DELAY_MS / 1000, 'seconds...');

  startupTimeout = setTimeout(() => {
    // Dynamically register parsers for any DB counties with roster_type='jailtracker'
    // that don't already have a parser in COUNTY_PARSERS
    ensureJailTrackerParsers();

    const configs = getCountyConfigs();
    const enabled = configs.filter(c => c.enabled);

    if (enabled.length === 0) {
      console.log('[Jail Roster] No counties enabled — scheduler idle');
      return;
    }

    // Group by state for organized logging
    const byState = new Map<string, CountyConfig[]>();
    for (const c of enabled) {
      const state = c.state || 'UT';
      if (!byState.has(state)) byState.set(state, []);
      byState.get(state)!.push(c);
    }

    const stateList = [...byState.entries()].map(([s, cs]) => `${s}:${cs.length}`).join(', ');
    console.log(`[Jail Roster] Starting scheduler for ${enabled.length} counties (${stateList})`);

    // Stagger start times — 5s between counties (5min total for ~60 counties)
    let staggerIdx = 0;
    enabled.forEach((config) => {
      // Circuit-broken counties will auto-recover via backoff — no need for manual reset
      if (config.consecutive_errors >= CIRCUIT_BREAKER_THRESHOLD) {
        const attempt = (backoffAttempts.get(config.county) || 0) + 1;
        backoffAttempts.set(config.county, attempt);
        const backoffMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt - 1), BACKOFF_MAX_MS);
        const backoffHrs = (backoffMs / 3_600_000).toFixed(1);
        console.log(`[Jail Roster] ${config.county}: circuit breaker active (${config.consecutive_errors} errors) — auto-retry in ${backoffHrs}h`);

        const recoveryTimeout = setTimeout(() => {
          backoffTimeouts.delete(config.county);
          const db = getDb();
          db.prepare('UPDATE jail_roster_config SET consecutive_errors = 0, updated_at = ? WHERE county = ?').run(localNow(), config.county);
          console.log(`[Jail Roster] Auto-recovering ${config.county} after startup backoff`);
          scheduleCounty(config.county);
        }, backoffMs);
        backoffTimeouts.set(config.county, recoveryTimeout);
        return;
      }

      const staggerDelay = staggerIdx * 5_000; // 5s stagger between counties
      staggerIdx++;
      scheduleCounty(config.county, staggerDelay);
    });
  }, STARTUP_DELAY_MS);
}

/** Stop all scraper intervals and backoff timers */
export function stopJailRosterSync(): void {
  if (startupTimeout) {
    clearTimeout(startupTimeout);
    startupTimeout = null;
  }
  for (const [county, handle] of countyIntervals) {
    clearInterval(handle);
  }
  countyIntervals.clear();
  for (const [county, handle] of backoffTimeouts) {
    clearTimeout(handle);
  }
  backoffTimeouts.clear();
  backoffAttempts.clear();
  console.log('[Jail Roster] All schedulers and backoff timers stopped');
}

/** Manual scrape trigger for a specific county */
export async function scrapeCountyManual(county: string): Promise<{ success: boolean; message: string; result?: any }> {
  const parser = COUNTY_PARSERS[county];
  if (!parser) return { success: false, message: `No parser available for county: ${county}` };

  const config = getCountyConfig(county);
  if (!config) return { success: false, message: `No config for county: ${county}` };

  try {
    await syncCounty(county);
    const updatedConfig = getCountyConfig(county);
    return {
      success: true,
      message: `Scrape completed for ${config.display_name}`,
      result: { last_scrape_at: updatedConfig?.last_scrape_at },
    };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

/** Get scraper status for admin panel */
export function getJailRosterStatus(): {
  counties: any[];
  totals: { scraped_records: number; in_custody: number; released: number; counties_active: number };
  recent_syncs: any[];
} {
  const db = getDb();

  // County configs with latest sync info
  const configs = getCountyConfigs();
  const counties = configs.map(c => {
    const lastSync = db.prepare(`
      SELECT * FROM jail_roster_sync_log WHERE county = ? ORDER BY synced_at DESC LIMIT 1
    `).get(c.county) as any;

    const hasParser = !!COUNTY_PARSERS[c.county];
    const isCircuitBroken = c.consecutive_errors >= CIRCUIT_BREAKER_THRESHOLD;
    const isScheduled = countyIntervals.has(c.county);
    const hasBackoff = backoffTimeouts.has(c.county);
    const backoffAttempt = backoffAttempts.get(c.county) || 0;

    return {
      ...c,
      has_parser: hasParser,
      circuit_broken: isCircuitBroken,
      is_scheduled: isScheduled,
      auto_recovering: hasBackoff,
      backoff_attempt: backoffAttempt,
      last_sync: lastSync || null,
    };
  });

  // Totals from arrest_records
  const totals = db.prepare(`
    SELECT
      COUNT(*) as scraped_records,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as in_custody,
      SUM(CASE WHEN status = 'released' THEN 1 ELSE 0 END) as released
    FROM arrest_records WHERE entry_source = 'scraper'
  `).get() as any;

  const countiesActive = configs.filter(c => c.enabled && c.consecutive_errors < CIRCUIT_BREAKER_THRESHOLD).length;

  // Recent sync log
  const recentSyncs = db.prepare(`
    SELECT * FROM jail_roster_sync_log ORDER BY synced_at DESC LIMIT 20
  `).all();

  return {
    counties,
    totals: {
      scraped_records: totals?.scraped_records || 0,
      in_custody: totals?.in_custody || 0,
      released: totals?.released || 0,
      counties_active: countiesActive,
    },
    recent_syncs: recentSyncs,
  };
}

/** Reset circuit breaker for a county */
export function resetCountyErrors(county: string): boolean {
  const db = getDb();
  const result = db.prepare(`
    UPDATE jail_roster_config SET consecutive_errors = 0, updated_at = ? WHERE county = ?
  `).run(localNow(), county);
  if (result.changes === 0) return false;

  // Clear backoff state and restart the county scheduler
  backoffAttempts.delete(county);
  const existingBackoff = backoffTimeouts.get(county);
  if (existingBackoff) {
    clearTimeout(existingBackoff);
    backoffTimeouts.delete(county);
  }

  // Restart the interval if it's not already running
  if (!countyIntervals.has(county)) {
    scheduleCounty(county, 5_000); // 5s delay before first scrape
  }

  return true;
}

/** Update county config (enable/disable, change interval) */
export function updateCountyConfig(county: string, updates: { enabled?: boolean; scrape_interval_minutes?: number }): boolean {
  const db = getDb();
  const sets: string[] = [];
  const params: any[] = [];

  if (updates.enabled !== undefined) {
    sets.push('enabled = ?');
    params.push(updates.enabled ? 1 : 0);
  }
  if (updates.scrape_interval_minutes !== undefined) {
    sets.push('scrape_interval_minutes = ?');
    params.push(updates.scrape_interval_minutes);
  }
  if (sets.length === 0) return false;

  sets.push('updated_at = ?');
  params.push(localNow());
  params.push(county);

  const result = db.prepare(`UPDATE jail_roster_config SET ${sets.join(', ')} WHERE county = ?`).run(...params);

  // Restart scheduler if county was toggled
  if (updates.enabled !== undefined) {
    // Stop existing interval for this county
    const existing = countyIntervals.get(county);
    if (existing) {
      clearInterval(existing);
      countyIntervals.delete(county);
    }

    // Start new interval if enabled
    if (updates.enabled) {
      const config = getCountyConfig(county);
      if (config) {
        const intervalMs = (config.scrape_interval_minutes || 30) * 60_000;
        syncCounty(county); // Immediate first scrape
        const handle = setInterval(() => syncCounty(county), intervalMs);
        if (handle.unref) handle.unref();
        countyIntervals.set(county, handle);
      }
    }
  }

  return result.changes > 0;
}

/** Intake & release statistics per county with daily trends */
export function getJailRosterStatistics(): {
  per_county: any[];
  daily_activity: any[];
  population_summary: any;
  gender_breakdown: any[];
} {
  const db = getDb();

  // ── Per-county breakdown ────────────────────────────────
  const perCounty = db.prepare(`
    SELECT
      ar.source_id AS county,
      jrc.display_name,
      COUNT(*) AS total_records,
      SUM(CASE WHEN ar.status = 'active' THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN ar.status = 'released' THEN 1 ELSE 0 END) AS released_count,
      MIN(ar.booking_date) AS earliest_booking,
      MAX(ar.booking_date) AS newest_booking,
      SUM(CASE WHEN ar.gender IN ('Male','M') THEN 1 ELSE 0 END) AS male_count,
      SUM(CASE WHEN ar.gender IN ('Female','F') THEN 1 ELSE 0 END) AS female_count,
      SUM(CASE WHEN ar.detail_fetched = 1 THEN 1 ELSE 0 END) AS details_fetched,
      ROUND(AVG(CASE
        WHEN ar.status = 'released' AND ar.release_date IS NOT NULL AND ar.booking_date IS NOT NULL
        THEN julianday(ar.release_date) - julianday(ar.booking_date)
        ELSE NULL
      END), 1) AS avg_stay_days
    FROM arrest_records ar
    LEFT JOIN jail_roster_config jrc ON jrc.county = ar.source_id
    WHERE ar.entry_source = 'scraper'
    GROUP BY ar.source_id
    ORDER BY total_records DESC
  `).all();

  // ── Daily intakes & releases from sync log (last 30 days) ─
  const dailyActivity = db.prepare(`
    SELECT
      DATE(synced_at) AS day,
      county,
      SUM(records_new) AS intakes,
      SUM(records_released) AS releases,
      MAX(records_found) AS population,
      COUNT(*) AS scrape_runs
    FROM jail_roster_sync_log
    WHERE status = 'success'
      AND synced_at >= datetime('now', '-30 days')
    GROUP BY DATE(synced_at), county
    ORDER BY day DESC, county
  `).all();

  // ── Overall population summary ──────────────────────────
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total_records,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS total_active,
      SUM(CASE WHEN status = 'released' THEN 1 ELSE 0 END) AS total_released,
      COUNT(DISTINCT source_id) AS counties_with_data
    FROM arrest_records
    WHERE entry_source = 'scraper'
  `).get() as any;

  // Today's intakes & releases (from sync log)
  const todayStats = db.prepare(`
    SELECT
      SUM(records_new) AS intakes_today,
      SUM(records_released) AS releases_today
    FROM jail_roster_sync_log
    WHERE status = 'success'
      AND DATE(synced_at) = DATE('now', 'localtime')
  `).get() as any;

  // ── Gender breakdown across all counties ────────────────
  const genderBreakdown = db.prepare(`
    SELECT
      source_id AS county,
      CASE
        WHEN gender IN ('Male', 'M') THEN 'Male'
        WHEN gender IN ('Female', 'F') THEN 'Female'
        ELSE 'Unknown'
      END AS gender_group,
      COUNT(*) AS count
    FROM arrest_records
    WHERE entry_source = 'scraper' AND status = 'active'
    GROUP BY source_id, gender_group
    ORDER BY source_id, count DESC
  `).all();

  return {
    per_county: perCounty,
    daily_activity: dailyActivity,
    population_summary: {
      ...summary,
      intakes_today: todayStats?.intakes_today || 0,
      releases_today: todayStats?.releases_today || 0,
    },
    gender_breakdown: genderBreakdown,
  };
}

/** List available county parsers */
export function getAvailableParsers(): string[] {
  return Object.keys(COUNTY_PARSERS);
}
