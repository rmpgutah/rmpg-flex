import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

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
  const [a1, a2, a3] = a.split('.').map(Number);
  const [b1, b2, b3] = b.split('.').map(Number);
  if (a1 !== b1) return a1 < b1;
  if (a2 !== b2) return a2 < b2;
  return a3 < b3;
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

/** Scan downloads directory for available installers with full metadata. */
function getInstallerInfo(): {
  mac?: InstallerMeta;
  win?: InstallerMeta;
  android?: InstallerMeta;
} {
  const result: { mac?: InstallerMeta; win?: InstallerMeta; android?: InstallerMeta } = {};

  if (!fs.existsSync(DOWNLOADS_DIR)) return result;

  const files = fs.readdirSync(DOWNLOADS_DIR);

  for (const file of files) {
    const filePath = path.join(DOWNLOADS_DIR, file);
    const stat = fs.statSync(filePath);
    const version = extractVersion(file);

    const meta: InstallerMeta = {
      filename: file,
      version: version || '0.0.0',
      size: formatBytes(stat.size),
      bytes: stat.size,
      releaseDate: stat.mtime.toISOString(),
    };

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

// Updates are always non-mandatory — silent background updates only

// ─── GET /api/downloads/info — Returns available installer metadata ────
router.get('/info', (_req: Request, res: Response) => {
  try {
    const info = getInstallerInfo();
    res.json(info);
  } catch (error: any) {
    console.error('Downloads info error:', error);
    res.status(500).json({ error: 'Failed to read download info', code: 'FAILED_TO_READ_DOWNLOAD' });
  }
});

// ─── GET /api/updates/check — Version check for auto-updater ──────────
router.get('/check', (req: Request, res: Response) => {
  try {
    const currentVersion = (req.query.currentVersion as string) || '0.0.0';
    const platform = (req.query.platform as string) || 'win32';

    const info = getInstallerInfo();
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
    console.error('Update check error:', error);
    res.status(500).json({ error: 'Failed to check for updates', code: 'FAILED_TO_CHECK_FOR' });
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
      res.status(404).json({ error: 'Download page not found', code: 'DOWNLOAD_PAGE_NOT_FOUND' });
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

      const filePath = path.join(DOWNLOADS_DIR, info.win.filename);
      const sha512 = computeSha512Sync(filePath);
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

      res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.send(yaml);
    } catch (error: any) {
      console.error('latest.yml generation error:', error);
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

      const filePath = path.join(DOWNLOADS_DIR, info.mac.filename);
      const sha512 = computeSha512Sync(filePath);
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

      res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.send(yaml);
    } catch (error: any) {
      console.error('latest-mac.yml generation error:', error);
      res.status(500).send('Failed to generate update manifest');
    }
  });

  // ─── Serve installer and update-related files ──────────────────
  // Allowed extensions: .dmg, .exe, .blockmap, .yml
  const ALLOWED_EXTENSIONS = ['.dmg', '.exe', '.blockmap', '.yml', '.yaml', '.zip', '.apk'];

  // Serve files from BOTH /downloads/ and /updates/ paths
  // electron-updater fetches files relative to the feed URL (/updates/)
  // while the download page uses /downloads/
  const serveInstallerFile = (req: Request, res: Response) => {
    const { filename } = req.params;

    // Security: only allow specific file extensions
    const ext = path.extname(filename as string || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      res.status(403).json({ error: 'Forbidden file type', code: 'FORBIDDEN_FILE_TYPE' });
      return;
    }

    // Prevent path traversal
    const safeName = path.basename(filename as string);
    const filePath = path.join(DOWNLOADS_DIR, safeName);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found', code: 'FILE_NOT_FOUND' });
      return;
    }

    const stat = fs.statSync(filePath);

    // Determine MIME type
    let mimeType = 'application/octet-stream';
    if (safeName.endsWith('.dmg')) mimeType = 'application/x-apple-diskimage';
    else if (safeName.endsWith('.exe')) mimeType = 'application/x-msdownload';
    else if (safeName.endsWith('.apk')) mimeType = 'application/vnd.android.package-archive';
    else if (safeName.endsWith('.yml') || safeName.endsWith('.yaml')) mimeType = 'text/yaml';
    else if (safeName.endsWith('.blockmap')) mimeType = 'application/octet-stream';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stat.size);

    // Only set download disposition for actual installers
    if (safeName.endsWith('.dmg') || safeName.endsWith('.exe') || safeName.endsWith('.apk')) {
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    }

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  };

  // Mount on both paths — electron-updater uses /updates/, download page uses /downloads/
  app.get('/downloads/:filename', serveInstallerFile);
  app.get('/updates/:filename', serveInstallerFile);
}

export default router;
