import { describe, it, expect } from 'vitest';
import { scanInstallers } from '../src/routes/downloads';

function fakeBucket(objects: Array<{ key: string; size: number; uploaded: Date }>) {
  return {
    list: async () => ({ objects }),
    get: async (key: string) => {
      const obj = objects.find((o) => o.key === key);
      return obj ? { size: obj.size, arrayBuffer: async () => new ArrayBuffer(obj.size) } : null;
    },
  } as any;
}

describe('scanInstallers — os (Kiosk Linux) detection', () => {
  it('detects a kiosk-linux-os-*.tar.gz file as the os category', async () => {
    const bucket = fakeBucket([
      { key: 'kiosk-linux-os-1.0.0.tar.gz', size: 15_728_640, uploaded: new Date('2026-07-22T00:00:00Z') },
    ]);
    const info = await scanInstallers(bucket);
    expect(info.os).toBeDefined();
    expect(info.os?.filename).toBe('kiosk-linux-os-1.0.0.tar.gz');
    expect(info.os?.version).toBe('1.0.0');
    expect(info.os?.size).toBe('15.0 MB');
  });

  it('picks the highest version when multiple os archives exist', async () => {
    const bucket = fakeBucket([
      { key: 'kiosk-linux-os-1.0.0.tar.gz', size: 1000, uploaded: new Date('2026-07-01T00:00:00Z') },
      { key: 'kiosk-linux-os-1.2.0.tar.gz', size: 2000, uploaded: new Date('2026-07-22T00:00:00Z') },
    ]);
    const info = await scanInstallers(bucket);
    expect(info.os?.filename).toBe('kiosk-linux-os-1.2.0.tar.gz');
  });

  it('leaves os undefined when no matching file exists', async () => {
    const bucket = fakeBucket([
      { key: 'RMPG-Flex-Setup-5.8.4.exe', size: 1000, uploaded: new Date() },
    ]);
    const info = await scanInstallers(bucket);
    expect(info.os).toBeUndefined();
  });

  it('does not misclassify an unrelated .tar.gz file', async () => {
    const bucket = fakeBucket([
      { key: 'some-other-archive-2.0.0.tar.gz', size: 1000, uploaded: new Date() },
    ]);
    const info = await scanInstallers(bucket);
    expect(info.os).toBeUndefined();
  });

  // The OS image is written to a USB stick from whatever laptop is on hand,
  // which in practice is a Windows machine — and Windows cannot open a
  // .tar.gz by double-clicking, so serving one made the very first install
  // step a blocker. Prefer the .zip whenever both formats are present.
  it('prefers the .zip over the .tar.gz when both exist for the same version', async () => {
    const bucket = fakeBucket([
      { key: 'kiosk-linux-os-1.2.0.tar.gz', size: 247_592_401, uploaded: new Date('2026-07-25T01:31:00Z') },
      { key: 'kiosk-linux-os-1.2.0.zip', size: 247_872_459, uploaded: new Date('2026-07-25T06:05:00Z') },
    ]);
    const info = await scanInstallers(bucket);
    expect(info.os?.filename).toBe('kiosk-linux-os-1.2.0.zip');
    expect(info.os?.version).toBe('1.2.0');
    expect(info.os?.bytes).toBe(247_872_459);
  });

  it('still serves the .tar.gz when no .zip has been published', async () => {
    const bucket = fakeBucket([
      { key: 'kiosk-linux-os-1.2.0.tar.gz', size: 247_592_401, uploaded: new Date('2026-07-25T01:31:00Z') },
    ]);
    const info = await scanInstallers(bucket);
    expect(info.os?.filename).toBe('kiosk-linux-os-1.2.0.tar.gz');
  });

  it('detects a .zip-only OS release', async () => {
    const bucket = fakeBucket([
      { key: 'kiosk-linux-os-1.3.0.zip', size: 300_000_000, uploaded: new Date('2026-07-25T06:05:00Z') },
    ]);
    const info = await scanInstallers(bucket);
    expect(info.os?.filename).toBe('kiosk-linux-os-1.3.0.zip');
    expect(info.os?.version).toBe('1.3.0');
  });
});
