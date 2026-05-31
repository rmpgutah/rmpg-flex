import { Hono } from 'hono';
import type { R2Bucket, R2Object } from '@cloudflare/workers-types';

// ─── Helpers exported for use by src/index.ts (non-API paths) ──

export async function serveDownloadFile(bucket: R2Bucket, filename: string, c: any) {
  const obj = await bucket.get(filename);
  if (!obj) return c.json({ error: 'File not found' }, 404);

  const data = await obj.arrayBuffer();
  let mime = 'application/octet-stream';
  if (filename.endsWith('.dmg')) mime = 'application/x-apple-diskimage';
  else if (filename.endsWith('.exe')) mime = 'application/x-msdownload';
  else if (filename.endsWith('.apk')) mime = 'application/vnd.android.package-archive';
  else if (filename.endsWith('.yml') || filename.endsWith('.yaml')) mime = 'text/yaml';

  c.header('Content-Type', mime);
  c.header('Content-Length', String(obj.size));
  if (filename.endsWith('.dmg') || filename.endsWith('.exe') || filename.endsWith('.apk') || filename.endsWith('.zip')) {
    c.header('Content-Disposition', `attachment; filename="${filename}"`);
  }
  return c.body(data);
}

export async function serveDownloadPage(bucket: R2Bucket, c: any) {
  const obj = await bucket.get('index.html');
  if (obj) {
    const data = await obj.arrayBuffer();
    c.header('Content-Type', 'text/html; charset=utf-8');
    return c.body(data);
  }
  return c.text('Download page not found', 404);
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
    const list = await bucket.list();
    const manifestName = platform === 'win' ? 'latest.yml' : 'latest-mac.yml';

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
    console.error(`${platform} YAML error:`, err);
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
}

interface InstallerInfo {
  win?: InstallerMeta;
  mac?: InstallerMeta;
  android?: InstallerMeta;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function scanInstallers(bucket: R2Bucket): Promise<InstallerInfo> {
  const info: InstallerInfo = {};
  const list = await bucket.list();

  for (const obj of list.objects) {
    const name = obj.key;
    const version = extractVersion(name) || '0.0.0';
    const meta: InstallerMeta = {
      filename: name,
      version,
      size: fmtBytes(obj.size),
      bytes: obj.size,
      releaseDate: obj.uploaded.toISOString(),
    };

    if (name.endsWith('.dmg') && !name.includes('blockmap')) {
      if (!info.mac || verLt(info.mac.version, version)) info.mac = meta;
    } else if (name.endsWith('.exe') && !name.includes('blockmap')) {
      if (!info.win || verLt(info.win.version, version)) info.win = meta;
    } else if (name.endsWith('.apk')) {
      if (!info.android || verLt(info.android.version, version)) info.android = meta;
    }
  }

  // Override win/android to serve .zip instead of raw .exe/.apk
  // to bypass Chrome SmartScreen / Safe Browsing download blocks.
  if (info.win) {
    const zipName = info.win.filename.replace(/\.exe$/, '.zip');
    const zipObj = list.objects.find((o) => o.key === zipName);
    if (zipObj) {
      info.win = {
        filename: zipName,
        version: extractVersion(zipName) || info.win.version,
        size: fmtBytes(zipObj.size),
        bytes: zipObj.size,
        releaseDate: zipObj.uploaded.toISOString(),
      };
    }
  }

  if (info.android) {
    const zipName = info.android.filename.replace(/\.apk$/, '.zip');
    const zipObj = list.objects.find((o) => o.key === zipName);
    if (zipObj) {
      info.android = {
        filename: zipName,
        version: extractVersion(zipName) || info.android.version,
        size: fmtBytes(zipObj.size),
        bytes: zipObj.size,
        releaseDate: zipObj.uploaded.toISOString(),
      };
    }
  }

  return info;
}

const downloads = new Hono<{ Bindings: { DOWNLOADS: R2Bucket } }>();

// GET /api/downloads/info — returns installer metadata
downloads.get('/downloads/info', async (c) => {
  try {
    return c.json(await scanInstallers(c.env.DOWNLOADS));
  } catch (err) {
    console.error('downloads/info error:', err);
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
      downloadUrl: `/downloads/${target.filename}`,
      downloadSize: fmtBytes(target.bytes),
      downloadBytes: target.bytes,
    });
  } catch (err) {
    console.error('downloads/check error:', err);
    return c.json({ error: 'Check failed' }, 500);
  }
});

export default downloads;
