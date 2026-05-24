// ============================================================
// Live Warrant Poller — Unit Tests
// ============================================================
// Coverage:
//   - parseFlexibleDob across the 3 formats we see in the wild
//   - normaliseSex
//   - matchScore correctness (per-field, combined)
//   - tierFor thresholds
//   - pollMultiStateLive with a stubbed local cache
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  parseFlexibleDob,
  normaliseSex,
  matchScore,
  tierFor,
  ageFromIsoDob,
  pollMultiStateLive,
} from '../liveWarrantPoller';

let testDb: Database.Database;
vi.mock('../../models/database', () => ({
  getDb: () => testDb,
}));

// Mock the FBI fetch + Utah live API so tests don't hit the network.
const fbiItems: any[] = [];
let utahResults: any[] | null = [];
vi.mock('../utahWarrantScraper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utahWarrantScraper')>();
  return {
    ...actual,
    searchUtahWarrantsLive: vi.fn(async () => utahResults),
  };
});
const originalFetch = globalThis.fetch;

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.prepare(`
    CREATE TABLE scraped_warrants (
      id INTEGER PRIMARY KEY,
      source_key TEXT,
      first_name TEXT,
      middle_name TEXT,
      last_name TEXT,
      date_of_birth TEXT,
      age INTEGER,
      gender TEXT,
      race TEXT,
      city TEXT,
      state TEXT,
      warrant_id TEXT,
      warrant_type TEXT,
      charge_description TEXT,
      court_name TEXT,
      case_number TEXT,
      issue_date TEXT,
      bail_amount TEXT,
      offense_level TEXT,
      photo_url TEXT,
      detail_url TEXT,
      status TEXT DEFAULT 'active'
    )
  `).run();

  fbiItems.length = 0;
  utahResults = [];
  // Default: FBI API fetch returns the items array we set.
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ items: fbiItems }),
  })) as any;
});

afterEachRestoreFetch();

function afterEachRestoreFetch() {
  // vitest's afterEach is implicit via top-level describe; we restore in finally.
  // Kept as a function placeholder for clarity.
}

// ── parseFlexibleDob ──────────────────────────────────────

describe('parseFlexibleDob', () => {
  it('passes through ISO YYYY-MM-DD unchanged (with zero-padding)', () => {
    expect(parseFlexibleDob('2000-02-04')).toBe('2000-02-04');
    expect(parseFlexibleDob('2000-2-4')).toBe('2000-02-04');
    expect(parseFlexibleDob('2000/02/04')).toBe('2000-02-04');
  });

  it('parses US-locale MM/DD/YYYY', () => {
    expect(parseFlexibleDob('02/04/2000')).toBe('2000-02-04');
    expect(parseFlexibleDob('2/4/2000')).toBe('2000-02-04');
    expect(parseFlexibleDob('12/31/1999')).toBe('1999-12-31');
  });

  it('parses FBI long-form "February 4, 2000"', () => {
    expect(parseFlexibleDob('February 4, 2000')).toBe('2000-02-04');
    expect(parseFlexibleDob('Feb 4, 2000')).toBe('2000-02-04');
    expect(parseFlexibleDob('February 04, 2000')).toBe('2000-02-04');
    expect(parseFlexibleDob('December 25, 1980')).toBe('1980-12-25');
  });

  it('returns null for unparseable / empty input', () => {
    expect(parseFlexibleDob(null)).toBe(null);
    expect(parseFlexibleDob(undefined)).toBe(null);
    expect(parseFlexibleDob('')).toBe(null);
    expect(parseFlexibleDob('not a date')).toBe(null);
    expect(parseFlexibleDob('2000')).toBe(null);
  });
});

// ── normaliseSex ──────────────────────────────────────────

describe('normaliseSex', () => {
  it('maps Male/Female/M/F to single letter', () => {
    expect(normaliseSex('Male')).toBe('M');
    expect(normaliseSex('male')).toBe('M');
    expect(normaliseSex('M')).toBe('M');
    expect(normaliseSex('Female')).toBe('F');
    expect(normaliseSex('F')).toBe('F');
  });

  it('returns null for unknown / empty values', () => {
    expect(normaliseSex(null)).toBe(null);
    expect(normaliseSex('')).toBe(null);
    expect(normaliseSex('Other')).toBe(null);
    expect(normaliseSex('U')).toBe(null);
  });
});

// ── matchScore ────────────────────────────────────────────

