import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { publicEndpointRateLimit } from '../middleware/rateLimiter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();
router.use(publicEndpointRateLimit);

const DOWNLOADS_DIR = path.resolve(__dirname, '../../downloads');

// ─── SHA-512 Hash Cache ─────────────────────────────────────
// Keyed by "filename:mtimeMs" to auto-invalidate when files change
const hashCache = new Map<string, string>();

/** Compute SHA-512 hash of a file (base64 encoded). Cached by filename + mtime. */
function computeSha512Sync(filePath: string): string {
  const stat = fs.statSync(filePath);
  const cacheKey = `${path.basename(filePath)}:${stat.mtimeMs}`;

  if (hashCache.has(cacheKey)) {
    return hashCache.get(cacheKey)!;
  }

  console.log(`[UPDATES] Computing SHA-512 for ${path.basename(filePath)} (${formatBytes(stat.size)})...`);
  const hash = crypto.createHash('sha512');
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  const result = hash.digest('base64');

  // Cap cache size to prevent unbounded memory growth
  if (hashCache.size >= 100) {
    const firstKey = hashCache.keys().next().value;
    if (firstKey) hashCache.delete(firstKey);
  }
  hashCache.set(cacheKey, result);
  console.log(`[UPDATES] SHA-512 cached for ${path.basename(filePath)}`);
  return result;
}

