// Pure extraction helpers for the jail scraper runner.
// DOM rows (already pulled out of the page by Playwright as plain objects)
// → normalized booking objects. No Playwright/DOM imports here so this is
// unit-testable with `node --test`.

const SENTINELS = new Set(['', 'none', 'n/a', 'na', 'null', 'unknown', '-', '--']);
export const isReal = (v) => v != null && !SENTINELS.has(String(v).trim().toLowerCase());

export function cleanText(v) {
  return isReal(v) ? String(v).replace(/\s+/g, ' ').trim() : null;
}

// Normalize a variety of date strings to YYYY-MM-DD where possible; else
// return the cleaned original (the backend stores it as text either way).
export function normalizeDate(v) {
  const s = cleanText(v);
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})/); // M/D/Y or M-D-Y
  if (m) {
    const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yr}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // already ISO
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return s;
}

// "Last, First Middle" → {first,last}; "First Last" → {first,last}.
export function splitName(full) {
  const s = cleanText(full);
  if (!s) return { full_name: null, first_name: null, last_name: null };
  if (s.includes(',')) {
    const [last, rest] = s.split(',');
    const parts = cleanText(rest)?.split(/\s+/) || [];
    return { full_name: `${cleanText(parts.join(' ')) || ''} ${cleanText(last)}`.trim(), first_name: parts[0] || null, last_name: cleanText(last) };
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { full_name: s, first_name: null, last_name: parts[0] };
  return { full_name: s, first_name: parts[0], last_name: parts[parts.length - 1] };
}

export function joinCharges(v) {
  if (Array.isArray(v)) return v.map(cleanText).filter(Boolean).join('; ') || null;
  return cleanText(v);
}

// One scraped row (selector-extracted strings) → a booking payload for
// POST /api/intel/jail/ingest-bookings.
export function rowToBooking(row, county) {
  const name = splitName(row.name);
  return {
    booking_id: cleanText(row.bookingId) || '',
    full_name: name.full_name,
    first_name: name.first_name,
    last_name: name.last_name,
    dob: normalizeDate(row.dob),
    booking_date: normalizeDate(row.bookingDate),
    charges: joinCharges(row.charges),
    county,
    mugshot_url: cleanText(row.mugshot),
    detail_url: cleanText(row.detail),
  };
}

// Drop rows with no usable identity so we never POST empty bookings.
export function usableBookings(rows, county) {
  return rows.map((r) => rowToBooking(r, county)).filter((b) => isReal(b.last_name) || isReal(b.full_name));
}
