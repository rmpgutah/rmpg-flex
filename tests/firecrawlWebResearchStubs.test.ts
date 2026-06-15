// ============================================================
// Empty-state routers — firecrawl-tools + web-research
// ============================================================
// Verifies the dashboard-load GETs no longer 404, that explicit
// config GETs win over the array catch-all (registration order), and
// that mutations return a graceful not-configured shape.
// ============================================================

import { describe, it, expect } from 'vitest';
import firecrawl from '../src/routes/firecrawlTools';
import webResearch from '../src/routes/webResearch';

describe('firecrawl-tools empty-state router', () => {
  it('dashboard list GETs return [] (not 404)', async () => {
    for (const p of ['/scouts', '/agents', '/workflows', '/chatbot',
      '/observer/watches', '/deep-search/history', '/scouts/1/runs']) {
      const res = await firecrawl.request(p);
      expect(res.status, p).toBe(200);
      expect(await res.json(), p).toEqual([]);
    }
  });

  it('explicit config GETs win over the array catch-all', async () => {
    const theme = await (await firecrawl.request('/theme')).json() as any;
    expect(theme.accent_color).toBe('#d4a017');
    const leads = await (await firecrawl.request('/leads/config')).json() as any;
    expect(leads.configured).toBe(false);
    const slack = await (await firecrawl.request('/integrations/slack')).json() as any;
    expect(slack.connected).toBe(false);
  });

  it('mutations return graceful not-configured', async () => {
    const post = await firecrawl.request('/deep-search', { method: 'POST', body: '{}' });
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({ error: 'Firecrawl not configured' });
    const del = await firecrawl.request('/scouts/9', { method: 'DELETE' });
    expect(await del.json()).toEqual({ success: true });
  });
});

describe('web-research router', () => {
  it('status not-connected, results empty', async () => {
    expect(await (await webResearch.request('/status')).json()).toEqual({ connected: false });
    expect(await (await webResearch.request('/results')).json()).toEqual([]);
  });

  it('search/scrape return empty not-configured payloads', async () => {
    const search = await (await webResearch.request('/search', { method: 'POST', body: '{}' })).json() as any;
    expect(search.results).toEqual([]);
    const scrape = await (await webResearch.request('/scrape', { method: 'POST', body: '{}' })).json() as any;
    expect(scrape.markdown).toBe('');
  });
});
