/**
 * Natrona County (WY) Sheriff Office Warrants — HTML parser.
 *
 * Pure, dependency-free, no I/O. Part of the multi-source warrant-scraping
 * framework: turns the Natrona County public-warrant search page into a flat
 * list of `RawWarrantHit`s for downstream upsert/reconciliation.
 *
 * Parsing approach: a plain Cloudflare Worker has no DOMParser and the page
 * structure is regular and well-bounded, so we string-scan rather than pull in
 * a DOM library (mirrors `adaCounty.ts`).
 *
 * IMPORTANT — this is a person SUMMARY list, not a per-warrant detail page.
 * The page is an ASP.NET Bootstrap-grid listview (NOT a <table>). Each result
 * row exposes only Name | Race | Gender | Age. There is NO per-warrant
 * charge / bond / case-number / court / issue-date in the list view (that lives
 * behind a per-person detail action — deferred to a later phase). So
 * charge_description / court_name / case_number / bail_amount / issue_date all
 * stay null here. A Phase-1 hit means "this person is on Natrona's active
 * warrant list" — a valuable officer-safety signal even without charge detail.
 *
 * Fixture-verified structure:
 *   <span id="lblSearch">Found N Warrants containing the name '…'</span>
 *   <div id="Tr1" class="row myrow ... fw-bold ...">  header (Name/Race/Gender/Age) — SKIP
 *   <div class="row myrow listview_backcolor1 ...">      (alternating ...2)
 *     <span id="Label4">Anthony Smith</span>   name   (FIRST LAST, no comma)
 *     <span id="Label2">Black</span>           race   (dropped — see below)
 *     <span id="Label9">Male</span>            gender (dropped — see below)
 *     <span id="Label14">63</span>             age
 *   </div>
 *   ... (repeats; the listview is paginated — this page is "Page 1 of 2")
 *
 * The span ids repeat per row, so we iterate the `div.row.myrow.listview_*`
 * blocks and extract spans WITHIN each block rather than matching by global id.
 *
 * RawWarrantHit has NO race/gender fields by design — race + gender are dropped
 * for Phase 1. A later per-person detail-fetch phase will capture full detail.
 *
 * warrant_id (REQUIRED): the list view exposes NO stable per-person id — no
 * detail link href, no __doPostBack target carrying an id, no hidden input, no
 * data-* attribute. So we SYNTHESIZE a deterministic id:
 *   natrona:<lastname>-<firstname>-<age>   (lowercased, spaces -> '-')
 * This is stable across runs for the same person, so the scraped_warrants
 * first_seen / last_seen lifecycle reconciles correctly. If two distinct people
 * collide on name+age within a single parse, we append a `-<n>` row-index
 * suffix to guarantee the framework's uniqueness invariant (rare; documented).
 *
 * Robustness contract: never throw on a malformed row — skip it. A site
 * redesign must degrade to `[]` (or fewer hits) so the framework's circuit
 * breaker can surface "source returned nothing" rather than crashing the run.
 */

import type { RawWarrantHit } from '../types';

const SOURCE_KEY = 'natrona-county-wy';
const STATE = 'WY';

/** Strip tags + decode the handful of entities the page emits, then collapse whitespace. */
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

/** Parse "First [Middle...] Last" into parts. No comma in this source. Resilient to missing pieces. */
function parseName(full: string): { first: string | null; middle: string | null; last: string | null } {
  const trimmed = full.trim();
  if (!trimmed) return { first: null, middle: null, last: null };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    // Single token — treat as last name (best-effort fallback).
    return { first: null, middle: null, last: parts[0] };
  }
  const first = parts.shift() as string;
  const last = parts.pop() as string;
  const middle = parts.length ? parts.join(' ') : null;
  return { first, middle, last };
}

/** Pull the first `<span id="...">text</span>` matching the given id, within a block. */
function spanById(block: string, id: string): string | null {
  const re = new RegExp(`<span[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)</span>`, 'i');
  const m = block.match(re);
  return m ? text(m[1]) : null;
}

/** Slug a name part: lowercase, non-alphanumerics -> '-', trim leading/trailing '-'. */
function slug(s: string | null): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Split the document into per-result row blocks. Each result row is a
 * `<div class="row myrow listview_backcolor1|2 ...">`. The header row uses
 * `id="Tr1"` and class `fw-bold` (no `listview_backcolor*`), so anchoring on
 * `listview_backcolor` already excludes it.
 */
function splitRowBlocks(html: string): string[] {
  const blocks: string[] = [];
  // Match the opening tag of each OUTER listview row, then slice to the next
  // one (or EOF). NOTE: every inner column <div> ALSO carries
  // `listview_backcolor1|2`, so we must anchor on the outer row's leading
  // `row myrow` marker (which the column divs lack) to avoid splitting mid-row.
  const re = /<div[^>]*class=["'][^"']*\brow\b[^"']*\bmyrow\b[^"']*listview_backcolor\d[^"']*["'][^>]*>/gi;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    starts.push(m.index);
  }
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : html.length;
    blocks.push(html.slice(starts[i], end));
  }
  return blocks;
}

export function parseNatrona(html: string): RawWarrantHit[] {
  if (typeof html !== 'string' || html.length === 0) return [];

  const hits: RawWarrantHit[] = [];
  const seenIds = new Set<string>();
  const blocks = splitRowBlocks(html);

  let rowIndex = 0;
  for (const block of blocks) {
    try {
      const fullName = spanById(block, 'Label4') || '';
      // Guard against the literal header text leaking in (defensive — the
      // header row has no listview_backcolor class, so it shouldn't reach here).
      if (!fullName || fullName.toLowerCase() === 'name') continue;

      const { first, middle, last } = parseName(fullName);

      // Race (Label2) and Gender (Label9) are intentionally DROPPED — Phase 1.

      let age: number | null = null;
      const ageRaw = spanById(block, 'Label14');
      if (ageRaw) {
        const a = parseInt(ageRaw, 10);
        age = Number.isFinite(a) ? a : null;
      }

      // Synthesize a deterministic warrant_id (no stable id in the list view).
      let warrantId = `natrona:${slug(last)}-${slug(first)}-${age == null ? '' : age}`;
      // Guarantee uniqueness within this parse: if two distinct people collide
      // on name+age, append the row index. Rare; keeps the framework invariant.
      // TODO(phase-2): the row-index suffix is POSITION-dependent, so the 2nd+
      // member of a genuine name+age collision can get a different id if the
      // upstream (paginated, unordered) listview reorders between scans —
      // scraped_warrants keys its first_seen/last_seen lifecycle on warrant_id,
      // so that row would re-insert as "new" and the prior id read as "cleared".
      // Only the colliding tail is affected (first occurrence is always stable).
      // The durable fix is the per-person detail-fetch phase (real source id);
      // a cheaper order-independent stopgap is to fold race/gender into the
      // discriminator instead of rowIndex.
      if (seenIds.has(warrantId)) {
        warrantId = `${warrantId}-${rowIndex}`;
      }
      seenIds.add(warrantId);

      hits.push({
        source_key: SOURCE_KEY,
        warrant_id: warrantId,
        first_name: first,
        middle_name: middle,
        last_name: last,
        full_name: fullName || null,
        state: STATE,
        age,
        // List-view-only source — these are not exposed here (Phase 1):
        charge_description: null,
        court_name: null,
        case_number: null,
        bail_amount: null,
        issue_date: null,
      });
    } catch {
      // Skip a malformed row; never let one bad block abort the parse.
    } finally {
      rowIndex++;
    }
  }

  return hits;
}
