import { Hono } from 'hono';
import type { Env } from '../types';

// Serves the wireless install package for RMPG Flex Connect (ios2/) —
// the itms-services manifest, IPA, and icons that build.sh assembles.
// Public: an iPhone's itms-services client fetches these unauthenticated,
// with no cookie/JS support, so this MUST stay outside authMiddleware
// and outside any Cloudflare managed-challenge scope (see CLAUDE.md's
// /api/health WAF-skip precedent — /api/ios-ota needs the same treatment).
const iosOta = new Hono<Env>();

const CONTENT_TYPES: Record<string, string> = {
  ipa: 'application/octet-stream',
  plist: 'application/xml',
  html: 'text/html; charset=utf-8',
  png: 'image/png',
};

iosOta.get('/:file', async (c) => {
  const file = c.req.param('file');
  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    return c.json({ error: 'Unsupported file type' }, 400);
  }

  const obj = await c.env.DOWNLOADS.get(`ios-ota/${file}`);
  if (!obj) {
    return c.json({ error: 'Not found — has build.sh been run and uploaded?', file }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'no-cache');
  return new Response(obj.body, { headers });
});

export default iosOta;
