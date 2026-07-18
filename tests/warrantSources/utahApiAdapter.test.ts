import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { utahApiAdapter } from '../../src/utils/warrantSources/adapters/utahApi';

// The local person: John Smith, dob 1990-01-01.
// DOB-derived whole-years age is ~36 (in 2026). The matching upstream
// candidate must be within ±1 of that (AGE_MATCH_TOLERANCE). The namesake
// candidate is set wildly off so isLikelyMatch() rejects it BEFORE its
// warrants are ever fetched — that's the guard this test pins down.
const local = { id: 1, first_name: 'John', middle_name: null, last_name: 'Smith', dob: '1990-01-01' };

function matchingAge(): number {
  // Recompute the same whole-years age the poller derives, so the test is
  // stable regardless of the calendar date it runs on.
  const born = new Date('1990-01-01');
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age--;
  return age;
}

// Stub the upstream Utah API (post-2026-07-17 migration shape, verified
// live against the site's own js/scripts.js + curl):
// GET /warrant-api/warrantPublic/search?firstName=&lastName= returns an
// array of candidates directly (no wrapper object), age as a NUMBER, and
// personId as the identifier. GET /warrant-api/warrantPublic/detail/:id
// returns { warrant: [...] } with warrantNumber/courtCaseNumber/
// courtDescription/chargeDescription/issueDate fields.
function buildFetchStub() {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/warrant-api/warrantPublic/search')) {
      return new Response(
        JSON.stringify([
          {
            personId: 1001,
            firstName: 'JOHN',
            lastName: 'SMITH',
            city: 'SALT LAKE CITY',
            age: matchingAge(),
          },
          {
            personId: 2002,
            firstName: 'JOHN',
            lastName: 'SMITH',
            city: 'PROVO',
            age: 88, // wildly off → rejected by isLikelyMatch age guard
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (u.includes('/warrant-api/warrantPublic/detail/1001')) {
      return new Response(
        JSON.stringify({
          warrant: [
            {
              warrantNumber: 'UW1',
              issueDate: '2026-01-01',
              courtDescription: 'X JUSTICE COURT',
              courtCaseNumber: 'C1',
              chargeDescription: ['BATTERY'],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (u.includes('/warrant-api/warrantPublic/detail/2002')) {
      return new Response(
        JSON.stringify({
          warrant: [
            {
              warrantNumber: 'UW2',
              issueDate: '2020-05-05',
              courtDescription: 'Y JUSTICE COURT',
              courtCaseNumber: 'C2',
              chargeDescription: ['THEFT'],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('not found', { status: 404 });
  });
}

describe('utahApiAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', buildFetchStub());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes api-kind metadata', () => {
    expect(utahApiAdapter.meta.kind).toBe('api');
    expect(utahApiAdapter.meta.key).toBe('utah-warrant-watch');
    expect(utahApiAdapter.meta.state).toBe('UT');
  });

  it('maps the age-matched candidate warrant to a RawWarrantHit', async () => {
    const hits = await utahApiAdapter.fetchForPerson!(local, { DB: {} as unknown as D1Database });
    const uw1 = hits.find((h) => h.warrant_id === 'UW1');
    expect(uw1).toBeTruthy();
    expect(uw1!.source_key).toBe('utah-warrant-watch');
    expect(uw1!.state).toBe('UT');
    expect(uw1!.case_number).toBe('C1');
    expect(uw1!.court_name).toBe('X JUSTICE COURT');
    expect(uw1!.issue_date).toBe('2026-01-01');
    expect(uw1!.charge_description).toBeTruthy(); // raw JSON string ok
    expect(uw1!.first_name).toBe('JOHN');
    expect(uw1!.last_name).toBe('SMITH');
    expect(uw1!.city).toBe('SALT LAKE CITY');
  });

  it('rejects the namesake (age guard preserved) — UW2 must NOT appear', async () => {
    const hits = await utahApiAdapter.fetchForPerson!(local, { DB: {} as unknown as D1Database });
    expect(hits.some((h) => h.warrant_id === 'UW2')).toBe(false);
    // Only the matched candidate's warrant comes through.
    expect(hits.map((h) => h.warrant_id)).toEqual(['UW1']);
  });

  it('dedups duplicate personId rows from /search before hitting /detail', async () => {
    const fetchStub = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/warrant-api/warrantPublic/search')) {
        // Same personId twice — a real-world occurrence (name-spelling
        // variants / multiple addresses on file for the same person).
        return new Response(
          JSON.stringify([
            { personId: 1001, firstName: 'JOHN', lastName: 'SMITH', city: 'SALT LAKE CITY', age: matchingAge() },
            { personId: 1001, firstName: 'JOHN', lastName: 'SMITH', city: 'MURRAY', age: matchingAge() },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (u.includes('/warrant-api/warrantPublic/detail/1001')) {
        return new Response(
          JSON.stringify({ warrant: [{ warrantNumber: 'UW1', issueDate: '2026-01-01', courtDescription: 'X', courtCaseNumber: 'C1', chargeDescription: ['THEFT'] }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchStub);

    const hits = await utahApiAdapter.fetchForPerson!(local, { DB: {} as unknown as D1Database });
    expect(hits.map((h) => h.warrant_id)).toEqual(['UW1']);
    const detailCalls = fetchStub.mock.calls.filter(([u]) => String(u).includes('/detail/1001'));
    expect(detailCalls).toHaveLength(1);
  });
});
