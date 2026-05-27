import { Hono } from 'hono';
import type { Env } from '../types';

const stubs = new Hono<Env>();

// User preferences
stubs.get('/preferences', (c) => c.json({ theme: 'dark', sidebar_width: 240, notifications_enabled: true, map_default_zoom: 13, map_center_lat: 40.76, map_center_lng: -111.89 }));
stubs.put('/preferences', async (c) => c.json({ success: true }));

// Notifications
stubs.get('/unread-count', (c) => c.json({ count: 0 }));
stubs.get('/', (c) => c.json([]));

// Reports
stubs.get('/dashboard', (c) => c.json({ active_calls: 0, available_units: 0, today_calls: 0, clearance_rate: 0 }));
stubs.get('/patrol-coverage', (c) => c.json({ coverage: [] }));
stubs.get('/clearance-rate', (c) => c.json({ rate: 0 }));
stubs.get('/overdue-reports', (c) => c.json({ count: 0 }));
stubs.get('/shift-comparison', (c) => c.json({ shifts: [] }));
stubs.get('/officer-activity', (c) => c.json([]));
stubs.get('/upcoming-court', (c) => c.json([]));
stubs.get('/evidence-pending', (c) => c.json({ count: 0 }));
stubs.get('/response-times', (c) => c.json({ overall: { avgDispatchMinutes: 0, avgTotalResponseMinutes: 0, minResponseMinutes: 0, maxResponseMinutes: 0, totalCalls: 0 }, byPriority: [] }));
// Reports analytics endpoints — ReportsPage tabs each fetch these on mount.
// Without real handlers they 404 and surface as red ErrorBoundary fallbacks on
// every tab visit. Stub the empty-data shape the components read into. Real
// implementations land per-feature in follow-up PRs; the report builder needs
// query-design + perf tuning that's out of scope here.
stubs.get('/incidents-summary', (c) => {
  const groupBy = c.req.query('groupBy') || 'type';
  return c.json({ groupBy, data: [], total: 0 });
});
stubs.get('/crime-trends', (c) => c.json({ trends: [], periods: [], topCategories: [] }));
stubs.get('/crime-analysis', (c) => c.json({ summary: {}, byType: [], byHour: [], byDayOfWeek: [], hotspots: [] }));
stubs.get('/citation-revenue', (c) => c.json({ totalRevenue: 0, byMonth: [], byStatute: [], byOfficer: [] }));
stubs.get('/beat-activity', (c) => c.json({ beats: [], callsByBeat: [], unitsByBeat: [] }));
stubs.get('/statute-analytics', (c) => c.json({ topStatutes: [], trends: [], byCategory: [] }));
// Schedules + templates: paginated list shape so .data is iterable on
// the caller side (ReportsPage builder line ~841 reads response.data).
stubs.get('/schedules', (c) => c.json({ data: [], total: 0 }));
stubs.get('/templates', (c) => c.json([]));

// Communication
stubs.get('/activity-feed', (c) => c.json([]));
stubs.get('/bolos/active', (c) => c.json([]));

// Warrants
stubs.get('/', (c) => c.json([]));
stubs.get('/scrapers', (c) => c.json({ scrapers: [], last_run: null }));
stubs.get('/scrapers/health', (c) => c.json({ status: 'ok' }));

// Weather
stubs.get('/', (c) => c.json({ temperature: 72, conditions: 'Clear', icon: 'clear-day' }));

// Email
stubs.get('/unread-count', (c) => c.json({ count: 0 }));

// Integrations
stubs.get('/google-maps/client-key', (c) => c.json({}));

// Dispatch stubs
stubs.get('/stats', (c) => c.json({ total_calls: 0, active_calls: 0, units_online: 0 }));
stubs.get('/shift-handoff', (c) => c.json({ handoff: null }));

export default stubs;
