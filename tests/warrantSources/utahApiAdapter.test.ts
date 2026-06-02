import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { utahApiAdapter } from '../../src/utils/warrantSources/adapters/utahApi';

// The local person: John Smith, dob 1990-01-01.
// DOB-derived whole-years age is ~36 (in 2026). The matching upstream
// candidate must be within ±1 of that (AGE_MATCH_TOLERANCE). The namesake
// candidate is set wildly off so isLikelyMatch() rejects it BEFORE its
// warrants are ever fetched — that's the guard this test pins down.
const local = { id: 1, first_name: 'John', middle_name: null, last_name: 'Smith', dob: '1990-01-01' };

function matchingAge(): string {
  // Recompute the same whole-years age the poller derives, so the test is
  // stable regardless of the calendar date it runs on.
  const born = new Date('1990-01-01');
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age--;
  return String(age);
}

// Stub the upstream Utah API. POST /persons returns two candidates for
// "JOHN SMITH": one age-matched (id MATCH) and one namesake (id NAMESAKE,
// age wildly off). GET /persons/MATCH/warrants returns one warrant (UW1);
// GET /persons/NAMESAKE/warrants returns a DIFFERENT warrant (UW2) that
// must NOT appear in the result if the age guard is intact.
function buildFetchStub() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/persons') && init?.method === 'POST') {
      return new Response(
        JSON.stringify({
          persons: [
            {
              id: 'MATCH',
              name: { first: 'JOHN', last: 'SMITH' },
              homeAddress: { city: 'SALT LAKE CITY' },
              age: matchingAge(),
            },
            {
              id: 'NAMESAKE',
              name: { first: 'JOHN', last: 'SMITH' },
              homeAddress: { city: 'PROVO' },
              age: '88', // wildly off → rejected by isLikelyMatch age guard
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (u.includes('/persons/MATCH/warrants')) {
      return new Response(
        JSON.stringify({
          warrants: [
            { id: 'UW1', issueDate: '2026-01-01', court: { name: 'X JUSTICE COURT', caseId: 'C1' }, charges: ['BATTERY'] },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (u.includes('/persons/NAMESAKE/warrants')) {
      return new Response(
        JSON.stringify({
          warrants: [
            { id: 'UW2', issueDate: '2020-05-05', court: { name: 'Y JUSTICE COURT', caseId: 'C2' }, charges: ['THEFT'] },
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
    const hits = await utahApiAdapter.fetchForPerson(local, { DB: {} as unknown as D1Database });
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
    const hits = await utahApiAdapter.fetchForPerson(local, { DB: {} as unknown as D1Database });
    expect(hits.some((h) => h.warrant_id === 'UW2')).toBe(false);
    // Only the matched candidate's warrant comes through.
    expect(hits.map((h) => h.warrant_id)).toEqual(['UW1']);
  });
});
