import { describe, it, expect } from 'vitest';
import { resolveAttribution, type AssignmentWindow } from '../src/utils/driverPerformance/attribution';

const W: AssignmentWindow[] = [
  { officerId: 10, startMs: Date.parse('2026-03-01T00:00:00Z'), endMs: Date.parse('2026-03-10T00:00:00Z') },
  { officerId: 20, startMs: Date.parse('2026-03-10T00:00:00Z'), endMs: null }, // open-ended
];
const at = (iso: string) => Date.parse(iso);

describe('resolveAttribution', () => {
  it('prefers a stamped officer over any assignment window', () => {
    expect(resolveAttribution(99, at('2026-03-05T12:00:00Z'), W))
      .toEqual({ officerId: 99, source: 'recorded' });
  });

  it('infers from the assignment window covering the event', () => {
    expect(resolveAttribution(null, at('2026-03-05T12:00:00Z'), W))
      .toEqual({ officerId: 10, source: 'inferred' });
  });

  it('treats an open-ended window as extending to now', () => {
    expect(resolveAttribution(null, at('2026-06-01T00:00:00Z'), W))
      .toEqual({ officerId: 20, source: 'inferred' });
  });

  it('returns unattributed outside every window, not the nearest one', () => {
    expect(resolveAttribution(null, at('2026-01-01T00:00:00Z'), W))
      .toEqual({ officerId: null, source: 'unattributed' });
  });

  it('is half-open: the window end belongs to the next assignment', () => {
    expect(resolveAttribution(null, at('2026-03-10T00:00:00Z'), W))
      .toEqual({ officerId: 20, source: 'inferred' });
  });

  it('returns unattributed when the event timestamp is unparseable', () => {
    expect(resolveAttribution(null, null, W))
      .toEqual({ officerId: null, source: 'unattributed' });
  });

  it('returns unattributed when windows overlap ambiguously', () => {
    const overlap: AssignmentWindow[] = [
      { officerId: 1, startMs: at('2026-03-01T00:00:00Z'), endMs: at('2026-03-20T00:00:00Z') },
      { officerId: 2, startMs: at('2026-03-05T00:00:00Z'), endMs: at('2026-03-25T00:00:00Z') },
    ];
    expect(resolveAttribution(null, at('2026-03-10T00:00:00Z'), overlap))
      .toEqual({ officerId: null, source: 'unattributed' });
  });

  // I2: duplicate/overlapping rows for the SAME officer are not ambiguity.
  // Before the fix these counted as 2 raw matches and the event was dropped
  // from a real driver's record with no error and no counter.
  it('resolves two overlapping windows for the SAME officer to that officer', () => {
    const dup: AssignmentWindow[] = [
      { officerId: 7, startMs: at('2026-03-01T00:00:00Z'), endMs: at('2026-03-20T00:00:00Z') },
      { officerId: 7, startMs: at('2026-03-05T00:00:00Z'), endMs: null },
    ];
    expect(resolveAttribution(null, at('2026-03-10T00:00:00Z'), dup))
      .toEqual({ officerId: 7, source: 'inferred' });
  });

  it('still returns unattributed for two overlapping windows with DIFFERENT officers', () => {
    const two: AssignmentWindow[] = [
      { officerId: 7, startMs: at('2026-03-01T00:00:00Z'), endMs: null },
      { officerId: 8, startMs: at('2026-03-05T00:00:00Z'), endMs: null },
    ];
    expect(resolveAttribution(null, at('2026-03-10T00:00:00Z'), two))
      .toEqual({ officerId: null, source: 'unattributed' });
  });

  it('returns unattributed when there are no windows at all', () => {
    expect(resolveAttribution(null, at('2026-03-10T00:00:00Z'), []))
      .toEqual({ officerId: null, source: 'unattributed' });
  });

  it('treats a stamped officer id of 0 as a valid id, not as falsy/absent', () => {
    expect(resolveAttribution(0, at('2026-03-05T12:00:00Z'), W))
      .toEqual({ officerId: 0, source: 'recorded' });
  });

  it('infers officer id 0 from a window rather than treating it as unattributed', () => {
    const zero: AssignmentWindow[] = [
      { officerId: 0, startMs: at('2026-03-01T00:00:00Z'), endMs: null },
    ];
    expect(resolveAttribution(null, at('2026-03-10T00:00:00Z'), zero))
      .toEqual({ officerId: 0, source: 'inferred' });
  });
});
