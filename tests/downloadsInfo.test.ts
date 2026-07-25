import { describe, it, expect } from 'vitest';
import { scanInstallers } from '../src/routes/downloads';

const ORIGIN = 'https://api.rmpgutah.us';

type FakeObj = {
  key: string;
  size: number;
  uploaded: Date;
  customMetadata?: Record<string, string>;
};

/** Single-page fake bucket that records the options list() was called with. */
function fakeBucket(objects: FakeObj[], spy?: { include?: string[] }) {
  return {
    async list(opts?: { include?: string[]; cursor?: string }) {
      if (spy) spy.include = opts?.include;
      return { objects, truncated: false };
    },
  } as any;
}

/** Two-page fake bucket, to prove the cursor is followed. */
function pagedBucket(page1: FakeObj[], page2: FakeObj[]) {
  return {
    async list(opts?: { cursor?: string }) {
      return opts?.cursor
        ? { objects: page2, truncated: false }
        : { objects: page1, truncated: true, cursor: 'CURSOR' };
    },
  } as any;
}

const dmg: FakeObj = {
  key: 'RMPG-Flex-5.8.6-arm64.dmg',
  size: 125030770,
  uploaded: new Date('2026-07-25T00:00:00Z'),
  customMetadata: { sha256: 'a'.repeat(64) },
};

describe('scanInstallers', () => {
  it('returns an absolute url built from the request origin', async () => {
    const info = await scanInstallers(fakeBucket([dmg]), ORIGIN);
    expect(info.mac?.url).toBe(`${ORIGIN}/downloads/RMPG-Flex-5.8.6-arm64.dmg`);
  });

  it('uses the origin it was given, so dev resolves to the local Worker', async () => {
    const info = await scanInstallers(fakeBucket([dmg]), 'http://localhost:8787');
    expect(info.mac?.url).toBe('http://localhost:8787/downloads/RMPG-Flex-5.8.6-arm64.dmg');
  });

  it('exposes the sha256 stored in customMetadata', async () => {
    const info = await scanInstallers(fakeBucket([dmg]), ORIGIN);
    expect(info.mac?.sha256).toBe('a'.repeat(64));
  });

  it('omits sha256 for artifacts published before checksums existed', async () => {
    const legacy = { ...dmg, customMetadata: undefined };
    const info = await scanInstallers(fakeBucket([legacy]), ORIGIN);
    expect(info.mac).toBeDefined();
    expect('sha256' in (info.mac as object)).toBe(false);
  });

  // Guards the exact silent failure this change exists to avoid: with
  // compatibility_date >= 2022-08-04 (ours is 2026-05-01) a bare list()
  // returns NO customMetadata, so every checksum would read undefined and
  // nothing would look broken.
  it('asks list() for customMetadata', async () => {
    const spy: { include?: string[] } = {};
    await scanInstallers(fakeBucket([dmg], spy), ORIGIN);
    expect(spy.include).toContain('customMetadata');
  });

  // R2 returns fewer objects per page when metadata is requested, so a single
  // list() call can silently omit artifacts.
  it('follows the cursor across pages', async () => {
    const exe: FakeObj = {
      key: 'RMPG-Flex-Setup-5.8.6.exe',
      size: 103001016,
      uploaded: new Date('2026-07-25T00:00:00Z'),
    };
    const info = await scanInstallers(pagedBucket([dmg], [exe]), ORIGIN);
    expect(info.mac?.filename).toBe('RMPG-Flex-5.8.6-arm64.dmg');
    expect(info.win?.filename).toBe('RMPG-Flex-Setup-5.8.6.exe');
  });

  it('percent-encodes filenames containing spaces', async () => {
    const apk: FakeObj = {
      key: 'RMPG Flex-5.8.0.apk',
      size: 39416087,
      uploaded: new Date('2026-05-24T00:00:00Z'),
    };
    const info = await scanInstallers(fakeBucket([apk]), ORIGIN);
    expect(info.android?.url).toBe(`${ORIGIN}/downloads/RMPG%20Flex-5.8.0.apk`);
  });
});
