// ============================================================
// Web research — empty-state router (/api/web-research)
// ============================================================
// WebResearchPage calls /web-research/{status,results,search,scrape}
// plus results CRUD, but no router existed (every call 404'd) and the
// search/scrape paths need the (absent) Firecrawl key to do real work.
//
// This mounts the prefix and returns honest empty-state: status shows
// not-connected, results is an empty list, search/scrape return empty
// payloads with a not-configured note (HTTP 200 so the client renders
// the empty state rather than throwing). Saved-result CRUD is a no-op
// because there is no backing store yet — when Firecrawl + a results
// table are provisioned, real handlers replace these.

import { Hono } from 'hono';
import type { Env } from '../types';

const webResearch = new Hono<Env>();

const NOT_CONFIGURED = 'Web research is not configured';

webResearch.get('/status', (c) => c.json({ connected: false }));
webResearch.get('/results', (c) => c.json([]));

webResearch.post('/search', (c) => c.json({ results: [], error: NOT_CONFIGURED }));
webResearch.post('/scrape', (c) => c.json({ markdown: '', content: '', error: NOT_CONFIGURED }));

// Saved-result CRUD — no backing store yet, so these are graceful no-ops.
// The client ignores the response body on these paths (only checks res.ok).
webResearch.post('/results', (c) => c.json({ success: false, error: NOT_CONFIGURED }));
webResearch.put('/results/:id/link', (c) => c.json({ success: false, error: NOT_CONFIGURED }));
webResearch.put('/results/:id', (c) => c.json({ success: false, error: NOT_CONFIGURED }));
webResearch.delete('/results/:id', (c) => c.json({ success: true }));

export default webResearch;
