import { Hono } from 'hono';
import type { R2Bucket, R2Object, D1Database } from '@cloudflare/workers-types';
import { log } from '../utils/logger';
import { getR2Range, rangeNotSatisfiableInit } from '../utils/byteRange';

// ─── Helpers exported for use by src/index.ts (non-API paths) ──

/**
 * Sanitize a filename for use in Content-Disposition headers.
 * Strips control characters, escapes quotes, and truncates to prevent
 * header injection attacks.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\x00-\x1f\x7f]/g, '_')  // Strip control characters
    .replace(/"/g, '_')                   // Escape double quotes
    .replace(/\\/g, '/')                  // Normalize backslashes
    .slice(0, 200);                       // Truncate to prevent header overflow
}

/**
 * Validate that an R2 key doesn't contain path traversal sequences.
 * Returns the sanitized key or null if traversal is detected.
 */
function safeR2Key(key: string): string | null {
  if (key.includes('..') || key.includes('\0')) return null;
  return key;
}

function downloadMime(filename: string): string {
  if (filename.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (filename.endsWith('.exe')) return 'application/x-msdownload';
  if (filename.endsWith('.apk')) return 'application/vnd.android.package-archive';
  if (filename.endsWith('.zip')) return 'application/zip';
  if (filename.endsWith('.tar.gz') || filename.endsWith('.tgz')) return 'application/gzip';
  if (filename.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (filename.endsWith('.yml') || filename.endsWith('.yaml')) return 'text/yaml';
  return 'application/octet-stream';
}

/**
 * Serve a file out of the DOWNLOADS bucket.
 *
 * STREAMS the object body instead of buffering it. The previous version called
 * `obj.arrayBuffer()`, which pulls the whole file into Worker memory — fine for
 * a 100 MB installer, fatal for the 250 MB OS image, since a Worker has a
 * 128 MB memory ceiling. Returning R2's ReadableStream hands the bytes straight
 * through with effectively no memory cost regardless of file size.
 *
 * Range requests are honoured so a 250 MB download over field Wi-Fi can be
 * resumed rather than restarted, which is exactly the connection these OS
 * images get fetched over.
 */
export async function serveDownloadFile(bucket: R2Bucket, filename: string, c: any) {
  // Path traversal guard: reject keys with .. or null bytes
  const safeKey = safeR2Key(filename);
  if (!safeKey) {
    return c.json({ error: 'Invalid filename' }, 400);
  }

  const rangeHeader = c.req.header('range');

  // Parse a single "bytes=start-end" range. Multi-range requests are rare from
  // browsers and download managers, so anything unparseable falls back to a
  // full-body response rather than failing the download outright.
  let range: { offset: number; length?: number } | undefined;
  let rangeStart = 0;
  if (rangeHeader) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (m && m[1]) {
      rangeStart = parseInt(m[1], 10);
      range = { offset: rangeStart };
      if (m[2]) range.length = parseInt(m[2], 10) - rangeStart + 1;
    }
  }

  // getR2Range() instead of a bare get(): R2 THROWS on an unsatisfiable range
  // (start > end, or start past EOF), which would surface as a 500 mid-download
  // instead of the 416 a download manager knows how to recover from.
  const got = await getR2Range(bucket, filename, range);
  if (got.kind === 'missing') return c.json({ error: 'File not found' }, 404);
  if (got.kind === 'unsatisfiable') {
    const init = rangeNotSatisfiableInit(got.total);
    return c.json(init.body, init.status, init.headers);
  }
  const obj = got.obj;

  const basename = filename.includes('/') ? filename.split('/').pop()! : filename;
  const safeName = sanitizeFilename(basename);
  const mime = downloadMime(basename);
  const headers: Record<string, string> = {
    'Content-Type': mime,
    // Lets clients resume instead of starting a large download over.
    'Accept-Ranges': 'bytes',
    // Immutable: published artifacts are never rewritten in place — a new
    // release gets a new filename — so caching aggressively is safe and keeps
    // repeat fleet downloads off the origin.
    'Cache-Control': 'public, max-age=31536000, immutable',
  };

  // Anything that is not plain text is a file to save, not something to render.
  // Without this a browser may display a .txt or, worse, sniff and render an
  // archive as a page.
  if (!basename.endsWith('.txt')) {
    headers['Content-Disposition'] = `attachment; filename="${safeName}"`;
  }

  if (range) {
    const total = obj.size;
    const end = range.length ? rangeStart + range.length - 1 : total - 1;
    headers['Content-Range'] = `bytes ${rangeStart}-${end}/${total}`;
    headers['Content-Length'] = String(end - rangeStart + 1);
    return new Response(obj.body as any, { status: 206, headers });
  }

  headers['Content-Length'] = String(obj.size);
  return new Response(obj.body as any, { status: 200, headers });
}

export async function serveDownloadPage(bucket: R2Bucket, c: any) {
  const obj = await bucket.get('index.html');
  if (obj) {
    const data = await obj.arrayBuffer();
    c.header('Content-Type', 'text/html; charset=utf-8');
    return c.body(data);
  }
  c.header('Content-Type', 'text/html; charset=utf-8');
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>RMPG Flex — Downloads</title>
<style>
  body{background:#0a0a0a;color:#d4a017;font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#141414;border:1px solid #222;padding:2rem;max-width:480px;text-align:center}
  h1{font-size:1.2rem;margin:0 0 1rem}p{color:#888;font-size:.9rem}
  a{color:#d4a017}
</style></head>
<body><div class="card">
  <h1>RMPG FLEX — DOWNLOADS</h1>
  <p>The download page is not yet available. Contact your administrator for installer access.</p>
  <p><a href="/">Return to application</a></p>
</div></body></html>`, 404);
}

export async function serveRmpgSeal(bucket: R2Bucket, c: any) {
  const obj = await bucket.get('rmpg-seal.png');
  if (obj) {
    const data = await obj.arrayBuffer();
    c.header('Content-Type', 'image/png');
    return c.body(data);
  }
  return c.text('Not Found', 404);
}

function extractVersion(name: string): string | null {
  const m = name.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

function verLt(a: string, b: string): boolean {
  const [a1, a2, a3] = a.split('.').map(Number);
  const [b1, b2, b3] = b.split('.').map(Number);
  if (a1 !== b1) return a1 < b1;
  if (a2 !== b2) return a2 < b2;
  return a3 < b3;
}

export async function serveUpdatesYaml(bucket: R2Bucket, platform: 'win' | 'mac', c: any) {
  try {
    const list = await bucket.list({ prefix: 'updates/' });
    // CI publishes manifests and installers under the updates/ prefix.
    const manifestName = platform === 'win' ? 'updates/latest.yml' : 'updates/latest-mac.yml';

    const existing = list.objects.find((o: R2Object) => o.key === manifestName);
    if (existing) {
      const obj = await bucket.get(manifestName);
      if (obj) {
        const data = await obj.arrayBuffer();
        c.header('Content-Type', 'text/yaml; charset=utf-8');
        c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
        return c.body(data);
      }
    }

    const ext = platform === 'win' ? '.exe' : '.dmg';
    let best: R2Object | undefined;
    for (const o of list.objects) {
      if (o.key.endsWith(ext) && !o.key.includes('blockmap')) {
        if (!best || verLt(extractVersion(best.key) || '0', extractVersion(o.key) || '0')) {
          best = o;
        }
      }
    }

    if (!best) return c.text(`No ${platform} installer available`, 404);
    const v = extractVersion(best.key) || '0.0.0';

    const yaml = [
      `version: ${v}`,
      `files:`,
      `  - url: ${best.key}`,
      `    sha512: ''`,
      `    size: ${best.size}`,
      `path: ${best.key}`,
      `sha512: ''`,
      `releaseDate: '${best.uploaded.toISOString()}'`,
    ].join('\n');

    c.header('Content-Type', 'text/yaml; charset=utf-8');
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    return c.text(yaml);
  } catch (err) {
    log.error(`${platform} YAML generation failed`, { platform }, err as Error);
    return c.text('Failed to generate manifest', 500);
  }
}

// ─── API Hono router (mounted at /api via route registry) ──

interface InstallerMeta {
  filename: string;
  version: string;
  size: string;
  bytes: number;
  releaseDate: string;
  /**
   * Absolute URL for this artifact.
   *
   * Built from the incoming request's origin rather than a constant. The client
   * previously held `CF_WORKER_DIRECT_BASE = 'https://api.rmpgutah.us'` — a
   * build-time constant encoding a deployment-time fact, which could only
   * change with a full client rebuild and could go stale inside a cached
   * bundle. A request-derived origin cannot drift, and is automatically correct
   * in dev (localhost:8787) with no environment branch.
   */
  url: string;
  /**
   * Hex-encoded SHA-256, read from R2 customMetadata.
   *
   * Optional because artifacts published before scripts/publish-download.mjs
   * existed have no checksum. Consumers must hide the field rather than render
   * `undefined`.
   *
   * Deliberately NOT derived from the R2 etag: a multipart object's etag is the
   * hash of the concatenated per-part MD5 sums plus "-<partCount>", so it is
   * not a content hash at all once publishing uses multipart.
   */
  sha256?: string;
}

interface InstallerInfo {
  win?: InstallerMeta;
  mac?: InstallerMeta;
  android?: InstallerMeta;
  os?: InstallerMeta;
}

export interface ReleaseNote {
  version: string;
  releaseDate: string;
  notes: string[];
}

export function parseReleaseNoteRow(row: { version: string; release_date: string; notes: string }): ReleaseNote {
  return {
    version: row.version,
    releaseDate: row.release_date,
    notes: row.notes.split('\n').map((line) => line.trim()).filter(Boolean),
  };
}

/**
 * Human-readable size.
 *
 * Binary units (1024-based) labelled KB/MB/GB, which is exactly what Windows
 * Explorer shows — and Windows is where people actually check a downloaded
 * file against what this page advertised. macOS Finder uses decimal units and
 * will report a larger number for the same file (a 247,872,459-byte download
 * is "236 MB" on Windows and "247.9 MB" on macOS); that is a units convention,
 * not a corrupt or truncated download. The exact byte count is published
 * alongside this string so the comparison can be made unambiguously.
 *
 * The GB tier is not cosmetic: without it the 2 GB desktop image renders as
 * "2048.0 MB", which reads like a mistake.
 */
function fmtBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/**
 * Every object in the bucket, following the cursor.
 *
 * `include: ['customMetadata']` is REQUIRED to read the sha256 written at
 * publish time. Our compatibility_date (2026-05-01) is past the 2022-08-04
 * cutoff, so a bare list() omits customMetadata and the checksum silently
 * reads undefined — nothing appears broken.
 *
 * Requesting metadata also makes R2 return FEWER objects per page to stay under
 * a response-size cap, so the cursor must be followed. Never compare
 * objects.length against a limit — use `truncated`.
 */
async function listAllObjects(bucket: R2Bucket): Promise<R2Object[]> {
  const out: R2Object[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await bucket.list({ include: ['customMetadata'], cursor });
    out.push(...page.objects);
    if (!page.truncated) return out;
    cursor = page.cursor;
  }
}

/**
 * Build an InstallerMeta from an R2 object.
 *
 * Four call sites construct metas (the main scan plus the .zip overrides for
 * Windows, Android and the OS image); they all route through here so `url` and
 * `sha256` cannot be forgotten in one of them.
 */
function toMeta(obj: R2Object, origin: string, versionFallback?: string): InstallerMeta {
  const version = extractVersion(obj.key) || versionFallback || '0.0.0';
  const sha256 = obj.customMetadata?.sha256;
  return {
    filename: obj.key,
    version,
    size: fmtBytes(obj.size),
    bytes: obj.size,
    releaseDate: obj.uploaded.toISOString(),
    url: `${origin}/downloads/${encodeURIComponent(obj.key)}`,
    ...(sha256 ? { sha256 } : {}),
  };
}

export async function scanInstallers(bucket: R2Bucket, origin: string): Promise<InstallerInfo> {
  const info: InstallerInfo = {};
  const objects = await listAllObjects(bucket);

  for (const obj of objects) {
    const name = obj.key;
    const version = extractVersion(name) || '0.0.0';
    const meta = toMeta(obj, origin);

    if (name.endsWith('.dmg') && !name.includes('blockmap')) {
      if (!info.mac || verLt(info.mac.version, version)) info.mac = meta;
    } else if (name.endsWith('.exe') && !name.includes('blockmap')) {
      if (!info.win || verLt(info.win.version, version)) info.win = meta;
    } else if (name.endsWith('.apk')) {
      if (!info.android || verLt(info.android.version, version)) info.android = meta;
    } else if ((name.endsWith('.tar.gz') || name.endsWith('.zip')) && name.startsWith('kiosk-linux-os-')) {
      // .zip is accepted alongside .tar.gz because the OS image is installed
      // from a Windows laptop far more often than from Linux, and Windows
      // cannot open a .tar.gz by double-clicking. The .zip override below
      // prefers it when both are present.
      if (!info.os || verLt(info.os.version, version)) info.os = meta;
    }
  }

  // Override win/android to serve .zip instead of raw .exe/.apk
  // to bypass Chrome SmartScreen / Safe Browsing download blocks.
  if (info.win) {
    const zipName = info.win.filename.replace(/\.exe$/, '.zip');
    const zipObj = objects.find((o) => o.key === zipName);
    if (zipObj) info.win = toMeta(zipObj, origin, info.win.version);
  }

  if (info.android) {
    const zipName = info.android.filename.replace(/\.apk$/, '.zip');
    const zipObj = objects.find((o) => o.key === zipName);
    if (zipObj) info.android = toMeta(zipObj, origin, info.android.version);
  }

  // Prefer .zip for the OS image when both formats exist. These images are
  // written to a USB stick from whatever laptop is on hand — in practice a
  // Windows machine — and Windows cannot open a .tar.gz by double-clicking,
  // which turned the very first install step into a blocker. A .zip opens in
  // Explorer natively. The .tar.gz is kept in the bucket for Linux/macOS.
  if (info.os && info.os.filename.endsWith('.tar.gz')) {
    const zipName = info.os.filename.replace(/\.tar\.gz$/, '.zip');
    const zipObj = objects.find((o) => o.key === zipName);
    if (zipObj) info.os = toMeta(zipObj, origin, info.os.version);
  }

  return info;
}

const downloads = new Hono<{ Bindings: { DOWNLOADS: R2Bucket; DB: D1Database } }>();

// GET /api/downloads/info — returns installer metadata
downloads.get('/downloads/info', async (c) => {
  try {
    const origin = new URL(c.req.url).origin;
    return c.json(await scanInstallers(c.env.DOWNLOADS, origin));
  } catch (err) {
    log.error('downloads/info failed', { route: '/api/downloads/info' }, err as Error);
    return c.json({ error: 'Failed to read downloads' }, 500);
  }
});

// GET /api/downloads/check — version check for electron-updater
downloads.get('/downloads/check', async (c) => {
  try {
    const current = c.req.query('currentVersion') || '0.0.0';
    const platform = c.req.query('platform') || 'win32';

    const list = await c.env.DOWNLOADS.list();
    let target: { filename: string; version: string; bytes: number; releaseDate: string } | undefined;

    for (const obj of list.objects) {
      const name = obj.key;
      const version = extractVersion(name) || '0.0.0';
      if (platform === 'darwin' && name.endsWith('.dmg') && !name.includes('blockmap')) {
        if (!target || verLt(target.version, version)) target = { filename: name, version, bytes: obj.size, releaseDate: obj.uploaded.toISOString() };
      } else if (platform === 'android' && name.endsWith('.apk')) {
        if (!target || verLt(target.version, version)) target = { filename: name, version, bytes: obj.size, releaseDate: obj.uploaded.toISOString() };
      } else if (name.endsWith('.exe') && !name.includes('blockmap')) {
        if (!target || verLt(target.version, version)) target = { filename: name, version, bytes: obj.size, releaseDate: obj.uploaded.toISOString() };
      }
    }

    if (!target) return c.json({ updateAvailable: false, currentVersion: current, latestVersion: current, mandatory: false });

    const updateAvailable = verLt(current, target.version);
    return c.json({
      updateAvailable,
      currentVersion: current,
      latestVersion: target.version,
      mandatory: false,
      releaseDate: target.releaseDate,
      downloadUrl: `https://api.rmpgutah.us/downloads/${target.filename}`,
      downloadSize: fmtBytes(target.bytes),
      downloadBytes: target.bytes,
    });
  } catch (err) {
    log.error('downloads/check failed', { route: '/api/downloads/check' }, err as Error);
    return c.json({ error: 'Check failed' }, 500);
  }
});

