import { describe, it, expect } from 'vitest';
import {
  parseImageExif,
  exifDateTimeToUtcIso,
  mountainWallClockToUtcIso,
  gpsDmsToDecimal,
  mergeExif,
  signedWgs84,
} from '../src/utils/imageExif';

function le16(n: number): number[] { return [n & 0xff, (n >> 8) & 0xff]; }
function le32(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}

/** Minimal JPEG + APP1 Exif with IFD0 DateTime + GPS IFD. */
function jpegWithExif(opts: {
  dateTime?: string;
  lat?: [number, number, number];
  lon?: [number, number, number];
  latRef?: string;
  lonRef?: string;
}): Uint8Array {
  const tiff: number[] = [];
  const push = (...b: number[]) => { tiff.push(...b); };

  // Header II + magic + IFD0 offset 8
  push(0x49, 0x49, 0x2a, 0x00, ...le32(8));

  const dateTime = opts.dateTime ?? '2026:08:27 07:40:45';
  const dateBytes = [...dateTime.split('').map((c) => c.charCodeAt(0)), 0];
  while (dateBytes.length < 20) dateBytes.push(0);

  const hasGps = opts.lat != null && opts.lon != null;
  const ifd0Count = hasGps ? 2 : 1;

  // IFD0 at offset 8
  const ifd0Start = 8;
  push(...le16(ifd0Count));
  // Entry 0x0132 DateTime type=ASCII count=20 value-offset (filled later)
  const datetimeEntryValAt = tiff.length + 8; // start of value/offset field
  push(...le16(0x0132), ...le16(2), ...le32(20), ...le32(0));
  let gpsEntryValAt = 0;
  if (hasGps) {
    gpsEntryValAt = tiff.length + 8;
    push(...le16(0x8825), ...le16(4), ...le32(1), ...le32(0));
  }
  push(...le32(0)); // next IFD

  const datetimeOff = tiff.length;
  tiff[datetimeEntryValAt] = datetimeOff & 0xff;
  tiff[datetimeEntryValAt + 1] = (datetimeOff >> 8) & 0xff;
  tiff[datetimeEntryValAt + 2] = (datetimeOff >> 16) & 0xff;
  tiff[datetimeEntryValAt + 3] = (datetimeOff >>> 24) & 0xff;
  push(...dateBytes);

  if (hasGps && opts.lat && opts.lon) {
    const latRef = (opts.latRef ?? 'N') + '\0';
    const lonRef = (opts.lonRef ?? 'W') + '\0';
    // GPS IFD: 4 entries
    const gpsIfdOff = tiff.length;
    tiff[gpsEntryValAt] = gpsIfdOff & 0xff;
    tiff[gpsEntryValAt + 1] = (gpsIfdOff >> 8) & 0xff;
    tiff[gpsEntryValAt + 2] = (gpsIfdOff >> 16) & 0xff;
    tiff[gpsEntryValAt + 3] = (gpsIfdOff >>> 24) & 0xff;

    push(...le16(4));
    // We'll append rationals after the IFD, then patch offsets.
    const entriesStart = tiff.length;
    // 4 entries * 12 + 4 next = 52, then data
    for (let i = 0; i < 4; i++) push(...new Array(12).fill(0));
    push(...le32(0));

    const writeEntry = (idx: number, tag: number, type: number, count: number, valueBytes: number[]) => {
      const e = entriesStart + idx * 12;
      const row = [...le16(tag), ...le16(type), ...le32(count), ...valueBytes];
      for (let i = 0; i < 12; i++) tiff[e + i] = row[i];
    };

    const latRefBytes = [latRef.charCodeAt(0), 0, 0, 0];
    const lonRefBytes = [lonRef.charCodeAt(0), 0, 0, 0];
    writeEntry(0, 0x0001, 2, 2, latRefBytes);
    writeEntry(2, 0x0003, 2, 2, lonRefBytes);

    const ratBytes = (dms: [number, number, number]) => {
      const out: number[] = [];
      for (const v of dms) {
        const num = Math.round(v * 1000);
        out.push(...le32(num), ...le32(1000));
      }
      return out;
    };
    const latDataOff = tiff.length;
    push(...ratBytes(opts.lat));
    const lonDataOff = tiff.length;
    push(...ratBytes(opts.lon));
    writeEntry(1, 0x0002, 5, 3, le32(latDataOff));
    writeEntry(3, 0x0004, 5, 3, le32(lonDataOff));
    void ifd0Start;
  }

  const app1Payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const app1Len = app1Payload.length + 2;
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe1, (app1Len >> 8) & 0xff, app1Len & 0xff,
    ...app1Payload,
    0xff, 0xd9,
  ]);
}

