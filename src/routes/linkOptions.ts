// Configurable linkage option lists. Read endpoint feeds dispatch dropdowns;
// admin CRUD (added in a later task) edits the same link_options table.
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query } from '../utils/db';

const CATEGORIES = ['person_role', 'vehicle_role', 'caller_relationship', 'business_role'] as const;

// Read router — mounted at /api/dispatch → GET /api/dispatch/link-options.
export const linkOptions = new Hono<Env>();

linkOptions.get('/link-options', async (c) => {
  try {
    const db = getDb(c.env);
    // Return ALL rows (active AND inactive) with the is_active flag — the CLIENT
    // merge needs to SEE an inactive default row to hide it. Filtering is_active=1
    // here would simply omit a hidden default, leaving its hardcoded default
    // visible (hide would silently no-op).
    const rows = await query<{ category: string; value: string; label: string; sort_order: number; is_active: number }>(
      db,
      `SELECT category, value, label, sort_order, is_active
         FROM link_options
        ORDER BY category, sort_order`,
    );
    const grouped: Record<string, unknown[]> = {};
    for (const cat of CATEGORIES) grouped[cat] = [];
    for (const r of rows) (grouped[r.category] ||= []).push(r);
    return c.json(grouped);
  } catch {
    // Table missing / not yet applied to live → empty groups; client falls back
    // to its hardcoded defaults. Never 500 the dropdowns.
    return c.json({ person_role: [], vehicle_role: [], caller_relationship: [], business_role: [] });
  }
});
