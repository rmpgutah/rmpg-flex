// ============================================================
// RMPG Flex — Text-to-Speech endpoint (Workers AI)
// ============================================================
// Ports the legacy Express /api/tts surface (legacy/server-vps/src/routes/tts.ts).
// The legacy server used edge-tts-universal (a Node lib that opens a WebSocket
// to Microsoft Edge's TTS endpoint via node:net) — incompatible with Workers.
//
// This implementation synthesizes server-side voice with the Workers AI
// text-to-speech model @cf/myshell-ai/melotts (single env.AI.run call, no
// WebSocket, no Node deps). The model returns base64-encoded MP3; the client
// (client/src/utils/edgeTTS.ts) expects raw binary it can hand to
// AudioContext.decodeAudioData, so we base64-decode and return audio/mpeg —
// keeping the client contract identical to the legacy endpoint.
//
// The client still POSTs { text, urgent, voice, rate, pitch }. melotts only
// accepts text + language, so voice/rate/pitch are intentionally ignored here:
// the client's P25 radio-processing chain (bandpass + bitcrusher + AGC) does
// the voice "coloring", and the persona voice names (en-US-JennyNeural, …) have
// no melotts equivalent. lang is fixed to 'en'.
//
// On ANY failure (model error, empty audio) we return a non-2xx with a
// structured code. edgeTTS.ts treats every non-ok response as a signal to fall
// back to the browser's built-in SpeechSynthesis, so voice alerts degrade
// gracefully rather than going silent.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';

const tts = new Hono<Env>();

const MODEL = '@cf/myshell-ai/melotts';
const MAX_TEXT_LEN = 1500; // matches legacy cap; melotts is billed per audio-minute
const CACHE_PREFIX = 'tts:melotts:v1:';
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days — CAD phrases repeat verbatim

// SHA-256 → hex. Used as the KV cache key because alert text (≤1500 chars) can
// exceed KV's 512-byte key limit, and a hash gives a fixed-width collision-safe key.
async function textHash(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// base64 (model output) → raw MP3 bytes (client decode contract).
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function audioResponse(bytes: Uint8Array, cache: 'HIT' | 'MISS'): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'X-TTS-Engine': 'workers-ai-melotts',
      'X-TTS-Cache': cache,
      // Let the SPA cache identical phrases briefly so rapid repeats
      // (e.g. a status readback fired twice) don't re-hit the model.
      'Cache-Control': 'private, max-age=300',
    },
  });
}

tts.post('/', async (c) => {
  let body: { text?: unknown };
  try {
    body = await c.req.json<{ text?: unknown }>();
  } catch {
    return c.json({ error: 'invalid JSON body', code: 'TTS_BAD_BODY' }, 400);
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return c.json({ error: 'text is required and must be a string', code: 'TTS_MISSING_TEXT' }, 400);
  }
  if (text.length > MAX_TEXT_LEN) {
    return c.json({ error: `text must be ${MAX_TEXT_LEN} characters or less`, code: 'TTS_TEXT_TOO_LONG' }, 400);
  }

  // ── Cache lookup (best-effort) ──
  let cacheKey: string | null = null;
  try {
    cacheKey = CACHE_PREFIX + (await textHash(text));
    const cached = await c.env.KV.get(cacheKey, 'arrayBuffer');
    if (cached && cached.byteLength > 0) {
      return audioResponse(new Uint8Array(cached), 'HIT');
    }
  } catch (err) {
    console.warn('[TTS] cache read failed (continuing):', (err as Error)?.message);
  }

  // ── Synthesize ──
  let audioB64: string | undefined;
  try {
    const result = (await c.env.AI.run(MODEL, { prompt: text, lang: 'en' })) as { audio?: string };
    audioB64 = result?.audio;
  } catch (err) {
    console.error('[TTS] melotts run failed:', (err as Error)?.message);
    // 503 → client falls back to browser SpeechSynthesis.
    return c.json({ error: 'TTS synthesis failed', code: 'TTS_SYNTH_FAILED' }, 503);
  }

  if (!audioB64) {
    return c.json({ error: 'TTS engine returned no audio', code: 'TTS_NO_AUDIO' }, 502);
  }

  const bytes = base64ToBytes(audioB64);
  if (bytes.byteLength === 0) {
    return c.json({ error: 'TTS engine returned empty audio', code: 'TTS_NO_AUDIO' }, 502);
  }

  // ── Cache store (best-effort, non-blocking on failure) ──
  if (cacheKey) {
    try {
      await c.env.KV.put(cacheKey, bytes, { expirationTtl: CACHE_TTL_SECONDS });
    } catch (err) {
      console.warn('[TTS] cache write failed (continuing):', (err as Error)?.message);
    }
  }

  return audioResponse(bytes, 'MISS');
});

export default tts;
