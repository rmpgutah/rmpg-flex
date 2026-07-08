// Ohio DRC "Parole Violators at Large" source adapter — the first genuinely
// STATEWIDE (not single-county) source in this registry besides Utah + FBI.
// Public, no auth, no API — an A-Z browsable HTML listing
// (appgateway.drc.ohio.gov/OffenderSearch/Search/PvalListing) covering every
// APA-supervised parole violator Ohio has declared at-large. See
// parse/ohioPval.ts for the row/pagination shape.

import type { WarrantSourceAdapter, RawWarrantHit, FullListResult, SourceMeta } from '../types';
import { parseOhioPvalPage, parseOhioPvalPageCount } from '../parse/ohioPval';

const BASE = 'https://appgateway.drc.ohio.gov/OffenderSearch/Search';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
// Hard ceiling on pages fetched per letter — a malformed/never-ending page-count
// parse must not turn into an unbounded fetch loop against a real government site.
const MAX_PAGES_PER_LETTER = 25;

const meta: SourceMeta = {
  key: 'ohio-drc-pval',
  display_name: 'Ohio DRC Parole Violators at Large',
  state: 'OH',
  county: null,
  source_url: `${BASE}/PvalListing`,
  kind: 'html',
  priority: 2,
  family: 'ohio-drc',
  category: 'wanted',
};

async function fetchLetterPage(letter: string, page: number): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/PvalListPaging?newLtr=${letter}&newPage=${page}`, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export const ohioPvalAdapter: WarrantSourceAdapter = {
  meta,
  mode: 'full-list',
  async fetchAll(): Promise<FullListResult> {
    const hits: RawWarrantHit[] = [];
    let degraded = false;
    let degradedReason: string | undefined;

    for (const letter of LETTERS) {
      let page = 1;
      let totalPages = 1;
      do {
        const html = await fetchLetterPage(letter, page);
        if (!html) {
          // A single letter failing to load shouldn't sink the whole statewide
          // roster — record it as degraded and move to the next letter.
          degraded = true;
          degradedReason = degradedReason ?? 'http_error';
          break;
        }
        hits.push(...parseOhioPvalPage(html, meta.key));
        const counts = parseOhioPvalPageCount(html);
        totalPages = counts ? Math.min(counts.totalPages, MAX_PAGES_PER_LETTER) : 1;
        page++;
      } while (page <= totalPages);
    }

    return { hits, ...(degraded ? { degraded, degradedReason } : {}) };
  },
};
