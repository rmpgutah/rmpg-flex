// ============================================================
// Firecrawl tools — empty-state router (/api/firecrawl-tools)
// ============================================================
// FirecrawlTab.tsx wires ~120 endpoints (scouts, agents, workflows,
// chatbot, observer, deep-search, brand monitors, connectors, …) but
// Firecrawl is NOT configured (no FIRECRAWL key/binding anywhere). The
// dashboard previously 404'd every list call on load.
//
// This router makes the UI render an honest empty state instead of
// 404ing: every list/history GET returns [], object-config GETs return
// a not-configured default, and every mutation returns a graceful
// { error: 'Firecrawl not configured' } (HTTP 200, so the client shows
// the message rather than throwing). When a FIRECRAWL key is later
// provisioned, real handlers replace these — the contract (shapes) is
// already what the client expects.
//
// NOTE: a dedicated router (not the shared `stubs`) precisely because
// the catch-all `*` handlers below must not leak onto the other dozen
// prefixes `stubs` is mounted at.

import { Hono } from 'hono';
import type { Env } from '../types';

const firecrawl = new Hono<Env>();

const NOT_CONFIGURED = { error: 'Firecrawl not configured' } as const;

// ── Object-returning config GETs (must precede the array catch-all) ──
firecrawl.get('/leads/config', (c) => c.json({ configured: false }));
firecrawl.get('/mcp/config', (c) => c.json({ enabled: false, servers: [], tools: [] }));
firecrawl.get('/theme', (c) => c.json({
  accent_color: '#d4a017', show_labels: true, compact_mode: false, default_tab: 'scouts',
}));
firecrawl.get('/integrations/slack', (c) => c.json({ connected: false }));
firecrawl.get('/integrations/discord', (c) => c.json({ connected: false }));

// ── File-upload tools (frame-accurate parity with the prior stubs) ──
firecrawl.post('/pdf-inspect/upload', (c) => c.json({ pages: 0, text: '', error: 'Firecrawl not configured' }));
firecrawl.post('/doc-extract/upload', (c) => c.json({ fields: {}, error: 'Firecrawl not configured' }));
firecrawl.post('/pdf-manipulate/upload', (c) => c.json({ error: 'Firecrawl not configured' }));

// ── Catch-alls ──────────────────────────────────────────────
// Every other list/history GET → empty array; mutations → graceful
// not-configured; deletes → no-op success so the UI stays consistent.
firecrawl.get('/*', (c) => c.json([]));
firecrawl.post('/*', (c) => c.json(NOT_CONFIGURED));
firecrawl.put('/*', (c) => c.json(NOT_CONFIGURED));
firecrawl.delete('/*', (c) => c.json({ success: true }));

export default firecrawl;
