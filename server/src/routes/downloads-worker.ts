// ============================================================
// RMPG Flex — Downloads (Workers / Hono Port)
// Serves installer files from R2 DOWNLOADS bucket, exposes
// /api/downloads/info metadata and /api/updates/check for
// electron-updater / auto-update compatibility.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';

const ALLOWED_EXTENSIONS = new Set(['.dmg', '.exe', '.blockmap', '.yml', '.yaml', '.zip', '.apk']);

function getMimeType(filename: string): string {
  if (filename.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (filename.endsWith('.exe')) return 'application/x-msdownload';
  if (filename.endsWith('.apk')) return 'application/vnd.android.package-archive';
  if (filename.endsWith('.yml') || filename.endsWith('.yaml')) return 'text/yaml; charset=utf-8';
  if (filename.endsWith('.blockmap')) return 'application/octet-stream';
  return 'application/octet-stream';
}

function extractVersion(filename: string): string | null {
  const match = filename.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function isVersionLessThan(a: string, b: string): boolean {
  const [a1, a2, a3] = a.split('.').map(Number);
  const [b1, b2, b3] = b.split('.').map(Number);
  if (a1 !== b1) return a1 < b1;
  if (a2 !== b2) return a2 < b2;
  return a3 < b3;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

interface InstallerMeta {
  filename: string;
  version: string;
  size: string;
  bytes: number;
  releaseDate?: string;
}

/** Scan R2 DOWNLOADS bucket for installer files and return metadata for the latest of each platform. */
async function getInstallerInfo(env: Env): Promise<{
  mac?: InstallerMeta;
  win?: InstallerMeta;
  android?: InstallerMeta;
}> {
  const result: { mac?: InstallerMeta; win?: InstallerMeta; android?: InstallerMeta } = {};

  try {
    const objects = await env.DOWNLOADS.list();
    for (const obj of objects.objects) {
      const version = extractVersion(obj.key);
      const meta: InstallerMeta = {
        filename: obj.key,
        version: version || '0.0.0',
        size: formatBytes(obj.size),
        bytes: obj.size,
        releaseDate: obj.uploaded.toISOString(),
      };

      if (obj.key.endsWith('.dmg') && !obj.key.includes('blockmap')) {
        if (!result.mac || isVersionLessThan(result.mac.version, meta.version)) {
          result.mac = meta;
        }
      } else if (obj.key.endsWith('.exe') && !obj.key.includes('blockmap')) {
        if (!result.win || isVersionLessThan(result.win.version, meta.version)) {
          result.win = meta;
        }
      } else if (obj.key.endsWith('.apk')) {
        if (!result.android || isVersionLessThan(result.android.version, meta.version)) {
          result.android = meta;
        }
      }
    }
  } catch (err: any) {
    console.error('DOWNLOADS bucket list error:', err?.message || err);
  }

  return result;
}

/** Compute SHA-512 (base64) for an R2 object. */
async function computeSha512(env: Env, filename: string): Promise<string | null> {
  try {
    const obj = await env.DOWNLOADS.get(filename);
    if (!obj) return null;
    const data = await obj.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-512', data);
    const hashArray = new Uint8Array(hashBuffer);
    let binary = '';
    for (let i = 0; i < hashArray.byteLength; i++) {
      binary += String.fromCharCode(hashArray[i]);
    }
    return btoa(binary);
  } catch {
    return null;
  }
}

export function mountDownloadRoutes(app: Hono<{ Bindings: Env; Variables: { user: any } }>): void {
  // ─── Public API: installer metadata ───────────────────
  app.get('/api/downloads/info', async (c) => {
    try {
      const info = await getInstallerInfo(c.env);
      return c.json(info);
    } catch (err: any) {
      console.error('Downloads info error:', err?.message || err);
      return c.json({ error: 'Failed to read download info' }, 500);
    }
  });

  // ─── Update check for auto-updaters ───────────────────
  app.get('/api/updates/check', async (c) => {
    try {
      const currentVersion = c.req.query('currentVersion') || '0.0.0';
      const platform = c.req.query('platform') || 'win32';

      const info = await getInstallerInfo(c.env);
      const installer = platform === 'darwin' ? info.mac : platform === 'android' ? info.android : info.win;

      if (!installer) {
        return c.json({
          updateAvailable: false,
          currentVersion,
          latestVersion: currentVersion,
          mandatory: false,
        });
      }

      const latestVersion = installer.version;
      const updateAvailable = isVersionLessThan(currentVersion, latestVersion);

      return c.json({
        updateAvailable,
        currentVersion,
        latestVersion,
        mandatory: false,
        releaseDate: installer.releaseDate,
        downloadUrl: `/downloads/${encodeURIComponent(installer.filename)}`,
        downloadSize: installer.size,
        downloadBytes: installer.bytes,
      });
    } catch (err: any) {
      console.error('Update check error:', err?.message || err);
      return c.json({ error: 'Failed to check for updates' }, 500);
    }
  });

  // ─── Redirect /downloads/ (trailing slash) to /downloads ──
  app.get('/downloads/', (c) => {
    return c.redirect('/downloads', 308);
  });

  // ─── Windows update YAML manifest ────────────────────
  app.get('/updates/latest.yml', async (c) => {
    try {
      const info = await getInstallerInfo(c.env);
      if (!info.win) {
        return c.text('No Windows installer available', 404);
      }

      const sha512 = await computeSha512(c.env, info.win.filename);
      if (!sha512) {
        return c.text('Failed to compute SHA-512', 500);
      }

      const releaseDate = info.win.releaseDate || new Date().toISOString();
      const yaml = [
        `version: ${info.win.version}`,
        `files:`,
        `  - url: ${info.win.filename}`,
        `    sha512: ${sha512}`,
        `    size: ${info.win.bytes}`,
        `path: ${info.win.filename}`,
        `sha512: ${sha512}`,
        `releaseDate: '${releaseDate}'`,
      ].join('\n');

      return c.body(yaml, 200, {
        'Content-Type': 'text/yaml; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
    } catch (err: any) {
      console.error('latest.yml generation error:', err?.message || err);
      return c.text('Failed to generate update manifest', 500);
    }
  });

  // ─── macOS update YAML manifest ─────────────────────
  app.get('/updates/latest-mac.yml', async (c) => {
    try {
      const info = await getInstallerInfo(c.env);
      if (!info.mac) {
        return c.text('No macOS installer available', 404);
      }

      const sha512 = await computeSha512(c.env, info.mac.filename);
      if (!sha512) {
        return c.text('Failed to compute SHA-512', 500);
      }

      const releaseDate = info.mac.releaseDate || new Date().toISOString();
      const yaml = [
        `version: ${info.mac.version}`,
        `files:`,
        `  - url: ${info.mac.filename}`,
        `    sha512: ${sha512}`,
        `    size: ${info.mac.bytes}`,
        `path: ${info.mac.filename}`,
        `sha512: ${sha512}`,
        `releaseDate: '${releaseDate}'`,
      ].join('\n');

      return c.body(yaml, 200, {
        'Content-Type': 'text/yaml; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
    } catch (err: any) {
      console.error('latest-mac.yml generation error:', err?.message || err);
      return c.text('Failed to generate update manifest', 500);
    }
  });

  // ─── Serve installer files from R2 ───────────────────
  const serveInstallerFile = async (c: any) => {
    const filename = c.req.param('filename') as string;

    const ext = filename.split('.').pop()?.toLowerCase();
    if (!ext || !ALLOWED_EXTENSIONS.has('.' + ext)) {
      return c.json({ error: 'Forbidden file type' }, 403);
    }

    const safeName = filename.split('/').pop() || filename;
    if (!safeName) {
      return c.json({ error: 'Invalid filename' }, 400);
    }

    try {
      const obj = await c.env.DOWNLOADS.get(safeName);
      if (!obj) {
        return c.json({ error: 'File not found' }, 404);
      }

      const data = await obj.arrayBuffer();
      const mimeType = getMimeType(safeName);

      const headers: Record<string, string> = {
        'Content-Type': mimeType,
        'Content-Length': String(obj.size),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=3600',
      };

      if (safeName.endsWith('.dmg') || safeName.endsWith('.exe') || safeName.endsWith('.apk')) {
        headers['Content-Disposition'] = `attachment; filename="${safeName}"`;
      }

      return c.body(data, 200, headers);
    } catch (err: any) {
      console.error('Download file error:', err?.message || err);
      return c.json({ error: 'Download failed' }, 500);
    }
  };

  app.get('/downloads/:filename', serveInstallerFile);

  // ─── Also serve via API path for electron-updater compat ──
  app.get('/updates/:filename', serveInstallerFile);
}
