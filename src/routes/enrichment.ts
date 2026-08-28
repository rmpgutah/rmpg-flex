import { Hono } from 'hono';
import type { Env } from '../types';
import { recordAudit } from '../utils/auditLog';
import { normalizeDob } from '../utils/normalizeDob';
import type { EnrichmentSeed } from '../utils/enrichment/types';
import { OPEN_SOURCE_ENRICHMENT_SOURCES } from '../utils/enrichment/catalog';
import { runEnrichmentSearch } from '../utils/enrichment/runSearch';

const enrichment = new Hono<Env>();

function actorId(c: { get: (k: 'user') => { user_id?: number; userId?: number; id?: number } | undefined }): number | null {
  const u = c.get('user');
  return u?.user_id ?? u?.userId ?? u?.id ?? null;
}

enrichment.get('/sources', (c) => {
  return c.json(OPEN_SOURCE_ENRICHMENT_SOURCES.map(s => ({
    key: s.key,
    label: s.label,
    category: s.category,
    open_source: true,
    configured: true,
  })));
});

enrichment.post('/search', async (c) => {
  const body = await c.req.json<Partial<EnrichmentSeed>>();
  const first = (body.first_name ?? '').trim();
  const last  = (body.last_name  ?? '').trim();
  if (!first || !last) return c.json({ error: 'first_name and last_name required' }, 400);

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

  const response = await runEnrichmentSearch(
    c.env.DB,
    c.env as Record<string, unknown>,
    seed,
    { searchedBy: actorId(c) },
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