// GET /api/downloads/changelog — public release notes for the Downloads page
downloads.get('/downloads/changelog', async (c) => {
  try {
    const result = await c.env.DB.prepare(
      'SELECT version, release_date, notes FROM download_releases ORDER BY release_date DESC, id DESC LIMIT 10'
    ).all();
    const rows = result.results as unknown as Array<{ version: string; release_date: string; notes: string }>;
    return c.json(rows.map(parseReleaseNoteRow));
  } catch (err) {
    log.error('downloads/changelog failed', { route: '/api/downloads/changelog' }, err as Error);
    return c.json({ error: 'Failed to read changelog' }, 500);
  }
});

export default downloads;

// ─── /updates router (mounted bare, no /api prefix) ──
// electron-updater's generic provider (desktop/updater.js) hits
// <feedUrl>/latest.yml or /latest-mac.yml directly, then downloads the
// installer file the manifest references relative to that same base URL —
// both must be unauthenticated and live at /updates/*, not /api/updates/*.
// serveUpdatesYaml/serveDownloadFile were written for this but never
// mounted anywhere, so the whole auto-update feed 404'd since it was
// introduced — confirmed live 2026-07-22 investigating why a real R2
// upload (verified via `wrangler r2 object put`) still 404'd from the
// Worker.
export const updates = new Hono<{ Bindings: { DOWNLOADS: R2Bucket } }>();