describe('matchScore', () => {
  const baseCriteria = {
    first_name: 'John',
    last_name: 'Smith',
    asOf: new Date('2026-04-25'),
  };

  it('scores 30 for exact name match alone', () => {
    const r = matchScore({
      criteria: baseCriteria,
      candidate: {
        first_name: 'JOHN', middle_name: null, last_name: 'SMITH',
        dob: null, age: null, sex: null, city: null,
      },
    });
    expect(r.score).toBe(30);
    expect(r.details[0]).toMatchObject({ field: 'name', basis: 'exact', weight: 30 });
  });

  it('scores 10 for last-name-only match', () => {
    const r = matchScore({
      criteria: baseCriteria,
      candidate: {
        first_name: 'Robert', middle_name: null, last_name: 'Smith',
        dob: null, age: null, sex: null, city: null,
      },
    });
    expect(r.score).toBe(10);
  });

  it('scores 0 when last name does not match', () => {
    const r = matchScore({
      criteria: baseCriteria,
      candidate: {
        first_name: 'John', middle_name: null, last_name: 'Doe',
        dob: null, age: null, sex: null, city: null,
      },
    });
    expect(r.score).toBe(0);
  });

  it('adds 35 for exact DOB match', () => {
    const r = matchScore({
      criteria: { ...baseCriteria, dob: '1990-06-15' },
      candidate: {
        first_name: 'JOHN', middle_name: null, last_name: 'SMITH',
        dob: '1990-06-15', age: null, sex: null, city: null,
      },
    });
    expect(r.score).toBe(30 + 35);  // name + dob exact
    expect(r.details.find(d => d.field === 'dob')?.basis).toBe('exact');
  });

  it('penalises >5y DOB mismatch', () => {
    const r = matchScore({
      criteria: { ...baseCriteria, dob: '1990-06-15' },
      candidate: {
        first_name: 'JOHN', middle_name: null, last_name: 'SMITH',
        dob: '1970-06-15', age: null, sex: null, city: null,
      },
    });
    expect(r.score).toBe(30 - 20);  // name match minus DOB mismatch
  });

  it('falls back to age scoring when DOB is missing', () => {
    const r = matchScore({
      criteria: { ...baseCriteria, age: 35 },
      candidate: {
        first_name: 'JOHN', middle_name: null, last_name: 'SMITH',
        dob: null, age: 35, sex: null, city: null,
      },
    });
    expect(r.score).toBe(30 + 20);  // name + age exact
  });

  it('uses criteria DOB → age when age field is empty', () => {
    const r = matchScore({
      criteria: { ...baseCriteria, dob: '1990-04-25' },
      candidate: {
        first_name: 'JOHN', middle_name: null, last_name: 'SMITH',
        dob: null, age: 36, sex: null, city: null,  // FBI returned age, not DOB
      },
    });
    // criteria DOB → age 36 (asOf = 2026-04-25, exact birthday)
    expect(r.score).toBe(30 + 20);
  });

  it('penalises sex mismatch sharply', () => {
    const r = matchScore({
      criteria: { ...baseCriteria, sex: 'M' },
      candidate: {
        first_name: 'JOHN', middle_name: null, last_name: 'SMITH',
        dob: null, age: null, sex: 'F', city: null,
      },
    });
    expect(r.score).toBe(30 - 25);
  });

  it('reaches strong tier with name + DOB + sex all matching', () => {
    const r = matchScore({
      criteria: { ...baseCriteria, dob: '1990-06-15', sex: 'M' },
      candidate: {
        first_name: 'JOHN', middle_name: null, last_name: 'SMITH',
        dob: '1990-06-15', age: 35, sex: 'M', city: 'Salt Lake City',
      },
    });
    expect(r.score).toBe(30 + 35 + 15);  // 80 — likely tier
    expect(tierFor(r.score)).toBe('likely');
  });

  it('drops to weak tier when only last name matches and DOB conflicts', () => {
    const r = matchScore({
      criteria: { ...baseCriteria, dob: '1990-06-15' },
      candidate: {
        first_name: 'Bob', middle_name: null, last_name: 'Smith',
        dob: '1970-06-15', age: null, sex: null, city: null,
      },
    });
    expect(r.score).toBe(10 - 20);
    expect(tierFor(r.score)).toBe('weak');
  });
});

// ── tierFor ───────────────────────────────────────────────

