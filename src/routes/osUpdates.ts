import { Hono } from 'hono';
import type { R2Bucket, D1Database } from '@cloudflare/workers-types';
import { authMiddleware } from '../middleware/auth';

/**
 * OS update manifest feed for RMPG Flex terminals.
 *
 * Terminals poll GET /api/os/manifest?channel=stable and get a flat key=value
 * document naming the payload URLs and their SHA-256 digests. The on-device
 * agent (kiosk-linux/rootfs-overlay/usr/bin/rmpg-update) downloads into the
 * INACTIVE A/B slot, verifies, and flips the default slot.
 *
 * WHY key=value AND NOT JSON: the terminal parses this with BusyBox grep/cut.
 * The image ships no JSON parser, and adding one to read four fields is not a
 * trade worth making on a device in a vehicle.
 *
 * WHY THE MANIFEST IS A STORED FILE, NOT COMPUTED FROM BUCKET CONTENTS:
 * publishing must be a deliberate act. If this endpoint simply reported the
 * highest version present in R2, then uploading a build would instantly point
 * every terminal in the fleet at it — one bad commit would reboot every
 * vehicle into a broken image. Instead CI writes os/staging/manifest.txt, and
 * promoting to stable is a separate explicit step (POST /api/os/promote, admin
 * only). Staging exists to be tested on one unit first.
 */

interface Bindings {
  DOWNLOADS: R2Bucket;
  DB: D1Database;
}

const osUpdates = new Hono<{ Bindings: Bindings }>();

// Auth lives INSIDE this router, not at the registry level. The registry entry
// mounts at the bare `/api` prefix as `auth: 'public'` because /os/manifest must
// stay reachable with no user at all — a terminal polls it before anyone has
// signed in, and often with nobody in the vehicle. Marking the entry
// `auth: 'required'` would make the loop in src/index.ts register
// `app.use('/api/*', authMiddleware)`, blanket-blocking every public route
// including /api/auth/login (incident #627). Same pattern as src/routes/geocode.ts
// and src/routes/shiftPlans.ts.
//
// ⚠️  Scope this to the exact paths that need it — NOT `'*'`. A router-internal
// `osUpdates.use('*', mw)` merges through `app.route('/api', osUpdates)` into the
// parent app's route table as a genuinely global `/api/*` pattern, which is the
// blanket-block this arrangement exists to avoid (regressed that way 2026-07-18;
// see test-workers/mobileAuthRouting.test.ts).
//
// Only /os/promote is gated: it is the one mutating endpoint, and it is the gate
// before the whole fleet installs an image. Its handler checks for admin/manager,
// but that check reads c.get('user'), which NOTHING populated while this router
// was mounted public — so promote returned 403 to every caller including real
// admins, and the gate could never be opened. Fail-closed, but non-functional.
// The bare path and its glob are both listed because Hono's `/x/*` does not match
// the bare `/x` (same gotcha documented in routesConfig.ts's header).
osUpdates.use('/os/promote', authMiddleware);
osUpdates.use('/os/promote/*', authMiddleware);

const CHANNELS = ['stable', 'staging'] as const;
type Channel = (typeof CHANNELS)[number];

function isChannel(v: string): v is Channel {
  return (CHANNELS as readonly string[]).includes(v);
}

function manifestKey(channel: Channel): string {
  return `os/${channel}/manifest.txt`;
}

// GET /api/os/manifest?channel=stable&current=1.2.0
//
// Always 200 with a body the agent can parse. A 404 here would be
// indistinguishable to BusyBox wget from a network failure, and the agent would
// log an error on a fleet that is simply fully up to date.
osUpdates.get('/os/manifest', async (c) => {
  const channelParam = c.req.query('channel') || 'stable';
  if (!isChannel(channelParam)) {
    return c.text(`# unknown channel: ${channelParam}\n`, 400, { 'Content-Type': 'text/plain' });
  }

  const obj = await c.env.DOWNLOADS.get(manifestKey(channelParam));
  if (!obj) {
    return c.text(
      `# no release published on the ${channelParam} channel\n`,
      200,
      { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
    );
  }

  const body = await obj.text();
  return c.text(body, 200, {
    'Content-Type': 'text/plain',
    // Never cache: a terminal must see a promote (or a rollback) promptly, and
    // the payloads themselves are the only large transfer here.
    'Cache-Control': 'no-store',
  });
});

// GET /api/os/channels — what is published where. Useful for the fleet admin
// surface and for confirming a promote landed.
osUpdates.get('/os/channels', async (c) => {
  const out: Record<string, { version: string | null; published: string | null }> = {};
  for (const ch of CHANNELS) {
    const obj = await c.env.DOWNLOADS.get(manifestKey(ch));
    if (!obj) {
      out[ch] = { version: null, published: null };
      continue;
    }
    const text = await obj.text();
    const version = /^version=(.+)$/m.exec(text)?.[1]?.trim() ?? null;
    out[ch] = { version, published: obj.uploaded.toISOString() };
  }
  return c.json(out);
});

/**
 * POST /api/os/promote — copy the staging manifest to stable.
 *
 * The deliberate gate between "a build exists" and "the fleet installs it".
 * Requires the caller to name the exact version being promoted, so a stale
 * browser tab or a double-submit cannot promote something the operator did not
 * intend to look at.
 */
osUpdates.post('/os/promote', async (c) => {
  const user = c.get('user' as never) as { role?: string } | undefined;
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    return c.json({ error: 'Admin or manager role required' }, 403);
  }

  const body = await c.req.json<{ version?: string }>().catch(() => ({}) as { version?: string });
  if (!body.version) {
    return c.json({ error: 'version is required — name the version you are promoting' }, 400);
  }

  const staging = await c.env.DOWNLOADS.get(manifestKey('staging'));
  if (!staging) return c.json({ error: 'Nothing is published on staging' }, 404);

  const text = await staging.text();
  const stagingVersion = /^version=(.+)$/m.exec(text)?.[1]?.trim();
  if (!stagingVersion) return c.json({ error: 'Staging manifest has no version field' }, 422);

  if (stagingVersion !== body.version) {
    return c.json({
      error: 'Version mismatch — staging has moved since this page loaded',
      staging: stagingVersion,
      requested: body.version,
    }, 409);
  }

  await c.env.DOWNLOADS.put(manifestKey('stable'), text, {
    httpMetadata: { contentType: 'text/plain' },
  });

  return c.json({ ok: true, promoted: stagingVersion });
});

export default osUpdates;
