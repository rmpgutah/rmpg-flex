// ============================================================
// /api/ai — Dispatch AI (Workers AI)
// ============================================================
// Real GPS-aware dispatch intelligence backed by the account's Workers
// AI binding (env.AI). Two working endpoints:
//   POST /ai/suggest-units  — rank available units by LIVE fresh GPS,
//                             then LLM-pick + justify the best responders.
//   POST /ai/analyze        — safety briefing / flags / severity for a call.
//
// The dashboard GETs (/config /status /stats /health /activity) report the
// Workers-AI provider so the admin AI panels render an enabled state. Usage
// metering (/stats, /activity) is still a stub — wiring an ai_activity_log
// is a follow-up; those return zeros/empty rather than 404.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';
import { requireRole } from '../middleware/auth';
import {
  rankUnitsForCall, suggestUnits, analyzeCall,
  GPS_FRESH_WINDOW_S, type RawUnit, type CallContext,
} from '../utils/dispatchAi';

const ai = new Hono<Env>();

const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'];

ai.get('/config', (c) => c.json({
  provider: 'workers-ai',
  autoFallback: true,
  features: {
    callAnalysis: true,
    narrativeAssist: false,
    unitSuggestions: true,
    safetyBriefings: true,
    dataCleanup: false,
    systemMonitoring: false,
  },
  providers: {
    'workers-ai': { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
    groq:   { apiKey: '', model: '' },
    gemini: { apiKey: '', model: '' },
    openai: { apiKey: '', model: '', baseUrl: '' },
    ollama: { url: '', model: '' },
  },
}));

ai.get('/stats', (c) => c.json({
  requestsToday: 0,
  requestsThisWeek: 0,
  requestsThisMonth: 0,
  avgResponseMs: 0,
  cacheHitRate: 0,
  totalRequests: 0,
}));

ai.get('/status', (c) => c.json({
  provider: 'workers-ai',
  available: true,
  model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  providers: [{ name: 'workers-ai', available: true, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }],
}));

ai.get('/health', (c) => c.json({
  ok: true,
  status: 'ready',
  providers: ['workers-ai'],
  message: 'Workers AI dispatch intelligence enabled',
}));

ai.get('/activity', (c) => c.json([] as Array<{
  id: number; task_type: string; provider: string; latency_ms: number;
  status: string; prompt_preview: string; created_at: string;
}>));

// ─── POST /ai/suggest-units ─────────────────────────────────
// Body: { callId } (server fetches fresh-GPS units) OR { call, units }.
// Returns LLM-picked suggestions + the deterministic candidate ranking.
ai.post('/suggest-units', requireRole(...READ_ROLES), async (c) => {
  try {
    const body = await c.req.json().catch(() => ({} as any));
    const db = getDb(c.env);

    let call: CallContext | null = null;
    let units: RawUnit[] = [];

    if (body.callId != null) {
      const id = parseInt(String(body.callId), 10);
      const row = await queryFirst<{ id: number; call_number: string | null; incident_type: string | null; priority: string | null; location_address: string | null; latitude: number | null; longitude: number | null }>(
        db, 'SELECT id, call_number, incident_type, priority, location_address, latitude, longitude FROM calls_for_service WHERE id = ?', id);
      if (!row) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);
      if (row.latitude == null || row.longitude == null) {
        return c.json({ callId: id, suggestions: [], candidates: [], reason: 'NO_CALL_GPS' });
      }
      call = { ...row, latitude: row.latitude, longitude: row.longitude, flags: [] };
      units = await query<RawUnit>(db, `
        SELECT u.id, u.call_sign, u.status, u.latitude, u.longitude, u.gps_updated_at,
               usr.full_name AS officer_name
        FROM units u LEFT JOIN users usr ON usr.id = u.officer_id
        WHERE u.status IN ('available', 'on_patrol', 'dispatched')
          AND u.latitude IS NOT NULL AND u.longitude IS NOT NULL
      `);
    } else if (body.call && body.call.latitude != null && body.call.longitude != null) {
      call = body.call as CallContext;
      units = Array.isArray(body.units) ? (body.units as RawUnit[]) : [];
    } else {
      return c.json({ error: 'Provide callId or call{latitude,longitude}', code: 'BAD_INPUT' }, 400);
    }

    const candidates = rankUnitsForCall(call, units, GPS_FRESH_WINDOW_S, 8);
    const ai_result = await suggestUnits(c.env.AI, call, candidates);

    return c.json({
      callId: call.id ?? null,
      provider: ai_result.provider,
      fallback: ai_result.fallback,
      freshWindowSeconds: GPS_FRESH_WINDOW_S,
      suggestions: ai_result.suggestions,
      candidates,
    });
  } catch (err) {
    console.error('[ai] suggest-units error', err);
    return c.json({ error: 'Failed to suggest units', code: 'SUGGEST_ERR' }, 500);
  }
});

// ─── POST /ai/analyze ───────────────────────────────────────
// Body: { callId } OR { incident_type, priority, location_address, latitude,
// longitude, flags }. Returns a safety briefing + flags + severity.
ai.post('/analyze', requireRole(...READ_ROLES), async (c) => {
  try {
    const body = await c.req.json().catch(() => ({} as any));
    const db = getDb(c.env);
    let call: CallContext;

    if (body.callId != null) {
      const id = parseInt(String(body.callId), 10);
      const row = await queryFirst<{ id: number; incident_type: string | null; priority: string | null; location_address: string | null; latitude: number | null; longitude: number | null }>(
        db, 'SELECT id, incident_type, priority, location_address, latitude, longitude FROM calls_for_service WHERE id = ?', id);
      if (!row) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);
      call = { ...row, latitude: row.latitude ?? 0, longitude: row.longitude ?? 0, flags: [] };
    } else {
      call = {
        incident_type: body.incident_type ?? null,
        priority: body.priority ?? null,
        location_address: body.location_address ?? null,
        latitude: Number(body.latitude) || 0,
        longitude: Number(body.longitude) || 0,
        flags: Array.isArray(body.flags) ? body.flags.map(String) : [],
      };
    }

    const analysis = await analyzeCall(c.env.AI, call);
    return c.json(analysis);
  } catch (err) {
    console.error('[ai] analyze error', err);
    return c.json({ error: 'Failed to analyze call', code: 'ANALYZE_ERR' }, 500);
  }
});

export default ai;
