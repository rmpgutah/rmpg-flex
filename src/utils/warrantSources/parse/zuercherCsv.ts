/**
 * Zuercher portal CSV export parser (`web_warrant_list.csv`).
 *
 * Many Zuercher-platform sheriffs expose their warrant roster as a CSV download
 * (Teton County WY and others publish the read-only `viewinmates` credentials on
 * their public warrant page). The header row names the columns; this parser maps
 * by column NAME (case-insensitive), so the same parser works for any county that
 * uses the standard Zuercher CSV interface. Typical header:
 *
 *   Date_Issued,Last_First_Name,Weight,Age,Front_Mugshot,Charges,Warrant_Number,
 *   Eye_Color,Bond,Sex,Height_inches_,Hair_Color
 *
 * Last_First_Name and Charges are quoted when they embed commas. Dates use a
 * 2-digit year (MM/DD/YY).
 *
 * Robustness contract: never throw; return [] on empty/unrecognised input.
 */

import type { RawWarrantHit } from '../types';
import { cleanName, normalizeDate, normalizeBond } from '../normalize';
import { deriveWarrantId } from './socrata';

/** RFC4180 CSV tokenizer over the WHOLE text — a quoted field may contain commas,
 *  doubled "" escapes, AND embedded newlines (Zuercher charge text wraps), so a
 *  record boundary is an UNQUOTED newline, not every physical line. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  let started = false; // saw any char on the current record
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQ = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQ = true; started = true; }
    else if (c === ',') { row.push(field.trim()); field = ''; started = true; }
    else if (c === '\r') { /* ignore CR */ }
    else if (c === '\n') {
      if (started || field) { row.push(field.trim()); rows.push(row); row = []; field = ''; started = false; }
    } else { field += c; started = true; }
  }
  if (started || field) { row.push(field.trim()); rows.push(row); }
  return rows;
}

/** Expand a MM/DD/YY (or MM/DD/YYYY) date to ISO. */
function parseCsvDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(raw.trim());
  if (m) return normalizeDate(`${m[1]}/${m[2]}/20${m[3]}`);
  return normalizeDate(raw);
}

function splitName(raw: string): {
  last_name: string | null; first_name: string | null; middle_name: string | null; full_name: string;
} {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  const commaIdx = trimmed.indexOf(',');
  if (commaIdx === -1) {
    const ln = cleanName(trimmed) || null;
    return { last_name: ln, first_name: null, middle_name: null, full_name: ln ?? '' };
  }
  const lastRaw = trimmed.slice(0, commaIdx).trim();
  const givenRaw = trimmed.slice(commaIdx + 1).trim();
  const given = givenRaw ? givenRaw.split(/\s+/) : [];
  return {
    last_name: cleanName(lastRaw) || null,
    first_name: given.length > 0 ? cleanName(given[0]) : null,
    middle_name: given.length > 1 ? cleanName(given.slice(1).join(' ')) : null,
    full_name: cleanName([lastRaw, givenRaw].filter(Boolean).join(', ')),
  };
}

/**
 * Parse a Zuercher portal warrant CSV into `RawWarrantHit` records.
 *
 * @param text       The CSV text (header row + data rows).
 * @param sourceKey  Source key (e.g. "csv-zuercher-teton-wy").
 * @param state      Two-letter state code.
 */
export function parseZuercherCsv(text: string, sourceKey: string, state: string): RawWarrantHit[] {
  if (!text || typeof text !== 'string') return [];
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const iName = col('last_first_name');
  const iWarr = col('warrant_number');
  // Require the signature warrant columns or it isn't a Zuercher warrant CSV.
  if (iName < 0 || iWarr < 0) return [];
  const iDate = col('date_issued');
  const iCharge = col('charges');
  const iBond = col('bond');
  const iAge = col('age');

  const hits: RawWarrantHit[] = [];
  const seen = new Set<string>();

  for (let r = 1; r < rows.length; r++) {
    try {
      const f = rows[r];
      const nameRaw = f[iName] ?? '';
      const { last_name, first_name, middle_name, full_name } = splitName(nameRaw);
      if (!full_name) continue;
      const warrantNo = (f[iWarr] ?? '').trim();
      const issue_date = parseCsvDate(f[iDate]);
      const charge = (iCharge >= 0 ? f[iCharge] : '')?.replace(/\s+/g, ' ').trim() || null;
      const ageStr = iAge >= 0 ? f[iAge] : '';
      const age = ageStr && /^\d+$/.test(ageStr) ? Number(ageStr) : null;
      const warrant_id = warrantNo || deriveWarrantId([full_name, issue_date, charge]);
      if (seen.has(warrant_id)) continue;
      seen.add(warrant_id);

      hits.push({
        source_key: sourceKey,
        warrant_id,
        first_name,
        middle_name,
        last_name,
        full_name,
        age,
        state,
        charge_description: charge,
        bail_amount: iBond >= 0 ? normalizeBond(f[iBond]) : null,
        issue_date,
        case_number: warrantNo || undefined,
      });
    } catch {
      continue;
    }
  }

  return hits;
}
