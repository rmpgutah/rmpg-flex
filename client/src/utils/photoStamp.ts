import { toDisplayLabel } from './formatters';
import { parseTimestamp } from './dateUtils';
import { signedWgs84 } from './imageExif';
// ============================================================
// RMPG Flex — Photo data stamp (forensic metadata burn-in)
// ============================================================
// Burns an evidentiary metadata banner onto captured photos:
//   • MM-DD-YYYY at HH:MM:SS (TMZ)
//   • GEO  LAT, LON
//   • FI. LASTNAME #BADGE — <CONTEXT>   (e.g. VEHICLE INSPECTION,
//     EVIDENCE - CASE NO. 25-0142, PERSONS / VEHICLES / PROPERTIES …)
//
// The banner is rendered onto the pixels (not just EXIF) so it survives
// re-export, screenshots, and print — the chain-of-custody requirement.
// EXIF is unreliable and easily stripped; a burned-in stamp is not.
// ============================================================

export interface PhotoStampOptions {
  officerLast?: string;
  badge?: string;
  context?: string;     // the photo-feature label
  lat?: number;
  lon?: number;
  date?: Date;
  agency?: string;      // default 'RMPG'
}

/** Short timezone abbreviation for the local zone (e.g. 'MDT'). */
export function localTimeZoneAbbr(d: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(d);
    return parts.find(p => p.type === 'timeZoneName')?.value || '';
  } catch { return ''; }
}

/** Timestamp line in America/Denver — matches FileAttachments evidence overlay. */
export function formatStampTimestampMountain(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    month: '2-digit', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZoneName: 'short',
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('month')}-${get('day')}-${get('year')} at ${get('hour')}:${get('minute')}:${get('second')} (${get('timeZoneName')})`;
}

export interface EvidenceOverlayInput {
  takenAt?: string | null;
  createdAt?: string | null;
  lat?: number | string | null;
  lon?: number | string | null;
  officerName?: string | null;
  referenceNotes?: string | null;
  agency?: string;
}

function finiteCoord(v: number | string | null | undefined): number | undefined {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Stamp lines matching the on-screen Files-tab overlay (Mountain Time). */
export function buildEvidenceOverlayLines(input: EvidenceOverlayInput): string[] {
  const iso = input.takenAt || input.createdAt;
  const lines: string[] = [];
  if (iso) lines.push(formatStampTimestampMountain(parseTimestamp(String(iso))));
  lines.push(formatGeoLine(finiteCoord(input.lat), finiteCoord(input.lon)));
  const who = input.officerName ? `FI. ${String(input.officerName).trim().toUpperCase()}` : '';
  const ctx = input.referenceNotes ? String(input.referenceNotes).trim().toUpperCase() : '';
  const line3 = [who, ctx].filter(Boolean).join('  —  ');
  if (line3) lines.push(line3);
  return lines;
}

type StampCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface StampOverlayOpts {
  minFontPx?: number;
  widthDivisor?: number;
  /** Cap font so the banner stays a small strip, not half the photo. */
  heightDivisor?: number;
}

/** Burn the banner + RMPG watermark onto an already-drawn canvas. */
export function drawStampOverlay(
  ctx: StampCtx,
  width: number,
  height: number,
  lines: string[],
  agency = 'RMPG',
  opts?: StampOverlayOpts,
): void {
  if (width < 8 || height < 8) return;
  const W = width, H = height;
  let fontPx = Math.min(
    Math.max(opts?.minFontPx ?? 13, Math.round(W / (opts?.widthDivisor ?? 48))),
    Math.max(10, Math.round(H / (opts?.heightDivisor ?? 22))),
  );
  const measure = (px: number) => {
    ctx.font = `bold ${px}px monospace`;
    return Math.max(0, ...lines.map((l) => ctx.measureText(l).width));
  };
  while (fontPx > 10 && measure(fontPx) > W - Math.round(fontPx * 1.2)) fontPx -= 1;

  const pad = Math.round(fontPx * 0.55);
  const lineH = Math.round(fontPx * 1.28);
  let bannerH = Math.max(lineH + pad * 2, lines.length * lineH + pad * 2);
  const maxBanner = Math.round(H * 0.18);
  while (bannerH > maxBanner && fontPx > 10) {
    fontPx -= 1;
    bannerH = Math.max(
      Math.round(fontPx * 1.28) + Math.round(fontPx * 0.55) * 2,
      lines.length * Math.round(fontPx * 1.28) + Math.round(fontPx * 0.55) * 2,
    );
  }
  const pad2 = Math.round(fontPx * 0.55);
  const lineH2 = Math.round(fontPx * 1.28);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(0, H - bannerH, W, bannerH);
  ctx.fillStyle = '#d4a017';
  ctx.fillRect(0, H - bannerH, W, Math.max(2, Math.round(fontPx / 8)));

  ctx.font = `bold ${fontPx}px monospace`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  let y = H - bannerH + pad2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillStyle = i === 0 ? '#ffd34d' : '#f4f4f4';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = Math.round(fontPx / 6);
    ctx.fillText(lines[i], pad2, y);
    ctx.shadowBlur = 0;
    y += lineH2;
  }
  const label = (agency || 'RMPG').toUpperCase();
  ctx.font = `bold ${Math.round(fontPx * 0.9)}px monospace`;
  ctx.fillStyle = 'rgba(212, 160, 23, 0.85)';
  ctx.textAlign = 'right';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = Math.round(fontPx / 5);
  ctx.fillText(label, W - pad2, pad2);
  ctx.shadowBlur = 0;
  ctx.textAlign = 'left';
}
/** Timestamp line in America/Denver — never the device zone (UTC hosts print 6h off). */
export function formatStampTimestamp(d: Date = new Date()): string {
  return formatStampTimestampMountain(d);
}

/** Format the geo line, or '' when no fix. */
export function formatGeoLine(lat?: number, lon?: number): string {
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return 'GEO  UNAVAILABLE';
  const signed = signedWgs84(lat, lon);
  return `GEO  ${signed.lat.toFixed(6)}, ${signed.lon.toFixed(6)}`;
}

/** Officer + context line ("FI. ZAMORA #D-101 — VEHICLE INSPECTION"). */
export function formatOfficerLine(opts: PhotoStampOptions): string {
  const who = [opts.officerLast ? `FI. ${opts.officerLast.toUpperCase()}` : '', opts.badge ? `#${opts.badge}` : '']
    .filter(Boolean).join(' ');
  return [who, opts.context ? opts.context.toUpperCase() : ''].filter(Boolean).join('  —  ');
}

