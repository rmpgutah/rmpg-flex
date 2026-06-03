// Natrona County (WY) Sheriff public-warrants source adapter.
//
// ADDITIVE WRAPPER — wires the (already-tested) `parseNatrona` parser to the
// live 2-step ASP.NET WebForms request flow via the shared `aspNetPostback`
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
//
// TODO(phase-2): follow pagination. This fixture (and thus this adapter) reads
// only PAGE 1 of the listview; the capture is page 1 of 2. A later phase should
// detect the pager and POST the next-page postback, accumulating hits.

import type { WarrantSourceAdapter, RawWarrantHit, PersonRow, SourceMeta } from '../types';
import { parseNatrona } from '../parse/natrona';
import { aspNetPostback } from './_aspnet';

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
  // `env` is accepted to satisfy the adapter contract but unused — this source
  // is a public HTML endpoint needing no DB binding or secret.
  async fetchForPerson(person: PersonRow, _env): Promise<RawWarrantHit[]> {
    const body = await aspNetPostback({
      url: SOURCE_URL,
      fields: {
        'ctl00$MainContent$txtNameSearch': person.last_name ?? '',
        // Image-button trigger: ASP.NET fires the search postback off the .x/.y
        // coordinate pair of the input[type=image], not a value field.
        'ctl00$MainContent$btnSearch2.x': '10',
        'ctl00$MainContent$btnSearch2.y': '10',
      },
    });
    return parseNatrona(body);
  },
};
