// ============================================================
// RMPG Flex — Text-to-Speech endpoint (Workers AI)
// ============================================================
// Ports the legacy Express /api/tts surface (legacy/server-vps/src/routes/tts.ts).
// The legacy server used edge-tts-universal (a Node lib that opens a WebSocket
// to Microsoft Edge's TTS endpoint via node:net) — incompatible with Workers.
//
// PRIMARY voice is Deepgram Aura-2 (@cf/deepgram/aura-2-en) — the same
// context-aware, genuinely human-sounding model the radio dispatcher uses, so
// every spoken surface in the app is the advanced English voice rather than the
// robotic melotts. melotts (@cf/myshell-ai/melotts) is kept as a FALLBACK so a
// voice alert is never silent if Aura hiccups. Both return MP3 the client hands
// to AudioContext.decodeAudioData (Aura via returnRawResponse + encoding:'mp3';
// melotts via base64) — the audio/mpeg contract is identical to the legacy
// endpoint either way.
//
// The client POSTs { text, urgent, voice, rate, pitch }. `voice` is honored
// when it names a valid Aura-2 speaker (resolveAura2Voice coerces anything else
// — e.g. a browser persona name like "en-US-JennyNeural" — to the default);
// rate/pitch are ignored (the client's P25 radio-processing chain does the
// "coloring"). lang/encoding are fixed to English MP3.
//
// On ANY failure (both models error / empty audio) we return a non-2xx with a
// structured code. edgeTTS.ts treats every non-ok response as a signal to fall
// back to the browser's built-in SpeechSynthesis, so voice alerts degrade
// gracefully rather than going silent.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { AURA2_EN_MODEL, resolveAura2Voice } from '../utils/aiDispatcher';

const tts = new Hono<Env>();

const MELOTTS_MODEL = '@cf/myshell-ai/melotts';
const MAX_TEXT_LEN = 1500; // matches legacy cap; TTS is billed per audio-minute/char
// Cache key carries the engine + speaker so Aura-2 audio never collides with a
// previously-cached melotts clip of the same text (the v1 melotts cache is left
// to expire on its own 7-day TTL).
const CACHE_PREFIX = 'tts:aura2:v1:';
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days — CAD phrases repeat verbatim

// SHA-256 → hex. Used as the KV cache key because alert text (≤1500 chars) can
// exceed KV's 512-byte key limit, and a hash gives a fixed-width collision-safe key.
async function textHash(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// base64 (melotts output) → raw MP3 bytes (client decode contract).
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function audioResponse(bytes: Uint8Array, cache: 'HIT' | 'MISS', engine: string): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'X-TTS-Engine': engine,
      'X-TTS-Cache': cache,
      // Let the SPA cache identical phrases briefly so rapid repeats
      // (e.g. a status readback fired twice) don't re-hit the model.
      'Cache-Control': 'private, max-age=300',
    },
  });
}

// Aura-2 primary. Returns the raw MP3 bytes, or null on any failure/empty so the
// caller can fall through to melotts.
async function synthAura(ai: Ai, text: string, speaker: string): Promise<Uint8Array | null> {
  try {
    const resp = (await ai.run(
      AURA2_EN_MODEL,
      { text, speaker, encoding: 'mp3' } as never,
      { returnRawResponse: true } as never,
    )) as unknown as Response;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    return bytes.byteLength > 0 ? bytes : null;
  } catch (err) {
    console.warn('[TTS] aura-2 failed, falling back to melotts:', (err as Error)?.message);
    return null;
  }
}

// melotts fallback. {audio} base64 → MP3 bytes, or null on failure/empty.
async function synthMelotts(ai: Ai, text: string): Promise<Uint8Array | null> {
  try {
    const result = (await ai.run(MELOTTS_MODEL, { prompt: text, lang: 'en' } as never)) as { audio?: string };
    const b64 = result?.audio;
    if (!b64) return null;
    const bytes = base64ToBytes(b64);
    return bytes.byteLength > 0 ? bytes : null;
  } catch (err) {
    console.error('[TTS] melotts run failed:', (err as Error)?.message);
    return null;
  }
}

tts.post('/', async (c) => {
  let body: { text?: unknown; voice?: unknown };
  try {
    body = await c.req.json<{ text?: unknown; voice?: unknown }>();
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

  const speaker = resolveAura2Voice(typeof body.voice === 'string' ? body.voice : null);

  // ── Cache lookup (best-effort) — keyed on speaker + text ──
  let cacheKey: string | null = null;
  try {
    cacheKey = CACHE_PREFIX + speaker + ':' + (await textHash(text));
    const cached = await c.env.KV.get(cacheKey, 'arrayBuffer');
    if (cached && cached.byteLength > 0) {
      return audioResponse(new Uint8Array(cached), 'HIT', 'workers-ai-aura-2');
    }
  } catch (err) {
    console.warn('[TTS] cache read failed (continuing):', (err as Error)?.message);
  }

  // ── Synthesize: Aura-2 primary, melotts fallback ──
  let engine = 'workers-ai-aura-2';
  let bytes = await synthAura(c.env.AI, text, speaker);
  if (!bytes) {
    engine = 'workers-ai-melotts';
    bytes = await synthMelotts(c.env.AI, text);
  }
  if (!bytes) {
    // 503 → client falls back to browser SpeechSynthesis.
    return c.json({ error: 'TTS synthesis failed', code: 'TTS_SYNTH_FAILED' }, 503);
  }

  // ── Cache store (best-effort, non-blocking on failure) ──
  if (cacheKey) {
    try {
      await c.env.KV.put(cacheKey, bytes, { expirationTtl: CACHE_TTL_SECONDS });
    } catch (err) {
      console.warn('[TTS] cache write failed (continuing):', (err as Error)?.message);
    }
  }

  return audioResponse(bytes, 'MISS', engine);
});

export default tts;
