// warrants.utah.gov adapter — query-lookup mode (public search form).
//
// SCOPE STATUS: scaffolding only. The TWO functions below marked
// `TODO(human)` require opening the real page in a browser, identifying
// the form's POST target + field names + response HTML structure, and
// filling in the request shape and parser. I cannot do this from outside
// because the site WAFs unauthenticated server-side fetches (verified
// 2026-05-24: 403 on / , /search, /about, /robots.txt).
//
// Until both TODOs are filled in, this adapter will throw at runtime.
// That is deliberate — it fails loudly instead of silently returning [].

import { BaseWarrantSource, type SourceMode } from './base';
import type { WarrantRecord } from '../types';
import { syntheticWarrantId } from '../normalize';

export class WarrantsUtahGovSource extends BaseWarrantSource {
  readonly id = 'warrants-utah-gov';
  readonly displayName = 'Utah Statewide Warrants Portal';
  readonly mode: SourceMode = 'query-lookup';

  async lookup(query: { name: string; dob?: string }): Promise<WarrantRecord[]> {
    const html = await this.submitSearch(query);
    return this.parseResults(html);
  }

  // TODO(human): open warrants.utah.gov in a browser, inspect the search
  // form (DevTools > Network > submit a test query), and fill in:
  //   1. The actual POST URL (or GET URL with query params)
  //   2. The form field names for name + DOB
  //   3. Whether it needs a CSRF token first (extra GET to grab it)
  //
  // Reference shape:
  //   const res = await this.fetchWithRetry('https://warrants.utah.gov/<endpoint>', {
  //     method: 'POST',
  //     headers: { 'content-type': 'application/x-www-form-urlencoded' },
  //     body: new URLSearchParams({ <field>: query.name, <dobField>: query.dob ?? '' }),
  //   });
  //   if (!res.ok) throw new Error(`warrants.utah.gov ${res.status}`);
  //   return await res.text();
  private async submitSearch(_query: { name: string; dob?: string }): Promise<string> {
    throw new Error('warrants-utah-gov: submitSearch() not implemented — see TODO(human) in source');
  }

  // TODO(human): given the HTML response from submitSearch, parse the
  // results table into WarrantRecord[]. Use a real HTML parser
  // (linkedom on CF Workers, or cheerio on Node). Don't regex HTML.
  //
  // Reference shape:
  //   const { parseHTML } = await import('linkedom');
  //   const { document } = parseHTML(html);
  //   const rows = document.querySelectorAll('table.results tbody tr');
  //   return Array.from(rows).map(row => {
  //     const cells = row.querySelectorAll('td');
  //     const name = cells[0].textContent?.trim() ?? '';
  //     const charges = [cells[3].textContent?.trim() ?? ''];
  //     return {
  //       source: this.id,
  //       sourceWarrantId: syntheticWarrantId({ name, charges }),
  //       subjectName: name,
  //       charges,
  //       fetchedAt: new Date().toISOString(),
  //     };
  //   });
  private parseResults(_html: string): WarrantRecord[] {
    throw new Error('warrants-utah-gov: parseResults() not implemented — see TODO(human) in source');
  }
}

// Suppress unused-import warning until the parser is filled in.
void syntheticWarrantId;
