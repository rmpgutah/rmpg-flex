// ============================================================
// RMPG Flex — AI Dispatcher (Workers AI voice-agent brain)
// ============================================================
// Turns a finished radio transmission into a spoken dispatcher reply:
//
//   recorded WebM/Opus clip
//        │  transcribeTransmission()      @cf/openai/whisper-large-v3-turbo
//        ▼
//   "12-Adam, show me out at 200 South on a traffic stop"
//        │  decideDispatcherReply()       @cf/meta/llama-3.3-70b-instruct-fp8-fast
//        ▼  { intent: 'traffic_stop', reply: "12-Adam, copy, show you out…" }
//   reply text
//        │  synthesizeDispatcherVoice()   @cf/myshell-ai/melotts (MP3)
//        ▼
//   MP3 bytes → stored as a DISPATCH radio_transmission + broadcast live,
//   where the client colors it through the shared P25 radio-haze chain.
//
// All three model calls are best-effort: any failure returns null and the
// caller (VoiceHubDO) simply skips the reply rather than throwing. The
// dispatcher must never break the radio relay it rides on.
//
// ── WHERE THE DISPATCH BEHAVIOR IS SHAPED ───────────────────
// The dispatcher's persona, the 10-codes it knows, and how it decides
// what to say live in DISPATCH_POLICY below. That string IS the product:
// editing it changes how the AI dispatcher talks on the radio. See the
// "TUNE ME" marker — that's the operator-owned knob.
// ============================================================

// `Ai` is a global type from @cloudflare/workers-types (same as src/types.ts
// references it) — no import needed.
import type { LookupRequest } from './dispatcherAwareness';

const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';
// Fallback transcriber — the stable base whisper. Both models were verified
// (2026-05-29) to transcribe our recorded WebM/Opus; turbo is higher quality
// (base64 `audio`) and base whisper is the safety net (array-of-bytes `audio`).
// NOTE: @cf/openai/gpt-4o-transcribe is NOT available on this account (5007).
const TRANSCRIBE_FALLBACK_MODEL = '@cf/openai/whisper';
const LLM_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const TTS_MODEL = '@cf/myshell-ai/melotts';

// Radio brevity — keep replies tight. melotts is billed per audio-minute
// and real dispatchers don't monologue. ~60 words ≈ 20s of speech.
const MAX_REPLY_CHARS = 400;

export interface DispatcherTurn {
  /** What the unit just said (Whisper transcript of the clip). */
  transcript: string;
  /** Call-sign of the transmitting unit, e.g. "12-Adam" (may be null). */
  speaker: string | null;
  /** Human channel name for context, e.g. "Patrol-1". */
  channelName: string | null;
  /** Recent prior traffic on this channel, oldest→newest, for context. */
  recent: Array<{ speaker: string | null; text: string }>;
  /** Live CAD situational snapshot from gatherAwareness() (advanced awareness). */
  awareness: string;
}

export interface DispatcherDecision {
  /** Routing label the LLM assigned (for logging / future automation). */
  intent: string;
  /** What dispatch says back on the radio. Empty string = stay silent. */
  reply: string;
  /**
   * If the unit asked for a record check, the model fills this so the
   * caller can run a real CAD query and feed the result to
   * phraseLookupReply(). `reply` then acts as the holding "stand by".
   */
  lookup?: LookupRequest;
}

// ─── DISPATCH POLICY (TUNE ME) ──────────────────────────────
// This is the operator-owned brain of the dispatcher. The default below
// is a working RMPG/Spillman-style policy; refine the persona, the agency
// name, the 10-codes, and the routing rules to match how RMPG actually
// runs the radio. Keep it tight — every extra rule is tokens per reply.
const DISPATCH_POLICY = `You are RMPG DISPATCH — the radio dispatcher for Rocky Mountain Protective Group, a private security / law-enforcement agency in Salt Lake City, Utah. You are calm, terse, and professional, exactly like a Spillman/Motorola CAD dispatcher. You speak ONLY what would go out over a P25 radio — never narrate, never explain yourself.

You hear EVERY transmission on the channel and you acknowledge or respond to each one. Match the unit's brevity. Use the unit's call-sign when you have it. You are given a live CAD board snapshot (active calls, units on duty, BOLOs, panic alerts) — USE it: reference the unit's actual assignment, name a real available unit when dispatching backup, and prioritize an active panic alert over everything. Use standard radio procedure:
- Acknowledge a status with "copy" or "10-4" and read back the key detail.
- A unit "out" / "out at <place>" → log the location and acknowledge ("copy, show you out at <place>, time is <approx>").
- A request for backup / "10-78" / "start me another unit" → acknowledge and dispatch the nearest available on-duty unit by call-sign from the board.
- An emergency / "shots fired" / "officer down" / "10-33" / "code 3" → respond with urgency, acknowledge, advise units to hold traffic, and that help is en route.
- A record check the unit requests — a license PLATE, a PERSON by name, or a WARRANT check — you CAN run it. Set the "lookup" field (type + the plate/name to search) and make "reply" a brief "stand by"; the result will be read back automatically.
- Plain unit-to-unit chatter not directed at dispatch → a brief "copy" is enough.

Common 10-codes: 10-4 acknowledged, 10-8 in service, 10-7 out of service, 10-20 location, 10-23 arrived, 10-28 plate/registration check, 10-29 wants/warrants check, 10-76 en route, 10-78 need backup, 10-97 arrived on scene, code 4 = scene secure / no further help needed.

Never invent unit numbers, names, plates, warrants, or facts you were not given in the snapshot or a lookup result. If you don't have a detail, ask for it briefly.`;

