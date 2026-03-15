// ============================================================
// Utah County Jail Roster Scraper
// ============================================================
// Scrapes inmate roster data directly from Utah county jail
// websites (HTML pages and PDF documents), stores records in
// the existing arrest_records table with entry_source='scraper'.
//
// Supported counties:
//   HTML: Weber, Davis, Iron
//   PDF:  Uinta, Summit
//
// Design:
//   - Per-county parsers implement CountyParser interface
//   - Polite scraping: 1.5s between detail fetches, circuit breaker
//   - Release detection: inmates gone from roster → status='released'
//   - Cross-linking: warrants, court events, persons (reuses arrestScraper)
//   - Scheduler: configurable per-county intervals
// ============================================================

import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import { crossLinkArrests } from './arrestScraper';

// ── Constants ───────────────────────────────────────────────

const USER_AGENT = 'RMPG-Flex/1.0 (Law Enforcement CAD/RMS)';
const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_DELAY_MS = 1_500;          // Between detail page fetches
const MAX_DETAIL_BATCH = 50;             // Max detail pages per scrape cycle
const CIRCUIT_BREAKER_THRESHOLD = 3;     // Consecutive errors → pause county
const DEFAULT_INTERVAL_MS = 30 * 60_000; // 30 minutes
const STARTUP_DELAY_MS = 30_000;         // 30s after server start

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
}

// ── Scheduler state ─────────────────────────────────────────

const countyIntervals = new Map<string, ReturnType<typeof setInterval>>();
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

// ── Parser registry ─────────────────────────────────────────

const COUNTY_PARSERS: Record<string, CountyParser> = {
  weber: weberParser,
  davis: davisParser,
  iron: ironParser,
  uinta: uintaParser,
  summit: summitParser,
  salt_lake: saltLakeParser,
};

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

  const displayName = COUNTY_PARSERS[county]?.county
    ? `${county.charAt(0).toUpperCase() + county.slice(1)} County Jail`
    : `${county} County Jail`;

  const upsert = db.prepare(`
    INSERT INTO arrest_records (
      jailbase_id, source_id, source_name,
      full_name, first_name, last_name, middle_name,
      booking_date, charges, gender, bail_amount,
      county, status, entry_source, detail_fetched,
      created_at, updated_at
    ) VALUES (
      @jailbase_id, @source_id, @source_name,
      @full_name, @first_name, @last_name, @middle_name,
      @booking_date, @charges, @gender, @bail_amount,
      @county, 'active', 'scraper', 0,
      @now, @now
    )
    ON CONFLICT(jailbase_id, source_id) DO UPDATE SET
      full_name = @full_name,
      booking_date = @booking_date,
      charges = @charges,
      gender = @gender,
      bail_amount = @bail_amount,
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
  if (config.consecutive_errors >= CIRCUIT_BREAKER_THRESHOLD) {
    throw new Error(`Circuit breaker active for ${county} (${config.consecutive_errors} errors)`);
  }

  const parser = COUNTY_PARSERS[county];
  if (!parser) throw new Error(`No parser for county: ${county}`);

  let content: string;

  if (county === 'salt_lake') {
    // Salt Lake County uses a multi-request search pattern
    content = await fetchSaltLakeRoster();
  } else if (county === 'davis') {
    // Davis County has paginated HTML (29 pages)
    content = await fetchDavisRoster();
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

    console.log(`[Jail Roster] ${county}: ${result.records_found} found, ${result.records_new} new, ${result.records_updated} updated, ${result.records_released} released, ${result.details_fetched} details (${duration}ms)`);

  } catch (err) {
    const duration = Date.now() - startTime;
    const errorMsg = (err as Error).message;

    // Don't increment errors or log when circuit breaker itself rejected the attempt
    if (errorMsg.startsWith('Circuit breaker active')) {
      console.log(`[Jail Roster] ${county}: circuit breaker still active, skipping`);
      return;
    }

    // Log actual error
    db.prepare(`
      INSERT INTO jail_roster_sync_log (county, records_found, records_new, records_updated, records_released, details_fetched, status, error_message, duration_ms)
      VALUES (?, 0, 0, 0, 0, 0, 'error', ?, ?)
    `).run(county, errorMsg, duration);

    // Increment consecutive errors
    db.prepare(`
      UPDATE jail_roster_config SET consecutive_errors = consecutive_errors + 1, updated_at = ? WHERE county = ?
    `).run(localNow(), county);

    const config = getCountyConfig(county);
    if (config && config.consecutive_errors + 1 >= CIRCUIT_BREAKER_THRESHOLD) {
      console.error(`[Jail Roster] CIRCUIT BREAKER: ${county} paused after ${config.consecutive_errors + 1} consecutive errors`);
    }

    console.error(`[Jail Roster] Error scraping ${county}:`, errorMsg);
  }
}

// ════════════════════════════════════════════════════════════
//  PUBLIC API
// ════════════════════════════════════════════════════════════

/** Start the scheduler — call from server startup */
export function scheduleJailRosterSync(): void {
  console.log('[Jail Roster] Scheduler starting in', STARTUP_DELAY_MS / 1000, 'seconds...');

  startupTimeout = setTimeout(() => {
    const configs = getCountyConfigs();
    const enabled = configs.filter(c => c.enabled);

    if (enabled.length === 0) {
      console.log('[Jail Roster] No counties enabled — scheduler idle');
      return;
    }

    console.log(`[Jail Roster] Starting scheduler for ${enabled.length} counties: ${enabled.map(c => c.county).join(', ')}`);

    // Stagger start times so counties don't all scrape at once
    enabled.forEach((config, idx) => {
      const staggerDelay = idx * 10_000; // 10s stagger between counties
      const intervalMs = (config.scrape_interval_minutes || 30) * 60_000;

      // Initial scrape after stagger
      setTimeout(() => {
        syncCounty(config.county);

        // Then on interval
        const handle = setInterval(() => syncCounty(config.county), intervalMs);
        countyIntervals.set(config.county, handle);
      }, staggerDelay);
    });
  }, STARTUP_DELAY_MS);
}

/** Stop all scraper intervals */
export function stopJailRosterSync(): void {
  if (startupTimeout) {
    clearTimeout(startupTimeout);
    startupTimeout = null;
  }
  for (const [county, handle] of countyIntervals) {
    clearInterval(handle);
    console.log(`[Jail Roster] Stopped scheduler for ${county}`);
  }
  countyIntervals.clear();
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

    return {
      ...c,
      has_parser: hasParser,
      circuit_broken: isCircuitBroken,
      is_scheduled: isScheduled,
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
  return result.changes > 0;
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
      AND DATE(synced_at) = DATE('now')
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
