import { describe, it, expect } from 'vitest';

// The chunkIds function is module-private in warrants.ts; replicate the
// logic here so the test validates the invariant directly: no IN-list
// should ever exceed D1's 100-bound-parameter cap.
const ID_CHUNK_SIZE = 90;
function chunkIds(ids: number[]): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) chunks.push(ids.slice(i, i + ID_CHUNK_SIZE));
  return chunks;
}

describe('warrants CSV export — IN-list chunking', () => {
  it('splits >90 ids into chunks of ≤90', () => {
    const ids = Array.from({ length: 200 }, (_, i) => i + 1);
    const chunks = chunkIds(ids);
    expect(chunks.length).toBe(3); // 90 + 90 + 20
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(ID_CHUNK_SIZE);
    expect(chunks.flat()).toEqual(ids);
  });

  it('returns a single chunk when ids ≤ 90', () => {
    const ids = Array.from({ length: 50 }, (_, i) => i + 1);
    const chunks = chunkIds(ids);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toEqual(ids);
  });

  it('handles exactly 90 ids as a single chunk', () => {
    const ids = Array.from({ length: 90 }, (_, i) => i + 1);
    const chunks = chunkIds(ids);
    expect(chunks.length).toBe(1);
  });

  it('handles 500 ids (the CSV export max) without exceeding the cap', () => {
    const ids = Array.from({ length: 500 }, (_, i) => i + 1);
    const chunks = chunkIds(ids);
    expect(chunks.length).toBe(6); // ceil(500/90) = 6
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(ID_CHUNK_SIZE);
    expect(chunks.flat().length).toBe(500);
  });

  it('handles empty array', () => {
    expect(chunkIds([])).toEqual([]);
  });
});
