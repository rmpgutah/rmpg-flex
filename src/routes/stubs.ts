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
stubs.get('/response-times', (c) => c.json([]));

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
