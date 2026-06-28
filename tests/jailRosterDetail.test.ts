// Tests for the Salt Lake IML inmate-profile parser (the "full document" read).
// Fixtures mirror the real IML structure verified live 2026-06-15: label cells
// (class="bodysmallbold") followed by value cells (class="bodysmall"), a Bond
// table [Case#, Amount, Status, SetDate] and a Charge table [Case#, OffenseDate,
// Code, Description, Grade, Degree], terminated by the "Copyright" footer.
import { describe, it, expect } from 'vitest';
import { parseInmateProfile, mdyToIso } from '../src/utils/jailRoster/parsers';

const POPULATED = `
<h1>Inmate Information</h1>
<table>
  <tr>
    <td class="bodysmallbold">Booking #:</td><td class="bodysmall">26003314</td>
    <td class="bodysmallbold">SO#:</td><td class="bodysmall">462864</td>
  </tr>
</table>
<table>
  <tr><td class="header">Incarceration Information</td></tr>
  <tr>
    <td class="bodysmallbold">Current Housing Section:</td><td class="bodysmall">07</td>
    <td class="bodysmallbold">Current Location:</td><td class="bodysmall">MAIN</td>
  </tr>
  <tr>
    <td class="bodysmallbold">Current Housing Block:</td><td class="bodysmall">A</td>
    <td class="bodysmallbold">County:</td><td class="bodysmall">SALT LAKE</td>
  </tr>
  <tr>
    <td class="bodysmallbold">Current Housing Cell:</td><td class="bodysmall">05</td>
    <td class="bodysmallbold">Booking Date:</td><td class="bodysmall">01/21/2026</td>
  </tr>
  <tr>
    <td class="bodysmallbold">Current Housing Bed:</td><td class="bodysmall">B</td>
    <td class="bodysmallbold">Projected Release Date:</td><td class="bodysmall">03/15/2026</td>
  </tr>
</table>
<table>
  <tr><td class="header">Bond Information</td></tr>
  <tr><td>Case #</td><td></td><td>Amount</td><td>Status</td><td></td><td></td><td>Set Date</td></tr>
  <tr><td>241909191</td><td></td><td>¤ 500.00</td><td>Open</td><td></td><td></td><td>2026-01-21 17:20:00.0</td></tr>
  <tr><td>255007202</td><td></td><td>¤ 1,000.00</td><td>Open</td><td></td><td></td><td>2026-01-27 15:26:00.0</td></tr>
</table>
<table>
  <tr><td class="header">Charge Information</td></tr>
  <tr><td>Case #</td><td>Offense Date</td><td>Code</td><td>Description</td><td>Grade</td><td>Degree</td></tr>
  <tr><td></td><td>01/21/2026</td><td>58-37-8</td><td>POSSESSION OF A CONTROLLED SUBSTANCE</td><td></td><td>F3</td></tr>
  <tr><td></td><td>01/21/2026</td><td>76-6-404</td><td>THEFT</td><td></td><td>MB</td></tr>
  <tr><td>&nbsp;</td></tr>
</table>
&copy; Copyright 2019, DSI-ITI, Inc.`;

// A bare template (what IML returns when the session isn't armed / inmate gone):
// labels present, every value cell empty, "no charge/bond information" text.
const EMPTY = `
<h1>Inmate Information</h1>
<table>
  <tr><td class="bodysmallbold">Booking #:</td><td class="bodysmall"></td>
      <td class="bodysmallbold">SO#:</td><td class="bodysmall"></td></tr>
  <tr><td class="bodysmallbold">Booking Date:</td><td class="bodysmall"></td></tr>
</table>
<table><tr><td class="header">Bond Information</td></tr>
  <tr><td class="bodysmall">There is no Bond Information for this Inmate.</td></tr></table>
<table><tr><td class="header">Charge Information</td></tr>
  <tr><td class="bodysmall">There is no charge information for this inmate.</td></tr></table>
&copy; Copyright 2019, DSI-ITI, Inc.`;

describe('mdyToIso', () => {
  it('converts MM/DD/YYYY to ISO', () => {
    expect(mdyToIso('01/21/2026')).toBe('2026-01-21');
    expect(mdyToIso('1/5/2026')).toBe('2026-01-05'); // zero-pads
  });
  it('returns empty string on missing/garbage input', () => {
    expect(mdyToIso('')).toBe('');
    expect(mdyToIso(null)).toBe('');
    expect(mdyToIso('N/A')).toBe('');
  });
});

describe('parseInmateProfile — populated', () => {
  const d = parseInmateProfile(POPULATED);

  it('reads + ISO-normalizes the booking date', () => {
    expect(d.booking_date).toBe('2026-01-21');
  });
  it('reads the SO number and projected release', () => {
    expect(d.so_number).toBe('462864');
    expect(d.projected_release).toBe('2026-03-15');
  });
  it('joins housing location/block/cell/bed', () => {
    expect(d.housing).toBe('MAIN / A / 05 / B');
  });
  it('extracts every charge as "CODE — DESCRIPTION", skipping header/blank rows', () => {
    expect(d.charges).toEqual([
      '58-37-8 — POSSESSION OF A CONTROLLED SUBSTANCE',
      '76-6-404 — THEFT',
    ]);
  });
  it('sums bond amounts by currency shape — not the populated Case# integers', () => {
    // Regression: a "first non-empty cell" parser summed Case# (241909191 + …)
    // into a $752M bail. Amounts carry a "¤" symbol + thousands commas.
    expect(d.bail_amount).toBe(1500);
  });
});

describe('parseInmateProfile — empty template', () => {
  const d = parseInmateProfile(EMPTY);

  it('yields no scraped data so the caller can treat it as a miss', () => {
    expect(d.booking_date).toBe('');
    expect(d.charges).toEqual([]);
    expect(d.bail_amount).toBe(0);
    expect(d.so_number).toBe('');
    expect(d.housing).toBe('');
  });
});