describe('exifDateTimeToUtcIso', () => {
  it('applies an explicit offset (no Denver guess)', () => {
    expect(exifDateTimeToUtcIso('2026:08:27 07:40:45', '-06:00'))
      .toBe('2026-08-27T13:40:45.000Z');
  });

  it('treats offset-less DateTimeOriginal as America/Denver, not UTC', () => {
    // 07:40:45 MDT = 13:40:45Z — NOT 07:40:45Z (the 6-hour bug)
    expect(exifDateTimeToUtcIso('2026:08:27 07:40:45', null))
      .toBe('2026-08-27T13:40:45.000Z');
    expect(mountainWallClockToUtcIso('2026-08-27T07:40:45'))
      .toBe('2026-08-27T13:40:45.000Z');
  });

  it('uses MST (UTC-7) in winter', () => {
    expect(exifDateTimeToUtcIso('2026:01:15 00:30:00'))
      .toBe('2026-01-15T07:30:00.000Z');
  });
});

describe('gpsDmsToDecimal', () => {
  it('signs west longitude', () => {
    const lon = gpsDmsToDecimal([111, 56, 40.164], 'W');
    expect(lon).toBeCloseTo(-111.94449, 5);
    const lat = gpsDmsToDecimal([40, 40, 7.644], 'N');
    expect(lat).toBeCloseTo(40.66879, 5);
  });

  it('restores a missing minus on CONUS west longitude', () => {
    expect(signedWgs84(40.66879, 111.94449).lon).toBeCloseTo(-111.94449, 5);
    expect(signedWgs84(40.66879, -111.94449).lon).toBeCloseTo(-111.94449, 5);
  });
});

describe('parseImageExif', () => {
  it('reads DateTimeOriginal-equivalent IFD0 DateTime as Denver local', () => {
    const jpeg = jpegWithExif({ dateTime: '2026:08:27 07:40:45' });
    const parsed = parseImageExif(jpeg);
    expect(parsed?.takenAtIso).toBe('2026-08-27T13:40:45.000Z');
  });

  it('reads GPS and applies W/S refs', () => {
    const jpeg = jpegWithExif({
      dateTime: '2026:08:27 07:40:45',
      lat: [40, 40, 7.644],
      lon: [111, 56, 40.164],
      latRef: 'N',
      lonRef: 'W',
    });
    const parsed = parseImageExif(jpeg);
    expect(parsed?.latitude).toBeCloseTo(40.66879, 4);
    expect(parsed?.longitude).toBeCloseTo(-111.94449, 4);
  });

  it('signs west longitude when GPSLongitudeRef is omitted', () => {
    const jpeg = jpegWithExif({
      dateTime: '2026:08:27 07:40:45',
      lat: [40, 40, 7.644],
      lon: [111, 56, 40.164],
      latRef: 'N',
      lonRef: '',
    });
    const parsed = parseImageExif(jpeg);
    expect(parsed?.longitude).toBeCloseTo(-111.94449, 4);
  });

  it('returns null for a JPEG with no APP1', () => {
    expect(parseImageExif(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
  });
});

describe('mergeExif', () => {
  it('fills blanks from EXIF without overwriting officer-entered values', () => {
    const exif = { latitude: 40.1, longitude: -111.2, takenAtIso: '2026-08-27T13:40:45.000Z' };
    expect(mergeExif({ latitude: 1, longitude: null, taken_at: null }, exif)).toEqual({
      latitude: 1,
      longitude: -111.2,
      taken_at: '2026-08-27T13:40:45.000Z',
    });
  });
});
