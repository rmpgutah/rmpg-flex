// ============================================================
// RMPG Flex — Text-to-Speech endpoint
// ============================================================
// Ports the legacy Express /api/tts surface (legacy/server-vps/src/routes/tts.ts).
// The legacy server uses edge-tts-universal (a Node lib that opens a WebSocket
// to Microsoft Edge's TTS endpoint); that lib uses node:net and won't run on
// Workers without significant adaptation. Rather than ship a half-working
// stub or a 404 (which the client logs as a bug), this returns a structured
// 503 the client treats as "use browser SpeechSynthesis fallback."
//
// Phase 2 plan: re-implement using Cloudflare Workers AI text-to-speech bindings
// (env.AI.run with a TTS model) — single fetch, no WebSocket, no Node deps.
// Until that lands, the client's existing fallback path keeps voice alerts
// working via the browser's built-in speech synthesis.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';

const tts = new Hono<Env>();

tts.post('/', async (c) => {
  try {
    const body = await c.req.json<{ text?: unknown }>().catch(() => ({ text: '' }));
    if (!body.text || typeof body.text !== 'string') {
      return c.json({ error: 'text is required and must be a string', code: 'TTS_MISSING_TEXT' }, 400);
    }
    return c.json({
      error: 'Server TTS not configured on this Worker — use client-side speech synthesis',
      code: 'TTS_NOT_CONFIGURED',
    }, 503);
  } catch (err) {
    return c.json({ error: 'TTS request failed', detail: (err as Error)?.message }, 500);
  }
});

export default tts;
