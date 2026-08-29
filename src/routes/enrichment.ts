import { Hono } from 'hono';
import type { Env } from '../types';
import { recordAudit } from '../utils/auditLog';
import { normalizeDob } from '../utils/normalizeDob';
import type { EnrichmentSeed } from '../utils/enrichment/types';
import { OPEN_SOURCE_ENRICHMENT_SOURCES } from '../utils/enrichment/catalog';
import { runEnrichmentSearch } from '../utils/enrichment/runSearch';
import { ensureSkipTracerV2Schema } from '../utils/skiptracerV2/schema';

const enrichment = new Hono<Env>();

function actorId(c: { get: (k: 'user') => { user_id?: number; userId?: number; id?: number } | undefined }): number | null {
  const u = c.get('user');
  return u?.user_id ?? u?.userId ?? u?.id ?? null;
}

enrichment.get('/sources', async (c) => {
  const env = c.env as Record<string, unknown>;
  let openSanctionsConfigured = Boolean((env.OPENSANCTIONS_API_KEY as string | undefined)?.trim());
  if (!openSanctionsConfigured) {
    try {
      const row = await c.env.DB.prepare(
        `SELECT config_value FROM system_config
          WHERE config_key = 'opensanctions_api_key' AND is_active = 1 LIMIT 1`,
      ).first<{ config_value: string }>();
      openSanctionsConfigured = Boolean(row?.config_value?.trim());
    } catch { /* ignore */ }
  }
  return c.json(OPEN_SOURCE_ENRICHMENT_SOURCES.map(s => ({
    key: s.key,
    label: s.label,
    category: s.category,
    open_source: s.openSource,
    // NSOPW has a local DB fallback even when the live API flag is off.
    configured: s.key === 'open_sanctions' ? openSanctionsConfigured : true,
  })));
});

enrichment.post('/search', async (c) => {
  await ensureSkipTracerV2Schema(c.env.DB);
  const body = await c.req.json<Partial<EnrichmentSeed>>();
  const first = (body.first_name ?? '').trim();
  const last  = (body.last_name  ?? '').trim();
  const address = (body.address ?? '').trim();
  if ((!first || !last) && !address) {
    return c.json({ error: 'first_name and last_name required (or address for property/geocode lookup)' }, 400);
  }

  const seed: EnrichmentSeed = {
    first_name: first,
    last_name:  last,
    dob:        normalizeDob(body.dob ?? null) ?? undefined,
    city:       body.city,
    state:      body.state,
    address:    body.address,
    phone:      body.phone,
    email:      body.email,
    dl_number:  body.dl_number,
    ssn_last4:  body.ssn_last4,
  };

  const refresh = c.req.query('refresh') === '1' || c.req.query('refresh') === 'true';
  const response = await runEnrichmentSearch(
    c.env.DB,
    c.env as Record<string, unknown>,
    seed,
    { searchedBy: actorId(c), useCache: !refresh },
  );

  await recordAudit(c, {
    action: 'enrichment.search', entityType: 'person', entityId: null,
    details: JSON.stringify({
      match_tier: response.match_tier,
      source_count: response.sources.length,
      confirmed_count: response.confirmed_count,
      open_source_only: true,
    }),
    actorId: actorId(c),
  });

  return c.json(response);
});

export default enrichment;
