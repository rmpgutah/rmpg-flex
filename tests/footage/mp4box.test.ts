import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { remuxMp4SegmentsToFmp4 } from '../../src/utils/footage/mp4box';

const clipA = readFileSync(resolve(__dirname, '../fixtures/footage/clip-a.mp4'));
const clipB = readFileSync(resolve(__dirname, '../fixtures/footage/clip-b.mp4'));

describe('remuxMp4SegmentsToFmp4', () => {
  it('produces a non-empty fMP4 byte buffer for one input segment', async () => {
    const result = await remuxMp4SegmentsToFmp4([new Uint8Array(clipA)]);
    expect(result.bytes.byteLength).toBeGreaterThan(1000);
    // fMP4 marker: 'ftyp' box near the start (offset 4)
    const head = String.fromCharCode(...result.bytes.subarray(4, 8));
    expect(head).toBe('ftyp');
  });

  it('concatenates two segments into one fMP4', async () => {
    const result = await remuxMp4SegmentsToFmp4([
      new Uint8Array(clipA),
      new Uint8Array(clipB),
    ]);
    // Result should be larger than either input alone.
    expect(result.bytes.byteLength).toBeGreaterThan(clipA.length);
  });

  it('throws a typed error on unparseable input', async () => {
    const junk = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    await expect(remuxMp4SegmentsToFmp4([junk])).rejects.toMatchObject({
      code: 'mp4box_parse_failed',
    });
  });
});
