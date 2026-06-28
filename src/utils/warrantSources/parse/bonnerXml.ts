/**
 * Bonner County, ID sheriff structured-XML warrant feed parser.
 *
 * The sheriff publishes a clean XML document (felony + misdemeanor at separate
 * URLs); each record is a flat `<warrant>` element whose children carry the
 * fields with human-readable prefixes:
 *
 *   <warrant>
 *     <name>Achziger, Andrew James</name>
 *     <dob>DOB:01/09/1975</dob>
 *     <number>Warrant:34297</number>
 *     <issued>Issued:12/07/2021</issued>
 *     <class>Class:FE</class>          (FE = felony, MI = misdemeanor)
 *     <description>FTA/Possession Of Controlled Substance</description>
 *     <bond>$20000.00</bond>
 *   </warrant>
 *
 * No DOM parser is needed (Workers-safe): the schema is flat, so a per-element
 * regex extraction is sufficient and robust.
 *
 * Robustness contract: never throw; return [] on empty/non-warrant input.
 */

import type { RawWarrantHit } from '../types';
import { cleanName, normalizeDate, normalizeBond } from '../normalize';
import { deriveWarrantId } from './socrata';

/** Decode the handful of XML entities that appear in name/charge text. */
function decode(s: string): string {
  // `&amp;` MUST be decoded LAST so an already-encoded literal like
  // `&amp;lt;` (which represents the text `&lt;`, not `<`) is not
  // double-unescaped into `<`. Order matters; CodeQL js/double-escaping
  // flags the inverted ordering as a real bug.
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

/** Pull the text of the first <tag>…</tag> in a block, with any `Label:` prefix stripped. */
function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  if (!m) return null;
  const raw = decode(m[1]).replace(/^[A-Za-z ]+:\s*/, ''); // drop "DOB:", "Warrant:", "Issued:", "Class:", "Counts:"
  return raw || null;
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
 * Parse the Bonner County ID warrant XML into `RawWarrantHit` records.
 *
 * @param text       The XML document text.
 * @param sourceKey  Source key (e.g. "xml-bonner-felony-id").
 * @param state      Two-letter state code ("ID").
 */
export function parseBonnerXml(text: string, sourceKey: string, state: string): RawWarrantHit[] {
  if (!text || typeof text !== 'string' || !/<warrant>/i.test(text)) return [];

  const hits: RawWarrantHit[] = [];
  const seen = new Set<string>();
  const blocks = text.match(/<warrant>[\s\S]*?<\/warrant>/gi) ?? [];

  for (const block of blocks) {
    try {
      const nameRaw = tag(block, 'name');
      if (!nameRaw) continue;
      const { last_name, first_name, middle_name, full_name } = splitName(nameRaw);
      if (!full_name) continue;

      const number = tag(block, 'number');
      const dob = normalizeDate(tag(block, 'dob'));
      const cls = (tag(block, 'class') ?? '').toUpperCase();
      const warrant_type = cls.startsWith('FE') ? 'Felony' : cls.startsWith('MI') ? 'Misdemeanor' : null;
      const warrant_id = number || deriveWarrantId([full_name, dob, tag(block, 'description')]);
      if (seen.has(warrant_id)) continue;
      seen.add(warrant_id);

      hits.push({
        source_key: sourceKey,
        warrant_id,
        first_name,
        middle_name,
        last_name,
        full_name,
        date_of_birth: dob,
        state,
        charge_description: tag(block, 'description'),
        bail_amount: normalizeBond(tag(block, 'bond')),
        issue_date: normalizeDate(tag(block, 'issued')),
        case_number: number ?? undefined,
        warrant_type,
      });
    } catch {
      continue;
    }
  }

  return hits;
}
