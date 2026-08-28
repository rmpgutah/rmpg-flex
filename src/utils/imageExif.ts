// ============================================================
// JPEG EXIF reader — GPS + capture time (Worker + tests)
// ============================================================
// Parses APP1 Exif/TIFF from a JPEG (or TIFF-in-APP1) buffer. No
// dependencies. Returns null when the file has no usable EXIF.
//
// Capture time:
//   1. GPSDateStamp + GPSTimeStamp (UTC by spec) when both present
//   2. DateTimeOriginal + OffsetTimeOriginal / OffsetTime
//   3. DateTimeOriginal interpreted as America/Denver wall-clock
//      (Utah operation — cameras that omit OffsetTime still encode
//      local time, not UTC; treating that string as Z is the classic
//      6-hour MDT skew).
//
// GPS:
//   GPSLatitude / GPSLongitude + N/S E/W refs. West/South are signed.

export interface ImageExif {
  latitude?: number;
  longitude?: number;
  /** Canonical UTC instant with Z. */
  takenAtIso?: string;
}

const DENVER = 'America/Denver';

function denverOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DENVER,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(instant);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  let hour = get('hour');
  if (hour === 24) hour = 0;
  return Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'))
    - instant.getTime();
}

/** "YYYY:MM:DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SS" → Denver-local → UTC ISO. */
export function mountainWallClockToUtcIso(wall: string): string | undefined {
  const m = wall.trim().match(
    /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!m) return undefined;
  const naive = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}`;
  const provisional = new Date(`${naive}Z`);
  if (isNaN(provisional.getTime())) return undefined;
  return new Date(provisional.getTime() - denverOffsetMs(provisional)).toISOString();
}

export function exifDateTimeToUtcIso(
  dateTime: string,
  offset?: string | null,
): string | undefined {
  const m = dateTime.trim().match(
    /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!m) return undefined;
  const isoLocal = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}`;
  const off = (offset || '').trim();
  if (/^[+-]\d{2}:\d{2}$/.test(off) || /^[+-]\d{4}$/.test(off)) {
    const norm = off.length === 5 ? `${off.slice(0, 3)}:${off.slice(3)}` : off;
    const d = new Date(`${isoLocal}${norm}`);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (/^Z$/i.test(off)) {
    const d = new Date(`${isoLocal}Z`);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return mountainWallClockToUtcIso(isoLocal);
}

export function gpsDmsToDecimal(
  dms: [number, number, number],
  ref: string,
): number | undefined {
  const [deg, min, sec] = dms;
  if (![deg, min, sec].every((n) => Number.isFinite(n))) return undefined;
  let dec = Math.abs(deg) + min / 60 + sec / 3600;
  const r = ref.trim().toUpperCase();
  if (r === 'S' || r === 'W') dec = -dec;
  if (!Number.isFinite(dec) || Math.abs(dec) > 180) return undefined;
  return dec;
}

/**
 * Cameras (notably iPhone) often omit GPSLongitudeRef and leave west
 * longitude unsigned (111.94 instead of -111.94). If the pair sits in
 * the CONUS/Utah box with a positive lon, restore the west sign.
 */
export function signedWgs84(lat: number, lon: number): { lat: number; lon: number } {
  if (lat >= 24 && lat <= 50 && lon >= 65 && lon <= 180) return { lat, lon: -lon };
  if (lat <= -24 && lat >= -50 && lon >= 65 && lon <= 180) return { lat, lon: -lon };
  return { lat, lon };
}

class TiffView {
  constructor(
    readonly buf: Uint8Array,
    readonly little: boolean,
    readonly base: number,
  ) {}

  u16(off: number): number {
    const i = this.base + off;
    if (i + 2 > this.buf.length) return 0;
    return this.little
      ? this.buf[i] | (this.buf[i + 1] << 8)
      : (this.buf[i] << 8) | this.buf[i + 1];
  }

  u32(off: number): number {
    const i = this.base + off;
    if (i + 4 > this.buf.length) return 0;
    const v = this.little
      ? this.buf[i] | (this.buf[i + 1] << 8) | (this.buf[i + 2] << 16) | (this.buf[i + 3] << 24)
      : (this.buf[i] << 24) | (this.buf[i + 1] << 16) | (this.buf[i + 2] << 8) | this.buf[i + 3];
    return v >>> 0;
  }
}

function asciiAt(buf: Uint8Array, off: number, len: number): string {
  const end = Math.min(buf.length, off + len);
  let s = '';
  for (let i = off; i < end; i++) {
    const c = buf[i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function rational(view: TiffView, off: number): number {
  const n = view.u32(off);
  const d = view.u32(off + 4);
  if (!d) return NaN;
  return n / d;
}

interface IfdMap {
  [tag: number]: { type: number; count: number; valueOff: number };
}

function readIfd(view: TiffView, ifdOffset: number): IfdMap {
  const map: IfdMap = {};
  if (ifdOffset <= 0 || view.base + ifdOffset + 2 > view.buf.length) return map;
  const count = view.u16(ifdOffset);
  if (count <= 0 || count > 256) return map;
  for (let i = 0; i < count; i++) {
    const e = ifdOffset + 2 + i * 12;
    const tag = view.u16(e);
    const type = view.u16(e + 2);
    const cnt = view.u32(e + 4);
    const typeSize = type === 3 ? 2 : type === 4 ? 4 : type === 5 ? 8 : 1;
    const dataBytes = typeSize * cnt;
    const inline = dataBytes <= 4;
    const valueOff = inline ? e + 8 : view.u32(e + 8);
    map[tag] = { type, count: cnt, valueOff };
  }
  return map;
}

function readHemisphere(view: TiffView, entry: IfdMap[number] | undefined): string {
  if (!entry) return '';
  const raw = asciiAt(view.buf, view.base + entry.valueOff, Math.max(entry.count, 4));
  const ch = (raw[0] || String.fromCharCode(view.buf[view.base + entry.valueOff] || 0)).toUpperCase();
  return 'NSEW'.includes(ch) ? ch : '';
}

function readAscii(view: TiffView, entry: IfdMap[number] | undefined): string | undefined {
  if (!entry || entry.count < 1) return undefined;
  if (entry.type !== 2 && entry.type !== 7 && entry.type !== 1) return undefined;
  const s = asciiAt(view.buf, view.base + entry.valueOff, entry.count);
  return s || undefined;
}

function readRationals(view: TiffView, entry: IfdMap[number] | undefined, n: number): number[] | undefined {
  if (!entry || entry.type !== 5 || entry.count < n) return undefined;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rational(view, entry.valueOff + i * 8));
  return out;
}

function findExifApp1(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return -1;
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xda) break; // SOS
    if (marker === 0xd8 || marker === 0xd9) { i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) break;
    if (marker === 0xe1) {
      const payload = i + 4;
      if (
        bytes[payload] === 0x45 && bytes[payload + 1] === 0x78
        && bytes[payload + 2] === 0x69 && bytes[payload + 3] === 0x66
        && bytes[payload + 4] === 0 && bytes[payload + 5] === 0
      ) {
        return payload + 6;
      }
    }
    i += 2 + len;
  }
  return -1;
}

export function parseImageExif(bytes: Uint8Array | ArrayBuffer): ImageExif | null {
  const buf = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  const tiffAt = findExifApp1(buf);
  if (tiffAt < 0 || tiffAt + 8 > buf.length) return null;

  const b0 = buf[tiffAt];
  const b1 = buf[tiffAt + 1];
  const little = b0 === 0x49 && b1 === 0x49;
  const big = b0 === 0x4d && b1 === 0x4d;
  if (!little && !big) return null;

  const view = new TiffView(buf, little, tiffAt);
  if (view.u16(2) !== 42) return null;
  const ifd0 = readIfd(view, view.u32(4));
  const exifOff = ifd0[0x8769] ? view.u32(ifd0[0x8769].valueOff) : 0;
  const exif = exifOff ? readIfd(view, exifOff) : {};
  const gpsOff = ifd0[0x8825] ? view.u32(ifd0[0x8825].valueOff) : 0;
  const gps = gpsOff ? readIfd(view, gpsOff) : {};

  const out: ImageExif = {};

  const latDms = readRationals(view, gps[0x0002], 3);
  const lonDms = readRationals(view, gps[0x0004], 3);
  const latRef = readHemisphere(view, gps[0x0001]);
  const lonRef = readHemisphere(view, gps[0x0003]);
  if (latDms && lonDms) {
    const lat = gpsDmsToDecimal(latDms as [number, number, number], latRef);
    const lon = gpsDmsToDecimal(lonDms as [number, number, number], lonRef);
    if (lat != null && lon != null) {
      const signed = signedWgs84(lat, lon);
      out.latitude = signed.lat;
      out.longitude = signed.lon;
    }
  }

  const gpsDate = readAscii(view, gps[0x001D]);
  const gpsTime = readRationals(view, gps[0x0007], 3);
  if (gpsDate && gpsTime && gpsTime.every(Number.isFinite)) {
    const [hh, mm, ss] = gpsTime;
    const date = gpsDate.replace(/:/g, '-');
    const pad = (n: number) => String(Math.floor(n)).padStart(2, '0');
    const frac = ss % 1;
    const iso = `${date}T${pad(hh)}:${pad(mm)}:${pad(ss)}${frac ? String(frac).slice(1, 5) : ''}Z`;
    const d = new Date(iso);
    if (!isNaN(d.getTime())) out.takenAtIso = d.toISOString();
  }

  if (!out.takenAtIso) {
    const dto = readAscii(view, exif[0x9003]) || readAscii(view, ifd0[0x0132]);
    const off = readAscii(view, exif[0x9011]) || readAscii(view, exif[0x9010]);
    if (dto) {
      const iso = exifDateTimeToUtcIso(dto, off);
      if (iso) out.takenAtIso = iso;
    }
  }

  if (out.latitude == null && out.longitude == null && !out.takenAtIso) return null;
  return out;
}

export function mergeExif(
  existing: { latitude?: number | null; longitude?: number | null; taken_at?: string | null },
  exif: ImageExif | null,
): { latitude?: number; longitude?: number; taken_at?: string } {
  const lat = existing.latitude != null && Number.isFinite(Number(existing.latitude))
    ? Number(existing.latitude)
    : exif?.latitude;
  const lon = existing.longitude != null && Number.isFinite(Number(existing.longitude))
    ? Number(existing.longitude)
    : exif?.longitude;
  const taken = existing.taken_at || exif?.takenAtIso;
  if (lat != null && lon != null) {
    const signed = signedWgs84(lat, lon);
    return {
      latitude: signed.lat,
      longitude: signed.lon,
      ...(taken ? { taken_at: taken } : {}),
    };
  }
  return {
    ...(lat != null ? { latitude: lat } : {}),
    ...(lon != null ? { longitude: lon } : {}),
    ...(taken ? { taken_at: taken } : {}),
  };
}