updates.get('/latest.yml', (c) => serveUpdatesYaml(c.env.DOWNLOADS, 'win', c));
updates.get('/latest-mac.yml', (c) => serveUpdatesYaml(c.env.DOWNLOADS, 'mac', c));
updates.get('/:filename', (c) => {
  const filename = c.req.param('filename');
  if (filename.includes('..') || filename.includes('\0')) {
    return c.json({ error: 'Invalid filename' }, 400);
  }
  return serveDownloadFile(c.env.DOWNLOADS, `updates/${filename}`, c);
});

// ─── /downloads/:filename — the actual file downloads ────────────────────────
//
// THIS IS WHAT EVERY DOWNLOAD BUTTON ON THE PUBLIC PAGE POINTS AT, and it did
// not exist until 2026-07-25. The effect was that every download — Windows,
// macOS, Android and the OS image alike — returned an 11,630-byte HTML file:
// the SPA's index.html, saved under the artifact's filename. Reported from the
// field as "files download at 11.5 kb".
//
// Two independent faults produced it, which is why it survived so long:
//
//   1. No route. serveDownloadFile() existed and was wired ONLY to /updates/*
//      for electron-updater. Nothing served /downloads/*.
//   2. client/public/_redirects tried to paper over that with
//        /downloads/*  https://api.rmpgutah.us/downloads/:splat  200
//      but Cloudflare Pages _redirects supports only redirect statuses
//      (301/302/303/307/308) — status-200 "rewrite to another origin" is a
//      Netlify feature that Pages does not implement. The rule is silently
//      ignored, so the request fell through to the `/*  /index.html  200` SPA
//      catch-all and returned the page with HTTP 200. A 200 plus a plausible
//      filename is why browsers saved it without complaint and nothing looked
//      broken until someone checked the file size.
//
// Mounted bare (no /api prefix) so the existing public URLs keep working, and
// public because installers must be fetchable before anyone can sign in.
export const downloadFiles = new Hono<{ Bindings: { DOWNLOADS: R2Bucket } }>();

downloadFiles.get('/:filename', (c) => {
  const filename = c.req.param('filename');
  if (filename.includes('..') || filename.includes('\0')) {
    return c.json({ error: 'Invalid filename' }, 400);
  }
  return serveDownloadFile(c.env.DOWNLOADS, filename, c);
});
