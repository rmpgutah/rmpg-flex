// Ada County (ID) Sheriff public-warrants source adapter.
//
// ADDITIVE WRAPPER — wires the (already-tested) `parseAdaCounty` parser to the
// live 2-step ASP.NET WebForms request flow via the shared `aspNetPostback`
// helper. Performs NO persistence: returns raw hits or throws on a transport
// failure (non-OK POST) so the orchestrator's per-source try/catch records the
// error and the circuit breaker engages. A 404 / no-results body flows through
// the parser, which yields `[]`.
//
// Request flow (confirmed from tests/warrantSources/fixtures/README.md):
//   1. GET  the search page → mint __VIEWSTATE/__VIEWSTATEGENERATOR/
//            __EVENTVALIDATION + cookies.
//   2. POST those tokens back with the btnFilter postback trigger + the last
//      name (first name / person id left empty), reusing the cookie jar.

import type { WarrantSourceAdapter, RawWarrantHit, PersonRow, SourceMeta } from '../types';
import { parseAdaCounty } from '../parse/adaCounty';
import { aspNetPostback } from './_aspnet';

const SOURCE_URL = 'https://apps.adacounty.id.gov/sheriff/reports/warrants.aspx';

const meta: SourceMeta = {
  key: 'ada-county-id',
  display_name: 'Ada County Sheriff (ID)',
  state: 'ID',
  county: 'Ada',
  source_url: SOURCE_URL,
  kind: 'html',
  priority: 2,
};

export const adaCountyAdapter: WarrantSourceAdapter = {
  meta,
  // `env` is accepted to satisfy the adapter contract but unused — this source
  // is a public HTML endpoint needing no DB binding or secret.
  async fetchForPerson(person: PersonRow, _env): Promise<RawWarrantHit[]> {
    const body = await aspNetPostback({
      url: SOURCE_URL,
      fields: {
        __EVENTTARGET: 'ctl00$ContentPlaceHolder1$btnFilter',
        __EVENTARGUMENT: '',
        'ctl00$ContentPlaceHolder1$txtLastName': person.last_name ?? '',
        'ctl00$ContentPlaceHolder1$txtFirstName': '',
        'ctl00$ContentPlaceHolder1$txtPersonID': '',
      },
    });
    return parseAdaCounty(body);
  },
};