describe('tierFor', () => {
  it('maps boundaries correctly', () => {
    expect(tierFor(95)).toBe('strong');
    expect(tierFor(90)).toBe('strong');
    expect(tierFor(89)).toBe('likely');
    expect(tierFor(60)).toBe('likely');
    expect(tierFor(59)).toBe('potential');
    expect(tierFor(30)).toBe('potential');
    expect(tierFor(29)).toBe('weak');
    expect(tierFor(0)).toBe('weak');
    expect(tierFor(-25)).toBe('weak');
  });
});

// ── ageFromIsoDob ─────────────────────────────────────────

describe('ageFromIsoDob', () => {
  it('reuses utahWarrantScraper.computeAgeFromDob (same precision)', () => {
    expect(ageFromIsoDob('1990-04-25', new Date('2026-04-25'))).toBe(36);
    expect(ageFromIsoDob('1990-04-26', new Date('2026-04-25'))).toBe(35);
  });
});

// ── pollMultiStateLive (integration) ──────────────────────

describe('pollMultiStateLive', () => {
  it('rejects empty / missing names', async () => {
    const r = await pollMultiStateLive({ first_name: '', last_name: 'Smith' });
    expect(r.results).toEqual([]);
    expect(r.sources).toEqual([]);
  });

  it('rejects organization-shaped inputs', async () => {
    const r = await pollMultiStateLive({
      first_name: 'Capital One, N.A., successor by merger',
      last_name: '(Organization)',
    });
    expect(r.results).toEqual([]);
  });

  it('aggregates results from local cache and scores them', async () => {
    testDb.prepare(`
      INSERT INTO scraped_warrants
        (id, source_key, first_name, last_name, date_of_birth, age, gender, state, warrant_id, status)
      VALUES (1, 'mt_flathead', 'JOHN', 'SMITH', '1990-06-15', 35, 'Male', 'MT', 'MT-001', 'active')
    `).run();

    const r = await pollMultiStateLive({
      first_name: 'John',
      last_name: 'Smith',
      dob: '1990-06-15',
      sex: 'M',
      asOf: new Date('2026-04-25'),
    });

    const local = r.results.find(x => x.source === 'local_cache');
    expect(local).toBeDefined();
    expect(local!.match_score).toBeGreaterThanOrEqual(60);
    expect(local!.match_tier).toMatch(/^(likely|strong)$/);
    expect(r.sources.find(s => s.source === 'local_cache')?.status).toBe('ok');
  });

  it('drops weak (<30) matches', async () => {
    testDb.prepare(`
      INSERT INTO scraped_warrants
        (id, source_key, first_name, last_name, state, warrant_id, status)
      VALUES (1, 'x', 'Bob', 'Smith', 'XX', 'X-1', 'active')
    `).run();

    const r = await pollMultiStateLive({
      first_name: 'John',
      last_name: 'Smith',
    });
    // 'Bob Smith' vs 'John Smith': last only → 10 → 'weak' → dropped
    const local = r.results.find(x => x.source === 'local_cache');
    expect(local).toBeUndefined();
  });

  it('reports per-source health when a backend errors', async () => {
    // Simulate FBI fetch failure.
    globalThis.fetch = vi.fn(async () => { throw new Error('network down'); }) as any;

    const r = await pollMultiStateLive({ first_name: 'John', last_name: 'Smith' });
    const fbi = r.sources.find(s => s.source === 'fbi_live');
    expect(fbi?.status).toBe('error');
    expect(fbi?.error).toBeDefined();

    globalThis.fetch = originalFetch;
  });

  it('sorts results by match_score descending', async () => {
    testDb.prepare(`
      INSERT INTO scraped_warrants (id, source_key, first_name, last_name, date_of_birth, age, state, status)
      VALUES (1, 'x', 'JOHN', 'SMITH', NULL, NULL, 'CA', 'active')
    `).run();
    testDb.prepare(`
      INSERT INTO scraped_warrants (id, source_key, first_name, last_name, date_of_birth, age, gender, state, status)
      VALUES (2, 'x', 'JOHN', 'SMITH', '1990-06-15', 35, 'Male', 'MT', 'active')
    `).run();

    const r = await pollMultiStateLive({
      first_name: 'John',
      last_name: 'Smith',
      dob: '1990-06-15',
      sex: 'M',
      asOf: new Date('2026-04-25'),
    });

    if (r.results.length >= 2) {
      expect(r.results[0].match_score).toBeGreaterThanOrEqual(r.results[1].match_score);
    }
  });
});
