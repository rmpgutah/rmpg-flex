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

/** Format the timestamp line exactly as the stamp shows it. */
export function formatStampTimestamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const tz = localTimeZoneAbbr(d);
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}-${d.getFullYear()} at ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${tz ? ` (${tz})` : ''}`;
}

/** Format the geo line, or '' when no fix. */
export function formatGeoLine(lat?: number, lon?: number): string {
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return 'GEO  UNAVAILABLE';
  return `GEO  ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
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
  return entityType ? entityType.toUpperCase().replace(/_/g, ' ') + ' RECORD' : 'FIELD PHOTO';
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

    const lines = buildStampLines(opts);
    const W = canvas.width, H = canvas.height;
    const fontPx = Math.max(13, Math.round(W / 48));
    const pad = Math.round(fontPx * 0.6);
    const lineH = Math.round(fontPx * 1.35);
    const bannerH = lines.length * lineH + pad * 2;

    // translucent bottom banner
    ctx.fillStyle = 'rgba(0,0,0,0.58)';
    ctx.fillRect(0, H - bannerH, W, bannerH);
    // gold top rule (RMPG brand) without violating any UI rule — this is image content
    ctx.fillStyle = '#d4a017';
    ctx.fillRect(0, H - bannerH, W, Math.max(2, Math.round(fontPx / 8)));

    ctx.font = `bold ${fontPx}px monospace`;
    ctx.textBaseline = 'top';
    let y = H - bannerH + pad;
    for (let i = 0; i < lines.length; i++) {
      // line 1 (timestamp) gold, rest white for legibility
      ctx.fillStyle = i === 0 ? '#ffd34d' : '#f4f4f4';
      // subtle shadow for contrast over bright photos
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = Math.round(fontPx / 6);
      ctx.fillText(lines[i], pad, y);
      ctx.shadowBlur = 0;
      y += lineH;
    }
    // agency watermark, top-right
    const agency = (opts.agency || 'RMPG').toUpperCase();
    ctx.font = `bold ${Math.round(fontPx * 0.9)}px monospace`;
    ctx.fillStyle = 'rgba(212,160,23,0.85)';
    ctx.textAlign = 'right';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = Math.round(fontPx / 5);
    ctx.fillText(agency, W - pad, pad);
    ctx.shadowBlur = 0;
    ctx.textAlign = 'left';

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
