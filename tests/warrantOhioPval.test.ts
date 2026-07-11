import { describe, it, expect } from 'vitest';
import { parseOhioPvalPage, parseOhioPvalPageCount } from '../src/utils/warrantSources/parse/ohioPval';

// Ohio DRC "Parole Violators at Large" listing — a plain HTML table, one <tr>
// per offender, browsable A-Z with server-side pagination. Fixture below is a
// hand-built minimal page mirroring the real markup structure (photo link,
// name, ID link, DOB, violator-at-large date, offenses).
const PAGE_HTML = `
<html><body>
<div class="pager">Page 1 of 2</div>
<table>
  <tr><th>Photo</th><th>Name</th><th>ID</th><th>DOB</th><th>VAL Date</th><th>Offenses</th></tr>
  <tr>
    <td><a href="/OffenderSearch/Search/PvalDetails/A123456"><img src="/images/pval/A123456.jpg"></a></td>
    <td>Anderson, Robert James</td>
    <td><a href="/OffenderSearch/Search/PvalDetails/A123456">A123456</a></td>
    <td>03/14/1985</td>
    <td>06/01/2026</td>
    <td>ROBBERY, BURGLARY</td>
  </tr>
  <tr>
    <td><a href="/OffenderSearch/Search/PvalDetails/A654321"><img src="/images/pval/A654321.jpg"></a></td>
    <td>Ames, Denise</td>
    <td><a href="/OffenderSearch/Search/PvalDetails/A654321">A654321</a></td>
    <td>11/02/1990</td>
    <td>05/20/2026</td>
    <td>THEFT</td>
  </tr>
</table>
</body></html>`;

describe('parseOhioPvalPage — Ohio DRC parole violators at large', () => {
  it('parses both data rows and skips the header row', () => {
    const hits = parseOhioPvalPage(PAGE_HTML, 'ohio-drc-pval');
    expect(hits.length).toBe(2);
  });

  it('maps the first record fully', () => {
    const hits = parseOhioPvalPage(PAGE_HTML, 'ohio-drc-pval');
    const a = hits.find((h) => h.last_name === 'Anderson');
    expect(a).toBeDefined();
    expect(a?.source_key).toBe('ohio-drc-pval');
    expect(a?.first_name).toBe('Robert');
    expect(a?.middle_name).toBe('James');
    expect(a?.state).toBe('OH');
    expect(a?.date_of_birth).toBe('1985-03-14');
    expect(a?.issue_date).toBe('2026-06-01');
    expect(a?.case_number).toBe('A123456');
    expect(a?.charge_description).toBe('ROBBERY, BURGLARY');
    expect(a?.warrant_type).toBe('PAROLE VIOLATOR AT LARGE');
    expect(a?.photo_url).toBe('https://appgateway.drc.ohio.gov/images/pval/A123456.jpg');
    expect(a?.detail_url).toBe('https://appgateway.drc.ohio.gov/OffenderSearch/Search/PvalDetails/A123456');
    expect(a?.warrant_id).toBeTruthy();
  });

  it('produces stable, distinct warrant_ids across rows', () => {
    const hits = parseOhioPvalPage(PAGE_HTML, 'ohio-drc-pval');
    const ids = new Set(hits.map((h) => h.warrant_id));
    expect(ids.size).toBe(hits.length);
  });

  it('returns [] for empty / non-HTML input', () => {
    expect(parseOhioPvalPage('', 'ohio-drc-pval')).toEqual([]);
    expect(parseOhioPvalPage('<html><body>no rows here</body></html>', 'ohio-drc-pval')).toEqual([]);
  });
});

describe('parseOhioPvalPageCount', () => {
  it('extracts page/totalPages from a "Page X of Y" marker', () => {
    expect(parseOhioPvalPageCount(PAGE_HTML)).toEqual({ page: 1, totalPages: 2 });
  });

  it('returns null when no pager marker is present', () => {
    expect(parseOhioPvalPageCount('<html><body>no pager</body></html>')).toBeNull();
  });
});