/** Extract semver version from an installer filename. */
function extractVersion(filename: string): string | null {
  const match = filename.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

/** Compare two semver strings. Returns true if a < b. */
function isVersionLessThan(a: string, b: string): boolean {
  const ap = a.split('.').map(Number);
  const bp = b.split('.').map(Number);
  const a1 = ap[0] || 0, a2 = ap[1] || 0, a3 = ap[2] || 0;
  const b1 = bp[0] || 0, b2 = bp[1] || 0, b3 = bp[2] || 0;
  if (a1 !== b1) return a1 < b1;
  if (a2 !== b2) return a2 < b2;
  return a3 < b3;
}

/** Escape a value for safe YAML interpolation. */
function escapeYaml(val: string | number): string {
  const s = String(val);
  if (/[:\n'"{}[\]#&*!|>%@`]/.test(s)) return `'${s.replace(/'/g, "''")}'`;
  return s;
}

/** Format bytes into human-readable size. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ─── Installer Info Types ────────────────────────────────────
interface InstallerMeta {
  filename: string;
  version: string;
  size: string;
  bytes: number;
  sha512?: string;
  releaseDate?: string;
}

/** Scan downloads directory for available installers with full metadata.
 *  Uses async fs operations to avoid blocking the event loop. */
async function getInstallerInfoAsync(): Promise<{
  mac?: InstallerMeta;
  win?: InstallerMeta;
  android?: InstallerMeta;
  iped_mac?: InstallerMeta;
  iped_win?: InstallerMeta;
}> {
  const result: { mac?: InstallerMeta; win?: InstallerMeta; android?: InstallerMeta; iped_mac?: InstallerMeta; iped_win?: InstallerMeta } = {};

  try { await fsp.access(DOWNLOADS_DIR); } catch { return result; }

  const files = await fsp.readdir(DOWNLOADS_DIR);

  for (const file of files) {
    const filePath = path.join(DOWNLOADS_DIR, file);
    let stat: fs.Stats;
    try { stat = await fsp.stat(filePath); } catch { continue; }
    const version = extractVersion(file);

    const meta: InstallerMeta = {
      filename: file,
      version: version || '0.0.0',
      size: formatBytes(stat.size),
      bytes: stat.size,
      releaseDate: stat.mtime.toISOString(),
    };

    // IPED bundles: IPED-{version}-mac.zip, IPED-{version}-win.zip
    const ipedMatch = file.match(/^IPED-[\d.]+-(mac|win)\.zip$/i);
    if (ipedMatch) {
      const platform = ipedMatch[1].toLowerCase();
      if (platform === 'mac') {
        if (!result.iped_mac || isVersionLessThan(result.iped_mac.version, meta.version)) {
          result.iped_mac = meta;
        }
      } else if (platform === 'win') {
        if (!result.iped_win || isVersionLessThan(result.iped_win.version, meta.version)) {
          result.iped_win = meta;
        }
      }
      continue;
    }

    if (file.endsWith('.dmg') && !file.includes('blockmap')) {
      if (!result.mac || isVersionLessThan(result.mac.version, meta.version)) {
        result.mac = meta;
      }
    } else if (file.endsWith('.exe') && !file.includes('blockmap')) {
      if (!result.win || isVersionLessThan(result.win.version, meta.version)) {
        result.win = meta;
      }
    } else if (file.endsWith('.apk')) {
      if (!result.android || isVersionLessThan(result.android.version, meta.version)) {
        result.android = meta;
      }
    }
  }

  return result;
}

/** Synchronous wrapper for use in YAML manifest routes where sync SHA-512 is needed */
function getInstallerInfo(): ReturnType<typeof getInstallerInfoAsync> extends Promise<infer T> ? T : never {
  // For sync contexts (YAML routes), use sync fallback
  const result: any = {};
  if (!fs.existsSync(DOWNLOADS_DIR)) return result;
  const files = fs.readdirSync(DOWNLOADS_DIR);
  for (const file of files) {
    const filePath = path.join(DOWNLOADS_DIR, file);
    const stat = fs.statSync(filePath);
    const version = extractVersion(file);
    const meta: InstallerMeta = { filename: file, version: version || '0.0.0', size: formatBytes(stat.size), bytes: stat.size, releaseDate: stat.mtime.toISOString() };
    const ipedMatch = file.match(/^IPED-[\d.]+-(mac|win)\.zip$/i);
    if (ipedMatch) { const p = ipedMatch[1].toLowerCase(); if (p === 'mac') { if (!result.iped_mac || isVersionLessThan(result.iped_mac.version, meta.version)) result.iped_mac = meta; } else if (p === 'win') { if (!result.iped_win || isVersionLessThan(result.iped_win.version, meta.version)) result.iped_win = meta; } continue; }
    if (file.endsWith('.dmg') && !file.includes('blockmap')) { if (!result.mac || isVersionLessThan(result.mac.version, meta.version)) result.mac = meta; }
    else if (file.endsWith('.exe') && !file.includes('blockmap')) { if (!result.win || isVersionLessThan(result.win.version, meta.version)) result.win = meta; }
    else if (file.endsWith('.apk')) { if (!result.android || isVersionLessThan(result.android.version, meta.version)) result.android = meta; }
  }
  return result;
}

// Updates are always non-mandatory — silent background updates only

// ─── GET /api/downloads/info — Returns available installer metadata ────
router.get('/info', async (_req: Request, res: Response) => {
  try {
    const info = await getInstallerInfoAsync();
    res.json(info);
  } catch (error: any) {
    console.error('Downloads info error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to read download info' });
  }
});

// ─── GET /api/updates/check — Version check for auto-updater ──────────
router.get('/check', async (req: Request, res: Response) => {
  try {
    const currentVersion = (req.query.currentVersion as string) || '0.0.0';
    const platform = (req.query.platform as string) || 'win32';

    const info = await getInstallerInfoAsync();
    const installer = platform === 'darwin' ? info.mac : platform === 'android' ? info.android : info.win;

    if (!installer) {
      res.json({
        updateAvailable: false,
        currentVersion,
        latestVersion: currentVersion,
        mandatory: false,
      });
      return;
    }

    const latestVersion = installer.version;
    const updateAvailable = isVersionLessThan(currentVersion, latestVersion);

    res.json({
      updateAvailable,
      currentVersion,
      latestVersion,
      mandatory: false,
      releaseDate: installer.releaseDate,
      downloadUrl: `/downloads/${installer.filename}`,
      downloadSize: installer.size,
      downloadBytes: installer.bytes,
    });
  } catch (error: any) {
    console.error('Update check error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to check for updates' });
  }
});

// ─── Routes mounted directly on the app (outside /api) ──────────────
export function mountDownloadFileRoute(app: any) {
  // Serve the download page
  app.get('/download', (_req: Request, res: Response) => {
    const htmlPath = path.join(DOWNLOADS_DIR, 'index.html');
    if (fs.existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.status(404).json({ error: 'Download page not found' });
    }
  });

  // Serve the seal icon for the download page
  app.get('/rmpg-seal.png', (_req: Request, res: Response) => {
    const iconPath = path.resolve(__dirname, '../../../client/public/rmpg-seal.png');
    if (fs.existsSync(iconPath)) {
      res.sendFile(iconPath);
    } else {
      res.status(404).end();
    }
  });

  // ─── electron-updater YAML manifests ──────────────────────────
  // GET /updates/latest.yml — Windows update manifest
  app.get('/updates/latest.yml', (_req: Request, res: Response) => {
    try {
      const info = getInstallerInfo();
      if (!info.win) {
        res.status(404).send('No Windows installer available');
        return;
      }

      const filePath = path.join(DOWNLOADS_DIR, path.basename(info.win.filename));
      const sha512 = computeSha512Sync(filePath);
      const releaseDate = info.win.releaseDate || new Date().toISOString(); // UTC is correct for electron-updater

      const yaml = [
        `version: ${escapeYaml(info.win.version)}`,
        `files:`,
        `  - url: ${escapeYaml(info.win.filename)}`,
        `    sha512: ${sha512}`,
        `    size: ${info.win.bytes}`,
        `path: ${escapeYaml(info.win.filename)}`,
        `sha512: ${sha512}`,
        `releaseDate: '${releaseDate}'`,
      ].join('\n');

      res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.send(yaml);
    } catch (error: any) {
      console.error('latest.yml generation error:', error?.message || 'Unknown error');
      res.status(500).send('Failed to generate update manifest');
    }
  });

  // GET /updates/latest-mac.yml — macOS update manifest
  app.get('/updates/latest-mac.yml', (_req: Request, res: Response) => {
    try {
      const info = getInstallerInfo();
      if (!info.mac) {
        res.status(404).send('No macOS installer available');
        return;
      }

      const filePath = path.join(DOWNLOADS_DIR, path.basename(info.mac.filename));
      const sha512 = computeSha512Sync(filePath);
      const releaseDate = info.mac.releaseDate || new Date().toISOString(); // UTC is correct for electron-updater

      const yaml = [
        `version: ${escapeYaml(info.mac.version)}`,
        `files:`,
        `  - url: ${escapeYaml(info.mac.filename)}`,
        `    sha512: ${sha512}`,
        `    size: ${info.mac.bytes}`,
        `path: ${escapeYaml(info.mac.filename)}`,
        `sha512: ${sha512}`,
        `releaseDate: '${releaseDate}'`,
      ].join('\n');

      res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.send(yaml);
    } catch (error: any) {
      console.error('latest-mac.yml generation error:', error?.message || 'Unknown error');
      res.status(500).send('Failed to generate update manifest');
    }
  });

  // ─── Serve installer and update-related files ──────────────────
  // Allowed extensions: .dmg, .exe, .blockmap, .yml
  const ALLOWED_EXTENSIONS = ['.dmg', '.exe', '.blockmap', '.yml', '.yaml', '.zip', '.apk'];

  // Serve files from BOTH /downloads/ and /updates/ paths
  // electron-updater fetches files relative to the feed URL (/updates/)
  // while the download page uses /downloads/
  const serveInstallerFile = async (req: Request, res: Response) => {
    const filename = req.params.filename as string;

    // Security: only allow specific file extensions
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      res.status(403).json({ error: 'Forbidden file type' });
      return;
    }

    // Prevent path traversal
    const safeName = path.basename(filename);
    const filePath = path.join(DOWNLOADS_DIR, safeName);

    let stat: fs.Stats;
    try { stat = await fsp.stat(filePath); } catch {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    // Symlink protection: resolve the real path and verify it's still within DOWNLOADS_DIR
    try {
      const realPath = await fsp.realpath(filePath);
      const relative = path.relative(DOWNLOADS_DIR, realPath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
    } catch {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    // Determine MIME type
    let mimeType = 'application/octet-stream';
    if (safeName.endsWith('.dmg')) mimeType = 'application/x-apple-diskimage';
    else if (safeName.endsWith('.exe')) mimeType = 'application/x-msdownload';
    else if (safeName.endsWith('.apk')) mimeType = 'application/vnd.android.package-archive';
    else if (safeName.endsWith('.yml') || safeName.endsWith('.yaml')) mimeType = 'text/yaml';
    else if (safeName.endsWith('.blockmap')) mimeType = 'application/octet-stream';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache');

    // Only set download disposition for actual installers
    if (safeName.endsWith('.dmg') || safeName.endsWith('.exe') || safeName.endsWith('.apk')) {
      const sanitized = safeName.replace(/[\r\n\0"]/g, '_');
      res.setHeader('Content-Disposition', `attachment; filename="${sanitized}"`);
    }

    const stream = fs.createReadStream(filePath);
    stream.once('error', (err) => {
      console.error('File stream error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to stream file' });
      else res.destroy();
    });
    res.on('error', () => { stream.destroy(); });
    stream.pipe(res);
  };

  // Mount on both paths — electron-updater uses /updates/, download page uses /downloads/
  app.get('/downloads/:filename', serveInstallerFile);
  app.get('/updates/:filename', serveInstallerFile);
}

export default router;
