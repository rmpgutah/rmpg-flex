import { describe, it, expect } from 'vitest';
import { computeResponseDurations, firstLineBaseline } from '../pdfGenerator';

describe('firstLineBaseline', () => {
  // jsPDF positions text by its BASELINE and draws glyphs upward from it, so a
  // first line placed at the content-box top edge renders back inside the
  // section header bar. That produced the "None recorded" text struck through
  // the VEHICLES INVOLVED (0) and EVIDENCE / PROPERTY (0) headers.
  it('pushes the baseline below the content-box top edge', () => {
    expect(firstLineBaseline(100, 7.5)).toBeGreaterThan(100);
  });

  it('clears the 1.2mm section content pad at the sizes actually used', () => {
    const SECTION_CONTENT_PAD = 1.2;
    for (const pt of [6, 7, 7.5, 8, 9, 10]) {
      expect(firstLineBaseline(0, pt)).toBeGreaterThan(SECTION_CONTENT_PAD);
    }
  });

  it('scales with font size rather than being a fixed nudge', () => {
    const small = firstLineBaseline(0, 6);
    const large = firstLineBaseline(0, 12);
    expect(large).toBeGreaterThan(small);
    expect(large / small).toBeCloseTo(2, 5);
  });

  it('converts points to millimetres', () => {
    // 72pt == 1 inch == 25.4mm
    expect(firstLineBaseline(0, 72)).toBeCloseTo(25.4, 6);
  });
});

describe('computeResponseDurations', () => {
  const base = {
    dispatched_at: '2026-07-24T18:36:12Z',
    enroute_at: '2026-07-24T18:37:40Z',
    onscene_at: '2026-07-24T18:52:04Z',
    cleared_at: '2026-07-24T19:17:44Z',
  };

  it('computes response, on-scene and total durations', () => {
    const d = computeResponseDurations(base);
    expect(d.responseTime).toBe('16m');   // 18:36:12 -> 18:52:04 = 15m52s
    expect(d.onSceneTime).toBe('26m');    // 18:52:04 -> 19:17:44 = 25m40s
    expect(d.totalTime).toBe('42m');      // 18:36:12 -> 19:17:44 = 41m32s
    expect(d.any).toBe(true);
  });

  it('formats durations over an hour with zero-padded minutes', () => {
    const d = computeResponseDurations({
      dispatched_at: '2026-07-24T10:00:00Z',
      onscene_at: '2026-07-24T11:07:00Z',
    });
    expect(d.responseTime).toBe('1h 07m');
  });

  it('falls back to closed_at when cleared_at is absent', () => {
    const d = computeResponseDurations({
      dispatched_at: '2026-07-24T10:00:00Z',
      closed_at: '2026-07-24T10:30:00Z',
    });
    expect(d.totalTime).toBe('30m');
  });

  it('reports nothing when the call was never dispatched', () => {
    const d = computeResponseDurations({});
    expect(d).toMatchObject({ responseTime: '', onSceneTime: '', totalTime: '', any: false });
  });

  it('omits a duration whose endpoints are out of order rather than printing a negative', () => {
    // Bad data should read as absent, never as "-12m" on a court-bound record.
    const d = computeResponseDurations({
      dispatched_at: '2026-07-24T19:00:00Z',
      onscene_at: '2026-07-24T18:00:00Z',
    });
    expect(d.responseTime).toBe('');
  });

  it('survives malformed timestamps without throwing', () => {
    expect(() => computeResponseDurations({
      dispatched_at: 'not-a-date', onscene_at: '2026-07-24T18:00:00Z',
    })).not.toThrow();
    expect(computeResponseDurations({ dispatched_at: 'not-a-date', onscene_at: 'also-bad' }).any).toBe(false);
  });

  it('never measures a duration against report-generation time', () => {
    // parseTimestamp() falls back to `new Date()` for unparseable input. With a
    // valid start and a corrupt end that would silently print dispatch -> now
    // as the response time: a fabricated figure on a court-bound record.
    const d = computeResponseDurations({
      dispatched_at: '2026-07-24T18:36:12Z',
      onscene_at: 'corrupted',
      cleared_at: 'corrupted',
    });
    expect(d.responseTime).toBe('');
    expect(d.totalTime).toBe('');
    expect(d.any).toBe(false);
  });

  it('sets any=false when only one endpoint of every pair exists', () => {
    // A call dispatched but never marked on-scene or cleared has no computable
    // duration — the section must not open for it.
    expect(computeResponseDurations({ dispatched_at: '2026-07-24T10:00:00Z' }).any).toBe(false);
  });
});
