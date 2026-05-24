// ============================================================
// Downloads & Auto-Updates — Workers (Hono) Port
// Scans DOWNLOADS R2 bucket for installers, serves installers,
// and returns metadata/manifests for Electron / Android updates.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { paramStr } from '../worker-middleware/d1Helpers';

// ─── Installer Info Types ────────────────────────────────────
interface InstallerMeta {
  filename: string;
  version: string;
  size: string;
  bytes: number;
  releaseDate?: string;
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

/** Compute SHA-512 from R2 object (custom header metadata or computed if possible) */
// For cloudflare R2 worker, we store the sha512 in custom metadata (e.g. customMetadata: { sha512: "..." })
// during upload, or fallback to hashing it on-demand if the size is small, but R2 metadata is best.
function getSha512FromMeta(obj: any): string {
  return obj.customMetadata?.sha512 || obj.customMetadata?.SHA512 || '';
}

/** List all installers from R2 and build the metadata */
async function getInstallerInfo(bucket: any): Promise<{
  mac?: InstallerMeta;
  win?: InstallerMeta;
  android?: InstallerMeta;
  bundles?: {
    mac?: InstallerMeta;
    win?: InstallerMeta;
  };
}> {
  const result: {
    mac?: InstallerMeta;
    win?: InstallerMeta;
    android?: InstallerMeta;
    bundles?: {
      mac?: InstallerMeta;
      win?: InstallerMeta;
    };
  } = { bundles: {} };

  if (!bucket) return result;

  // List all objects in DOWNLOADS bucket
  const list = await bucket.list();
  const files = list.objects;

  for (const obj of files) {
    const file = obj.key;
    const version = extractVersion(file);
    const mtime = obj.uploaded;

    const meta: InstallerMeta = {
      filename: file,
      version: version || '0.0.0',
      size: formatBytes(obj.size),
      bytes: obj.size,
      releaseDate: mtime ? mtime.toISOString() : new Date().toISOString(),
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
    } else if (file.endsWith('-mac.zip')) {
      if (!result.bundles) result.bundles = {};
      if (!result.bundles.mac || isVersionLessThan(result.bundles.mac.version, meta.version)) {
        result.bundles.mac = meta;
      }
    } else if (file.endsWith('-win.zip')) {
      if (!result.bundles) result.bundles = {};
      if (!result.bundles.win || isVersionLessThan(result.bundles.win.version, meta.version)) {
        result.bundles.win = meta;
      }
    }
  }

  return result;
}

export function mountDownloadsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();

  // ─── GET /api/downloads/info — Returns available installer metadata ────
  api.get('/info', async (c) => {
    try {
      const info = await getInstallerInfo(c.env.DOWNLOADS);
      return c.json(info);
    } catch (error: any) {
      console.error('Downloads info error:', error);
      return c.json({ error: 'Failed to read download info', code: 'FAILED_TO_READ_DOWNLOAD' }, 500);
    }
  });

