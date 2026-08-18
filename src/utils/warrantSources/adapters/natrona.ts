// Natrona County (WY) Sheriff public-warrants source adapter.
//
// ADDITIVE WRAPPER — wires the (already-tested) `parseNatrona` parser to the
// live 2-step ASP.NET WebForms request flow via the shared `aspNetPagedSearch`
// helper. Performs NO persistence: returns raw hits or throws on a transport
// failure (non-OK POST) so the orchestrator's per-source try/catch records the
// error and the circuit breaker engages. A 404 / no-results body flows through
// the parser, which yields `[]`.
//
// Request flow (confirmed from tests/warrantSources/fixtures/README.md):
//   1. GET  the search page → mint __VIEWSTATE/__VIEWSTATEGENERATOR/
//            __EVENTVALIDATION (+ __VIEWSTATEENCRYPTED / __SCROLLPOSITIONX/Y
//            when present — the shared helper threads all of these) + cookies.
//   2. POST those tokens back with the name search field + the image-button
//      coordinate pair that fires the search postback, reusing the cookie jar.
//   3. If a DataPager "Next" link is present, POST the next-page __doPostBack
//      target, repeating until exhausted (up to 20 pages).

import type { WarrantSourceAdapter, RawWarrantHit, PersonRow, SourceMeta } from '../types';
import { parseNatrona, parseNatronaPager } from '../parse/natrona';
import { aspNetPagedSearch } from './_aspnet';

const SOURCE_URL = 'https://warrants.natronacounty-wy.gov';

const meta: SourceMeta = {
  key: 'natrona-county-wy',
  display_name: 'Natrona County Sheriff (WY)',
  state: 'WY',
  county: 'Natrona',
  source_url: SOURCE_URL,
  kind: 'html',
  priority: 2,
};

export const natronaAdapter: WarrantSourceAdapter = {
  meta,
  mode: 'per-person',
  // `env` is accepted to satisfy the adapter contract but unused — this source
  // is a public HTML endpoint needing no DB binding or secret.
  async fetchForPerson(person: PersonRow, _env): Promise<RawWarrantHit[]> {
    const pages = await aspNetPagedSearch(
      {
        url: SOURCE_URL,
        fields: {
          'ctl00$MainContent$txtNameSearch': person.last_name ?? '',
          // Image-button trigger: ASP.NET fires the search postback off the .x/.y
          // coordinate pair of the input[type=image], not a value field.
          'ctl00$MainContent$btnSearch2.x': '10',
          'ctl00$MainContent$btnSearch2.y': '10',
        },
      },
      parseNatronaPager,
    );
    // Accumulate hits across all pages. Each page's parser runs independently
    // so the seenIds dedup set resets per page — the warrant_id synthesizer
    // (natrona:<last>-<first>-<age>) is already cross-page stable for distinct
    // people, so the only duplicates across pages are the rare same-name-same-age
    // collisions that got a -0 suffix on page 1 and a -0 suffix again on page 2.
    // Deduplicate final ids to be safe.
    const allHits: RawWarrantHit[] = [];
    const seenIds = new Set<string>();
    for (const pageBody of pages) {
      for (const hit of parseNatrona(pageBody)) {
        if (!seenIds.has(hit.warrant_id)) {
          seenIds.add(hit.warrant_id);
          allHits.push(hit);
        }
      }
    }
    return allHits;
  },
};