const FORMAT_INSTRUCTION = `Respond with ONLY a JSON object, no prose around it:
{"intent":"<one of: status_update | out_at_location | backup_request | emergency | lookup_request | en_route | arrived | code4 | chatter | unclear>","reply":"<exactly what dispatch says over the radio — one or two short sentences>","lookup":{"type":"plate|person|warrant","query":"<plate or name to run>"}}
Include "lookup" ONLY when the unit is asking you to run a plate, a person, or a warrant/wants check (set intent to lookup_request and reply with a brief "stand by"). Omit "lookup" entirely otherwise.
If the transmission is unintelligible, set intent to "unclear" and reply asking the unit to repeat their last.`;

// ─── Transcription ──────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  // Chunk to stay clear of arg-count limits on String.fromCharCode.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export { bytesToBase64 };

/**
 * Transcribe a recorded transmission. Tries whisper-large-v3-turbo first
 * (higher quality, base64 `audio`); if that throws or returns empty it
 * falls back to the base whisper model (array-of-bytes `audio`). Both were
 * verified to accept our WebM/Opus recordings. Returns null only when both
 * fail, so the caller simply skips the reply rather than crashing the relay.
 */
export async function transcribeTransmission(ai: Ai, audio: Uint8Array): Promise<string | null> {
  // Primary — whisper-large-v3-turbo (base64 string input).
  try {
    const res = (await ai.run(WHISPER_MODEL, { audio: bytesToBase64(audio), language: 'en' } as never)) as { text?: string };
    const text = (res?.text || '').trim();
    if (text) return text;
    console.warn('[aiDispatcher] turbo whisper returned empty — trying base whisper');
  } catch (err) {
    console.warn('[aiDispatcher] turbo whisper failed, trying base whisper:', (err as Error)?.message);
  }

  // Fallback — base whisper (classic array-of-bytes input).
  try {
    const res = (await ai.run(TRANSCRIBE_FALLBACK_MODEL, { audio: Array.from(audio) } as never)) as { text?: string };
    const text = (res?.text || '').trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    console.error('[aiDispatcher] transcription failed (both models):', (err as Error)?.message);
    return null;
  }
}

// ─── Reasoning + intent routing ─────────────────────────────

function buildUserPrompt(turn: DispatcherTurn): string {
  const lines: string[] = [];
  if (turn.channelName) lines.push(`Channel: ${turn.channelName}`);
  lines.push('=== LIVE CAD BOARD ===');
  lines.push(turn.awareness);
  lines.push('======================');
  if (turn.recent.length) {
    lines.push('Recent traffic (oldest first):');
    for (const r of turn.recent) lines.push(`  ${r.speaker || 'Unit'}: ${r.text}`);
  }
  lines.push('');
  lines.push(`New transmission from ${turn.speaker || 'an unidentified unit'}:`);
  lines.push(`"${turn.transcript}"`);
  lines.push('');
  lines.push(FORMAT_INSTRUCTION);
  return lines.join('\n');
}

const LOOKUP_TYPES = ['plate', 'person', 'warrant'] as const;

function parseLookup(value: unknown): LookupRequest | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const type = typeof obj.type === 'string' ? obj.type.toLowerCase() : '';
  const q = typeof obj.query === 'string' ? obj.query.trim() : '';
  if (!q || !(LOOKUP_TYPES as readonly string[]).includes(type)) return undefined;
  return { type: type as LookupRequest['type'], query: q };
}

// Build a decision from an already-structured object. Workers AI's
// llama-3.3 returns `response` as a PARSED OBJECT when the output is JSON
// (not a string), so this is the COMMON path, not a fallback.
function decisionFromObject(obj: Record<string, unknown>): DispatcherDecision | null {
  const reply = (typeof obj.reply === 'string' ? obj.reply : '').trim();
  const lookup = parseLookup(obj.lookup);
  // A lookup with only a "stand by" reply is still actionable.
  if (reply || lookup) {
    return {
      intent: (typeof obj.intent === 'string' ? obj.intent : 'general').trim() || 'general',
      reply: reply || 'Stand by.',
      lookup,
    };
  }
  return null;
}

