// tests/footage/splitWindow.test.ts
import { describe, it, expect } from 'vitest';
import { splitWindow, detectGaps, orderedDownloaded } from '../../src/utils/footage/splitWindow';

const MIN = 60_000;

describe('splitWindow', () => {
  it('splits an exact multiple into equal chunks', () => {
    const chunks = splitWindow(0, 120_000, 40); // 120s / 40s = 3
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ seq: 0, fromTs: 0, toTs: 40_000 });
    expect(chunks[2]).toEqual({ seq: 2, fromTs: 80_000, toTs: 120_000 });
  });

  it('makes a final short chunk for a remainder', () => {
    const chunks = splitWindow(0, 50_000, 40); // 50s → 40 + 10
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toEqual({ seq: 1, fromTs: 40_000, toTs: 50_000 });
  });

  it('returns one chunk when window <= maxSeconds', () => {
    expect(splitWindow(0, 30_000, 40)).toEqual([{ seq: 0, fromTs: 0, toTs: 30_000 }]);
  });

  it('returns [] for a zero or inverted window', () => {
    expect(splitWindow(100, 100, 40)).toEqual([]);
    expect(splitWindow(200, 100, 40)).toEqual([]);
  });

  it('caps chunk count and is monotonic for a long trip', () => {
    const chunks = splitWindow(0, 30 * MIN, 40); // 1800s / 40 = 45
    expect(chunks).toHaveLength(45);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].fromTs).toBe(chunks[i - 1].toTs);
  });
});

describe('detectGaps / orderedDownloaded', () => {
  const rows = [
    { seq: 0, status: 'downloaded', r2_key: 'k0' },
    { seq: 1, status: 'missing', r2_key: null },
    { seq: 2, status: 'downloaded', r2_key: 'k2' },
  ];
  it('detectGaps returns the seqs that are missing', () => {
    expect(detectGaps(rows)).toEqual([1]);
  });
  it('orderedDownloaded returns only downloaded rows, in seq order', () => {
    expect(orderedDownloaded([rows[2], rows[0], rows[1]])).toEqual([
      { seq: 0, r2_key: 'k0' },
      { seq: 2, r2_key: 'k2' },
    ]);
  });

  it('detectGaps returns [] for an empty input', () => {
    expect(detectGaps([])).toEqual([]);
  });

  it('orderedDownloaded returns [] for an empty input', () => {
    expect(orderedDownloaded([])).toEqual([]);
  });

  it('orderedDownloaded excludes a downloaded row with null r2_key (corrupted partial)', () => {
    const withCorrupted = [
      { seq: 0, status: 'downloaded', r2_key: 'k0' },
      { seq: 1, status: 'downloaded', r2_key: null }, // corrupted partial — must be excluded
      { seq: 2, status: 'downloaded', r2_key: 'k2' },
    ];
    expect(orderedDownloaded(withCorrupted)).toEqual([
      { seq: 0, r2_key: 'k0' },
      { seq: 2, r2_key: 'k2' },
    ]);
  });
});
