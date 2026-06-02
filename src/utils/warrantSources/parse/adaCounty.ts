/**
 * Ada County (ID) warrant HTML parser.
 *
 * Pure, dependency-free, no I/O. Part of the multi-source warrant-scraping
 * framework: turns the Ada County public-warrant search page into a flat list
 * of `RawWarrantHit`s for downstream upsert/reconciliation.
 *
 * Parsing approach: a plain Cloudflare Worker has no DOMParser, and the page
 * structure here is regular and well-bounded, so we string-scan rather than
 * pull in a DOM library. We deliberately parse ONLY the desktop `.hidden-xs`
 * view of each person block; the page duplicates every block into a
 * `.visible-xs` responsive table, and parsing both would double-count.
 *
 * Robustness contract: never throw on a malformed person/row — skip it. A site
 * redesign must degrade to `[]` (or fewer hits) so the framework's circuit
 * breaker can surface "source returned nothing" rather than crashing the run.
 *
 * Fixture-verified structure (per person):
 *   <div ... class='arrest' ...>
 *     ... <div class='myNameTitle'><strong>Last, First M</strong>...</div>
 *     ... <div class='info'> ... Age: NN ... </div>
 *     <div class='hidden-xs'>
 *       <table class="charge table table-condensed table-responsive">
 *         <tr><th>Warrant #</th><th>Issued</th><th>Severity</th><th>Bond Amount</th></tr>
 *         <tr><td class="small newChargeWarrantLine">WARRANT#</td>
 *             <td class="... newChargeWarrantLine">ISSUED</td>
 *             <td class="... newChargeWarrantLine">SEVERITY</td>
 *             <td class="... newChargeWarrantLine">$BOND</td></tr>
 *         <tr><td colspan="4">...<ul><li>CHARGE TEXT</li>...</ul>...</td></tr>
 *         ... (repeats for additional warrants on the same person) ...
 *         <tr>...<td ... colspan="2">Bonds Total: $X</td></tr>  (footer — NOT a warrant)
 *       </table>
 *     </div>
 *     <div class='visible-xs'> ...responsive duplicate, ignored... </div>
 *   </div>
 */

import type { RawWarrantHit } from '../types';

const SOURCE_KEY = 'ada-county-id';
const STATE = 'ID';

/** Strip tags + decode the handful of entities the page emits, then trim. */
function text(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "$3,000.00" -> 3000; non-numeric / blank -> null. Never throws. */
function parseMoney(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Parse "Last, First Middle" into parts. Resilient to missing pieces. */
function parseName(full: string): { last: string | null; first: string | null; middle: string | null } {
  const trimmed = full.trim();
  if (!trimmed) return { last: null, first: null, middle: null };
  const commaIdx = trimmed.indexOf(',');
  if (commaIdx === -1) {
    // No comma — treat the whole thing as a last name fallback.
    return { last: trimmed, first: null, middle: null };
  }
  const last = trimmed.slice(0, commaIdx).trim() || null;
  const rest = trimmed.slice(commaIdx + 1).trim();
  if (!rest) return { last, first: null, middle: null };
  const parts = rest.split(/\s+/);
  const first = parts.shift() || null;
  const middle = parts.length ? parts.join(' ') : null;
  return { last, first, middle };
}

/** Pull the desktop `.hidden-xs` charge table for one person block, or null. */
function extractDesktopTable(block: string): string | null {
  const m = block.match(/<div class='hidden-xs'>\s*(<table[^>]*charge[^>]*>[\s\S]*?<\/table>)/i);
  return m ? m[1] : null;
}

/**
 * Split the document into per-person blocks. Each begins at a
 * `class='arrest'` container and runs until the next one (or EOF).
 */
function splitPersonBlocks(html: string): string[] {
  const blocks: string[] = [];
  const re = /class='arrest'/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    // Back up to the opening '<' of this element so the block includes it.
    const open = html.lastIndexOf('<', m.index);
    starts.push(open === -1 ? m.index : open);
  }
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : html.length;
    blocks.push(html.slice(starts[i], end));
  }
  return blocks;
}

export function parseAdaCounty(html: string): RawWarrantHit[] {
  if (typeof html !== 'string' || html.length === 0) return [];

  const hits: RawWarrantHit[] = [];
  const blocks = splitPersonBlocks(html);

  for (const block of blocks) {
    try {
      // --- Name ---
      const nameMatch = block.match(/<div class='myNameTitle'>\s*<strong>([\s\S]*?)<\/strong>/i);
      const fullName = nameMatch ? text(nameMatch[1]) : '';
      const { last, first, middle } = parseName(fullName);

      // --- Age ("Age: NN") ---
      let age: number | null = null;
      const ageMatch = block.match(/Age:\s*(\d{1,3})/i);
      if (ageMatch) {
        const a = parseInt(ageMatch[1], 10);
        age = Number.isFinite(a) ? a : null;
      }

      // --- Desktop warrant table ---
      const table = extractDesktopTable(block);
      if (!table) continue;

      // Real warrant data rows have exactly the unmodified
      // `class="small newChargeWarrantLine"` (no colspan). The "Bonds Total"
      // footer uses colspan="2" and a different class string, so it won't match.
      const warrantCellRe = /<td class="small newChargeWarrantLine">([\s\S]*?)<\/td>\s*<td class="[^"]*newChargeWarrantLine">([\s\S]*?)<\/td>\s*<td class="[^"]*newChargeWarrantLine">([\s\S]*?)<\/td>\s*<td class="[^"]*newChargeWarrantLine">([\s\S]*?)<\/td>/gi;

      // Charge rows (colspan="4") carry the <li> text, one per warrant, in order.
      const chargeRowRe = /<td class="small" colspan="4">([\s\S]*?)<\/td>/gi;
      const charges: string[] = [];
      let cm: RegExpExecArray | null;
      while ((cm = chargeRowRe.exec(table)) !== null) {
        const lis = cm[1].match(/<li>([\s\S]*?)<\/li>/gi) || [];
        const joined = lis.map((li) => text(li)).filter(Boolean).join('; ');
        charges.push(joined);
      }

      let idx = 0;
      let wm: RegExpExecArray | null;
      while ((wm = warrantCellRe.exec(table)) !== null) {
        try {
          const warrantId = text(wm[1]);
          if (!warrantId) {
            idx++;
            continue; // Warrant # is required — skip rows without one.
          }
          const issued = text(wm[2]) || null;
          const severity = text(wm[3]) || null;
          const bond = parseMoney(text(wm[4]));
          const charge = charges[idx] || null;
          idx++;

          hits.push({
            source_key: SOURCE_KEY,
            warrant_id: warrantId,
            first_name: first,
            middle_name: middle,
            last_name: last,
            full_name: fullName || null,
            state: STATE,
            age,
            issue_date: issued,
            warrant_type: severity,
            bail_amount: bond,
            charge_description: charge,
          });
        } catch {
          idx++;
          // Skip a malformed warrant row; keep going.
        }
      }
    } catch {
      // Skip a malformed person block; never let one bad block abort the parse.
      continue;
    }
  }

  return hits;
}