// Tolerant extraction for the STRING form — Llama can wrap JSON in stray
// prose or code fences. Grab the first {...}; else treat the whole thing as
// the spoken reply.
function parseDecision(raw: string): DispatcherDecision | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const d = decisionFromObject(JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>);
      if (d) return d;
    } catch { /* fall through */ }
  }
  const reply = raw.replace(/```/g, '').trim();
  return reply ? { intent: 'general', reply } : null;
}

// Coerce Workers AI's `response` — which is an OBJECT when the model emits
// JSON, or a string otherwise — into a decision. THE fix for the "AI
// dispatcher silent" bug: response was an object, and the old code called
// .trim() on it, which threw and was swallowed → null → no reply.
function coerceDecision(response: unknown): DispatcherDecision | null {
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    return decisionFromObject(response as Record<string, unknown>);
  }
  return parseDecision(String(response ?? ''));
}

// Coerce `response` to a plain spoken string (for the lookup read-back pass).
function coerceReplyText(response: unknown): string {
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object') {
    const r = (response as Record<string, unknown>).reply;
    return typeof r === 'string' ? r : '';
  }
  return '';
}

/**
 * Decide what dispatch says back. Returns null when the model fails or
 * elects to stay silent (empty reply).
 */
export async function decideDispatcherReply(ai: Ai, turn: DispatcherTurn): Promise<DispatcherDecision | null> {
  if (!turn.transcript.trim()) return null;
  let response: unknown;
  try {
    const res = (await ai.run(LLM_MODEL, {
      messages: [
        { role: 'system', content: DISPATCH_POLICY },
        { role: 'user', content: buildUserPrompt(turn) },
      ],
      max_tokens: 220,
      temperature: 0.3,
    } as never)) as { response?: unknown };
    response = res?.response;
  } catch (err) {
    console.error('[aiDispatcher] LLM failed:', (err as Error)?.message);
    return null;
  }
  const decision = coerceDecision(response);
  if (!decision) return null;
  if (decision.reply.length > MAX_REPLY_CHARS) {
    decision.reply = decision.reply.slice(0, MAX_REPLY_CHARS).trimEnd();
  }
  return decision;
}

/**
 * Second pass: read a CAD lookup result back over the radio. Grounded
 * strictly in the result string (never embellished). On model failure it
 * falls back to the raw result text — better than silence on a warrant hit.
 */
export async function phraseLookupReply(
  ai: Ai,
  turn: DispatcherTurn,
  lookup: LookupRequest,
  resultText: string,
): Promise<string> {
  try {
    const res = (await ai.run(LLM_MODEL, {
      messages: [
        { role: 'system', content: DISPATCH_POLICY },
        {
          role: 'user',
          content:
            `${turn.speaker || 'A unit'} requested a ${lookup.type} check on "${lookup.query}".\n` +
            `CAD result:\n${resultText}\n\n` +
            `Read this back over the radio to the unit — terse, professional, the unit's call-sign first. ` +
            `State ONLY what the result says; never add facts. Respond with ONLY the spoken line, no JSON, no quotes.`,
        },
      ],
      max_tokens: 160,
      temperature: 0.2,
    } as never)) as { response?: unknown };
    let reply = coerceReplyText(res?.response).replace(/```/g, '').trim();
    // If the model wrapped it in JSON anyway, recover the reply field.
    if (reply.startsWith('{')) reply = parseDecision(reply)?.reply ?? '';
    if (!reply) return resultText;
    return reply.length > MAX_REPLY_CHARS ? reply.slice(0, MAX_REPLY_CHARS).trimEnd() : reply;
  } catch (err) {
    console.error('[aiDispatcher] phrase lookup failed:', (err as Error)?.message);
    return resultText;
  }
}

// ─── Speech synthesis ───────────────────────────────────────

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Synthesize the dispatcher's reply with melotts. Returns raw audio bytes
 * (melotts emits WAV; the client's decodeAudioData sniffs the container, so
 * storing them at the existing radio-audio/<id>.webm key replays fine
 * through the haze chain). Returns null on failure.
 */
export async function synthesizeDispatcherVoice(ai: Ai, text: string): Promise<Uint8Array | null> {
  try {
    const res = (await ai.run(TTS_MODEL, { prompt: text, lang: 'en' } as never)) as { audio?: string };
    const b64 = res?.audio;
    if (!b64) return null;
    const bytes = base64ToBytes(b64);
    return bytes.byteLength > 0 ? bytes : null;
  } catch (err) {
    console.error('[aiDispatcher] TTS failed:', (err as Error)?.message);
    return null;
  }
}

/** Rough spoken-duration estimate (s) from word count — for the TX row. */
export function estimateSpeechSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words * 0.42));
}
