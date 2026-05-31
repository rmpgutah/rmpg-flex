import { Hono } from 'hono';
import type { Env } from '../types';

const crm = new Hono<Env>();

crm.get('/dashboard', (c) => c.json({ active_clients: 0, total_clients: 0, outstanding_revenue: 0, overdue_invoices: 0, pending_tasks: 0, expiring_contracts: 0, total_invoiced_mtd: 0, total_paid_mtd: 0 }));
crm.get('/recent-activity', (c) => c.json([]));
crm.get('/expiring-contracts', (c) => c.json([]));
crm.get('/tasks', (c) => c.json([]));
crm.post('/tasks', (c) => c.json({ id: 0 }, 201));
crm.put('/tasks/:id', (c) => c.json({}));
crm.delete('/tasks/:id', (c) => c.json({}));
crm.post('/activity', (c) => c.json({ id: 0 }, 201));
crm.get('/activity/:clientId', (c) => c.json([]));
crm.get('/pipeline-summary', (c) => c.json({ stages: [], conversions: [] }));
crm.get('/revenue-forecast', (c) => c.json({ won_revenue: 0, total_expected: 0, total_pipeline: 0, active_deals: 0 }));
crm.get('/contacts', (c) => c.json([]));

crm.get('/leads', (c) => c.json([]));
crm.get('/leads/pipeline-summary', (c) => c.json([{ stage: 'new', count: 0, total_value: 0 }]));
crm.get('/leads/follow-ups', (c) => c.json({ overdue: [], today: [], upcoming: [] }));
crm.get('/leads/source-analytics', (c) => c.json({ period_days: 30, data: [] }));
crm.put('/leads/:id/stage', (c) => c.json({}));
crm.put('/leads/:id', (c) => c.json({}));
crm.post('/leads/:id/convert', (c) => c.json({ client_id: 0 }));
crm.post('/leads/bulk-action', (c) => c.json({}));
crm.post('/leads', (c) => c.json({ id: 0 }, 201));
crm.get('/lead-activity/:leadId', (c) => c.json([]));
crm.post('/lead-activity', (c) => c.json({ id: 0 }, 201));

crm.get('/proposals', (c) => c.json([]));
crm.get('/proposals/:id', (c) => c.json({}));
crm.get('/proposal-templates', (c) => c.json([]));
crm.put('/proposals/:id/stage', (c) => c.json({}));
crm.put('/proposals/:id', (c) => c.json({}));
crm.post('/proposals', (c) => c.json({ id: 0 }, 201));

crm.get('/reports/metrics', (c) => c.json({ total_pipeline_value: 0, win_rate: 0, avg_cycle_days: 0, leads_this_month: 0, proposals_sent: 0, proposals_accepted: 0 }));
crm.get('/reports/revenue', (c) => c.json([]));
crm.get('/reports/pipeline', (c) => c.json({ stages: [] }));
crm.get('/reports/retention', (c) => c.json([]));
crm.get('/reports/lead-source-roi', (c) => c.json([]));

crm.get('/firecrawl/status', (c) => c.json({ connected: false }));
crm.get('/firecrawl/saved-searches', (c) => c.json([]));
crm.get('/firecrawl/search-history', (c) => c.json([]));
crm.get('/firecrawl/monitors', (c) => c.json([]));
crm.get('/firecrawl/monitors/:id/changes', (c) => c.json([]));
crm.post('/firecrawl/search', (c) => c.json({ results: [] }));
crm.post('/firecrawl/scrape', (c) => c.json({}));
crm.post('/firecrawl/import', (c) => c.json({ id: 0 }, 201));
crm.post('/firecrawl/import-bulk', (c) => c.json({ imported: 0, skipped: 0 }));
crm.post('/firecrawl/saved-searches', (c) => c.json({ id: 0 }, 201));
crm.post('/firecrawl/monitors', (c) => c.json({ id: 0 }, 201));
crm.post('/firecrawl/monitors/:id/check', (c) => c.json({}));
crm.post('/firecrawl/monitors/changes/:id/acknowledge', (c) => c.json({}));
crm.delete('/firecrawl/monitors/:id', (c) => c.json({}));

crm.get('/scrape-sources', (c) => c.json([]));
crm.get('/scrape-log', (c) => c.json([]));
crm.put('/scrape-sources/:key', (c) => c.json({}));
crm.post('/scrape-sources/:key/poll-now', (c) => c.json({}));

export default crm;