/** Map a record entityType to a default photo-context label. */
export function contextLabelForEntity(entityType: string, caseNumber?: string): string {
  const t = (entityType || '').toLowerCase();
  if (/evidence/.test(t)) return caseNumber ? `EVIDENCE - CASE NO. ${caseNumber}` : 'EVIDENCE';
  if (/person/.test(t)) return 'PERSONS RECORD';
  if (/vehicle/.test(t)) return 'VEHICLES RECORD';
  if (/propert/.test(t)) return 'PROPERTIES RECORD';
  if (/incident/.test(t)) return caseNumber ? `INCIDENT - ${caseNumber}` : 'INCIDENT';
  if (/case/.test(t)) return caseNumber ? `CASE NO. ${caseNumber}` : 'CASE FILE';
  if (/inspection|fleet/.test(t)) return 'VEHICLE INSPECTION';
  if (/serve/.test(t)) return 'SERVICE OF PROCESS';
  if (/citation/.test(t)) return 'CITATION';
  if (/warrant/.test(t)) return 'WARRANT SERVICE';
  return entityType ? toDisplayLabel(entityType).toUpperCase() + ' RECORD' : 'FIELD PHOTO';
}

/** The three stamp lines as plain strings (for tests / non-canvas use). */
export function buildStampLines(opts: PhotoStampOptions): string[] {
  return [
    formatStampTimestamp(opts.date),
    formatGeoLine(opts.lat, opts.lon),
    formatOfficerLine(opts),
  ].filter(Boolean);
}

/** Best-effort one-shot geolocation with timeout (resolves null on any failure). */
export function getGeoFix(timeoutMs = 6000): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    let done = false;
    const finish = (v: { lat: number; lon: number } | null) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => finish(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(timer); finish({ lat: pos.coords.latitude, lon: pos.coords.longitude }); },
      () => { clearTimeout(timer); finish(null); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

/**
 * Burn the metadata banner onto an image file. Returns a new JPEG File.
 * On any failure (non-image, canvas unavailable, decode error) the ORIGINAL
 * file is returned unchanged — stamping must never block an upload.
 */
export async function stampPhoto(file: File, opts: PhotoStampOptions): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (typeof document === 'undefined') return file;

  try {
    const bitmap = await loadImage(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(bitmap, 0, 0);
    drawStampOverlay(ctx, canvas.width, canvas.height, buildStampLines(opts), opts.agency);

    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
    if (!blob) return file;
    const stampedName = file.name.replace(/(\.[^.]+)?$/, '_stamped.jpg');
    return new File([blob], stampedName, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}