  // ─── GET /api/updates/check — Version check for auto-updater ──────────
  api.get('/check', async (c) => {
    try {
      const currentVersion = c.req.query('currentVersion') || '0.0.0';
      const platform = c.req.query('platform') || 'win32';

      const info = await getInstallerInfo(c.env.DOWNLOADS);
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
        downloadUrl: `/downloads/${installer.filename}`,
        downloadSize: installer.size,
        downloadBytes: installer.bytes,
      });
    } catch (error: any) {
      console.error('Update check error:', error);
      return c.json({ error: 'Failed to check for updates', code: 'FAILED_TO_CHECK_FOR' }, 500);
    }
  });

  // ─── GET /downloads/:filename and /updates/:filename ──────────────────
  const ALLOWED_EXTENSIONS = ['.dmg', '.exe', '.blockmap', '.yml', '.yaml', '.zip', '.apk'];

  const serveInstallerFile = async (c: any) => {
    const filename = paramStr(c.req.param('filename'));

    // Security: only allow specific file extensions
    const ext = filename.includes('.') ? '.' + filename.split('.').pop()?.toLowerCase() || '' : '';
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return c.json({ error: 'Forbidden file type', code: 'FORBIDDEN_FILE_TYPE' }, 403);
    }

    // Serve from DOWNLOADS R2 bucket
    const obj = await c.env.DOWNLOADS.get(filename);
    if (!obj) {
      return c.json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, 404);
    }

    // Handle latest.yml / latest-mac.yml generation dynamically if not stored, 
    // or serve directly from R2 if uploaded there.
    const data = await obj.arrayBuffer();

    // Determine MIME type
    let mimeType = 'application/octet-stream';
    if (filename.endsWith('.dmg')) mimeType = 'application/x-apple-diskimage';
    else if (filename.endsWith('.exe')) mimeType = 'application/x-msdownload';
    else if (filename.endsWith('.apk')) mimeType = 'application/vnd.android.package-archive';
    else if (filename.endsWith('.yml') || filename.endsWith('.yaml')) mimeType = 'text/yaml';
    else if (filename.endsWith('.blockmap')) mimeType = 'application/octet-stream';

    c.header('Content-Type', mimeType);
    c.header('Content-Length', String(obj.size));

    // Only set download disposition for actual installers
    if (filename.endsWith('.dmg') || filename.endsWith('.exe') || filename.endsWith('.apk') || filename.endsWith('.zip')) {
      c.header('Content-Disposition', `attachment; filename="${filename}"`);
    }

    return c.body(data);
  };

  // Serve latest.yml / latest-mac.yml dynamically if not present in R2
  const serveYamlManifest = async (c: any, platform: 'win' | 'mac') => {
    try {
      const info = await getInstallerInfo(c.env.DOWNLOADS);
      const installer = platform === 'win' ? info.win : info.mac;
      const manifestName = platform === 'win' ? 'latest.yml' : 'latest-mac.yml';

      // First try to fetch from R2 in case we uploaded a pre-generated one
      const r2Obj = await c.env.DOWNLOADS.get(manifestName);
      if (r2Obj) {
        const data = await r2Obj.arrayBuffer();
        c.header('Content-Type', 'text/yaml; charset=utf-8');
        c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
        return c.body(data);
      }

      if (!installer) {
        return c.text(`No ${platform === 'win' ? 'Windows' : 'macOS'} installer available`, 404);
      }

      const obj = await c.env.DOWNLOADS.get(installer.filename);
      if (!obj) {
        return c.text('Installer file not found on storage', 404);
      }

      const sha512 = getSha512FromMeta(obj);
      const releaseDate = installer.releaseDate || new Date().toISOString();

      const yaml = [
        `version: ${installer.version}`,
        `files:`,
        `  - url: ${installer.filename}`,
        `    sha512: ${sha512}`,
        `    size: ${installer.bytes}`,
        `path: ${installer.filename}`,
        `sha512: ${sha512}`,
        `releaseDate: '${releaseDate}'`,
      ].join('\n');

      c.header('Content-Type', 'text/yaml; charset=utf-8');
      c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      return c.text(yaml);
    } catch (error: any) {
      console.error(`${platform} YAML generation error:`, error);
      return c.text('Failed to generate update manifest', 500);
    }
  };

  // YAML manifests
  app.get('/updates/latest.yml', (c) => serveYamlManifest(c, 'win'));
  app.get('/updates/latest-mac.yml', (c) => serveYamlManifest(c, 'mac'));

  // Serves /downloads/:filename and /updates/:filename
  app.get('/downloads/:filename', serveInstallerFile);
  app.get('/updates/:filename', serveInstallerFile);

  // Serve /download page (html)
  app.get('/download', async (c) => {
    const obj = await c.env.DOWNLOADS.get('index.html');
    if (obj) {
      const data = await obj.arrayBuffer();
      c.header('Content-Type', 'text/html; charset=utf-8');
      return c.body(data);
    }
    return c.text('Download page index.html not found in DOWNLOADS R2 bucket', 404);
  });

  app.get('/rmpg-seal.png', async (c) => {
    const obj = await c.env.DOWNLOADS.get('rmpg-seal.png');
    if (obj) {
      const data = await obj.arrayBuffer();
      c.header('Content-Type', 'image/png');
      return c.body(data);
    }
    return c.text('Not Found', 404);
  });

  app.route('/api/downloads', api);
  app.route('/api/updates', api);
}
