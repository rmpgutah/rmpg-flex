// ============================================================
// /api/ai — AI dashboard stubs
// ============================================================
// AdminAISettingsTab + the 8 panels under client/src/pages/admin/ai/
// poll these on mount. None of the AI subsystem is wired in this
// rewrite yet (Groq/Gemini/OpenAI/Ollama integration is a Phase 2
// item), so every handler returns an "AI is unconfigured" shape
// rather than a 404.
//
// Shapes mirror the TypeScript interfaces in
// client/src/pages/admin/ai/AISharedComponents.tsx (AIConfig,
// UsageStats, ProviderInfo) and the inline shapes in
// AIActivityPanel + AIIntelligencePanel. When the real AI service
// lands, swap these handlers for D1-backed queries against an
// `ai_activity_log` + `ai_config` pair.
//
// POST /ai/config is intentionally NOT stubbed: silently accepting
// writes would let admins think they've configured providers when
// nothing persists. Let it 404 explicitly until real backing exists.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';

const ai = new Hono<Env>();

ai.get('/config', (c) => c.json({
  provider: 'none',
  autoFallback: false,
  features: {
    callAnalysis: false,
    narrativeAssist: false,
    unitSuggestions: false,
    safetyBriefings: false,
    dataCleanup: false,
    systemMonitoring: false,
  },
  providers: {
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
  provider: 'none',
  available: false,
  model: 'unconfigured',
  providers: [] as Array<{ name: string; available: boolean; model: string }>,
}));

// AIIntelligencePanel + AICommandCenterPanel both call this with
// `apiFetch<any>`, so the exact shape is loose. Return a minimal
// health object that won't crash the panel's render guards.
ai.get('/health', (c) => c.json({
  ok: false,
  status: 'unconfigured',
  providers: [],
  message: 'AI subsystem not yet enabled on this deployment',
}));

// ActivityEntry[] — empty array renders the panel's "no activity"
// empty state. The `limit` query param is accepted but ignored.
ai.get('/activity', (c) => c.json([] as Array<{
  id: number;
  task_type: string;
  provider: string;
  latency_ms: number;
  status: string;
  prompt_preview: string;
  created_at: string;
}>));

export default ai;
