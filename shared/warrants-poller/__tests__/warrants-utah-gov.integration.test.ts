// LIVE integration test against warrants.utah.gov. NOT part of the
// default test run — opt in with WARRANTS_LIVE_TEST=1.
//
// Purpose: regression catcher for upstream API drift. If UDPS changes
// their endpoint shape, this test fails LOUDLY and we update the
// adapter, instead of warrants silently disappearing in production.
//
// CI: do NOT enable this by default. Hitting a state agency's public
// API on every PR is rude and may trigger rate limits / IP blocks.
// Run it manually before adapter releases, or on a weekly cron.
//
// Run:    WARRANTS_LIVE_TEST=1 vitest run shared/warrants-poller/__tests__/warrants-utah-gov.integration.test.ts

import { describe, it, expect } from 'vitest';
import { WarrantsUtahGovSource } from '../sources/warrants-utah-gov.ts';

const enabled = process.env.WARRANTS_LIVE_TEST === '1';
const describeIfLive = enabled ? describe : describe.skip;

describeIfLive('warrants.utah.gov LIVE integration', () => {
  it('returns warrants for a common name (smoke test against prod API)', async () => {
    // JOHN SMITH is intentionally chosen as the test query — common
    // enough to reliably return multi-match results across snapshots
    // taken months apart, low signal-to-noise about any specific person.
    const source = new WarrantsUtahGovSource({ minIntervalMs: 500 });
    const results = await source.lookup({ name: 'JOHN SMITH' });

    // Don't assert exact count (data changes over time as warrants are
    // issued/served). Assert structural invariants instead.
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    for (const w of results) {
      expect(w.source).toBe('warrants-utah-gov');
      expect(typeof w.sourceWarrantId).toBe('string');
      expect(w.sourceWarrantId.length).toBeGreaterThan(0);
      expect(typeof w.subjectName).toBe('string');
      expect(w.subjectName).toMatch(/^[A-Z]+,/); // canonical "LAST," form
      expect(Array.isArray(w.charges)).toBe(true);
      expect(typeof w.fetchedAt).toBe('string');
      // Optional fields exist or are undefined; never null, never empty
      // string. (Empty string would indicate a parsing bug.)
      if (w.issuedDate !== undefined) expect(w.issuedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (w.issuingCourt !== undefined) expect(w.issuingCourt.length).toBeGreaterThan(0);
    }
  }, 30_000);

  it('disambiguates by age in a live multi-match (returns subset)', async () => {
    const source = new WarrantsUtahGovSource({ minIntervalMs: 500 });
    const all = await source.lookup({ name: 'JOHN SMITH' });
    const filtered = await source.lookup({ name: 'JOHN SMITH', age: 47 });

    // Filtered set must be a non-strict subset (same or fewer).
    expect(filtered.length).toBeLessThanOrEqual(all.length);
  }, 60_000);

  it('handles a name with zero warrants without throwing', async () => {
    const source = new WarrantsUtahGovSource({ minIntervalMs: 500 });
    // Made-up unlikely name. If this ever returns hits, the upstream is
    // doing fuzzy matching and we'd want to know.
    const results = await source.lookup({ name: 'ZZQX VWNPLM' });
    expect(results).toEqual([]);
  }, 30_000);
});
