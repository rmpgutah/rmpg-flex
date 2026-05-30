// ============================================================
// RMPG Flex — AI Dispatcher (Workers AI voice-agent brain)
// ============================================================
// Turns a finished radio transmission into a spoken dispatcher reply:
//
//   recorded WebM/Opus clip
//        │  transcribeTransmission()      @cf/openai/whisper-large-v3-turbo
//        ▼
//   "12-Adam, show me out at 200 South on a traffic stop"
//        │  decideDispatcherReply()       @cf/meta/llama-4-scout (fallback 3.3-70b)
//        ▼  { intent, reply, lookup?, action? }   ← lookup = CAD read,
//   reply text                                       action = CAD write (data entry)
//
// The brain can also READ an image a unit sends (ocrImage → @cf/…vision),
// folding the OCR text into the same turn so it reads it back / files it.
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
import type { LookupRequest, ActionRequest, ActionType } from './dispatcherAwareness';

const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';
// Fallback transcriber — the stable base whisper. Both models were verified
// (2026-05-29) to transcribe our recorded WebM/Opus; turbo is higher quality
// (base64 `audio`) and base whisper is the safety net (array-of-bytes `audio`).
// NOTE: @cf/openai/gpt-4o-transcribe is NOT available on this account (5007).
const TRANSCRIBE_FALLBACK_MODEL = '@cf/openai/whisper';
// Brain: Llama 4 Scout — Meta's natively-multimodal, function-calling MoE.
// A real step up from llama-3.3-70b for agentic routing (it now decides
// real CAD writes, not just lookups) AND it can read images, so the same
// model powers the dispatcher's OCR (see ocrImage). llama-3.3-70b is kept
// as the text fallback so a Scout hiccup never leaves the radio silent.
const LLM_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
const LLM_FALLBACK_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
// Vision/OCR model — the proven serve-intake reader (verified on this
// account). Used when a unit sends an image (a license, a plate, a doc) so
// the dispatcher can read it back and file it. Scout can also see, but this
// dedicated reader is the lower-risk default for OCR.
const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
// Hard ceiling on an OCR image (bytes) — mirrors serve-intake's guard.
const MAX_OCR_BYTES = 6 * 1024 * 1024;
// Voice: Deepgram Aura-2 is a context-aware, genuinely human-sounding TTS
// (natural pacing, expressiveness, fillers) — a large step up from melotts.
// Verified live: returns raw MP3 (audio/mpeg) via returnRawResponse. melotts
// is kept as a fallback so the dispatcher is never voiceless. Pricing for the
// dispatcher's short replies is negligible (~300 chars/reply).
const TTS_PRIMARY_MODEL = '@cf/deepgram/aura-2-en';
const TTS_FALLBACK_MODEL = '@cf/myshell-ai/melotts';
// Deepgram Aura speaker. Calm, clear, professional female dispatcher voice.
// Other options: orion/zeus/perseus (male), athena/luna/hera (female).
const DISPATCH_VOICE = 'asteria';

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
  /** Text OCR'd from an image the unit sent this turn, if any (see ocrImage). */
  ocrText?: string | null;
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
  /**
   * If the unit asked the dispatcher to WRITE something to the CAD — log a
   * status ("show me out at 200 South") or start a call ("create a call,
   * suspicious vehicle at 5th and Main") — the model fills this and the
   * caller runs runAction(). `reply` is then replaced by the write's spoken
   * confirmation. This is the data-entry side of the dispatcher.
   */
  action?: ActionRequest;
}

// ─── DISPATCH POLICY (TUNE ME) ──────────────────────────────
// This is the operator-owned brain of the dispatcher. The default below
// is a working RMPG/Spillman-style policy; refine the persona, the agency
// name, the 10-codes, and the routing rules to match how RMPG actually
// runs the radio. Keep it tight — every extra rule is tokens per reply.
const DISPATCH_POLICY = `You are RMPG DISPATCH — the radio dispatcher for Rocky Mountain Protective Group, a private security / law-enforcement agency in Salt Lake City, Utah. You are calm, terse, and professional, exactly like a Spillman/Motorola CAD dispatcher. You speak ONLY what would go out over a P25 radio — never narrate, never explain yourself.

You hear EVERY transmission on the channel and you acknowledge or respond to each one. ANY time a unit addresses you directly — says "dispatch", "control", calls your name, or directs a statement or question at you — you MUST respond; never leave a direct address unanswered, even if only to acknowledge ("copy") or ask them to repeat. Match the unit's brevity. Use the unit's call-sign when you have it. You are given a live CAD board snapshot (active calls, units on duty, BOLOs, panic alerts) — USE it: reference the unit's actual assignment, name a real available unit when dispatching backup, and prioritize an active panic alert over everything. Use standard radio procedure:
- Acknowledge a status with "copy" or "10-4" and read back the key detail.
- A unit "out" / "out at <place>" → log the location and acknowledge ("copy, show you out at <place>, time is <the Current time given below, in Mountain Time>"). NEVER invent or guess a time — only ever state the Current time provided to you (it is already Mountain Time).
- A request for backup / "10-78" / "start me another unit" → acknowledge and dispatch the nearest available on-duty unit by call-sign from the board.
- An emergency / "shots fired" / "officer down" / "10-33" / "code 3" → respond with urgency, acknowledge, advise units to hold traffic, and that help is en route.
- A record check the unit requests — a license PLATE, a PERSON by name, or a WARRANT check — you CAN run it. Set the "lookup" field (type + the plate/name to search) and make "reply" a brief "stand by"; the result will be read back automatically.
- A CAD WRITE the unit requests — you CAN do data entry. Two writes are supported, set the "action" field:
    • A unit reporting a STATUS change — "10-8 / in service", "10-7 / out of service", "show me out / out at <place> / on scene / arrived", "en route", "tied up" — set action {type:"set_unit_status", unit:"<their call-sign>", status:"<what they said, e.g. 'out at' or '10-8'>", location:"<place if they gave one>"}. Make "reply" the acknowledgement.
    • A request to START / CREATE a call ("start a call", "create a call", "log a call", "I've got a <thing> at <place>") — set action {type:"create_call", incident_type:"<short type, e.g. 'suspicious vehicle'>", priority:"<P1 emergency | P2 urgent | P3 routine | P4 non-urgent>", location_address:"<address/place>", description:"<details>", caller_name:"<if given>"}. Make "reply" a brief acknowledgement; the real confirmation (with the call number) is read back automatically.
  Only set "action" when the unit clearly asked you to log a status or start a call. If a detail you need (the location for a new call, or which status) is missing, ask for it instead of guessing.
- If you are given OCR TEXT read from an image the unit sent (a driver's license, plate, registration, or document), treat it as facts you may read back or use to fill a lookup/action — but never invent fields the OCR didn't contain.
- Plain unit-to-unit chatter not directed at dispatch → a brief "copy" is enough.

Common 10-codes: 10-4 acknowledged, 10-8 in service, 10-7 out of service, 10-20 location, 10-23 arrived, 10-28 plate/registration check, 10-29 wants/warrants check, 10-76 en route, 10-78 need backup, 10-97 arrived on scene, code 4 = scene secure / no further help needed.

Never invent unit numbers, names, plates, warrants, or facts you were not given in the snapshot or a lookup result. If you don't have a detail, ask for it briefly.`;

const FORMAT_INSTRUCTION = `Respond with ONLY a JSON object, no prose around it:
{"intent":"<one of: status_update | out_at_location | backup_request | emergency | lookup_request | data_entry | en_route | arrived | code4 | chatter | unclear>","reply":"<exactly what dispatch says over the radio — one or two short sentences>","lookup":{"type":"plate|person|warrant","query":"<plate or name to run>"},"action":{"type":"set_unit_status|create_call","unit":"<call-sign>","status":"<radio status word/code>","location":"<place>","incident_type":"<type>","priority":"<P1|P2|P3|P4>","location_address":"<address>","description":"<details>","caller_name":"<name>"}}
Include "lookup" ONLY for a plate/person/warrant check (intent lookup_request, reply "stand by"). Include "action" ONLY when the unit asked you to log a status or start a call (intent data_entry); use type set_unit_status with only unit/status/location, or type create_call with only incident_type/priority/location_address/description/caller_name. Omit "lookup" and "action" entirely otherwise.
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

// ─── OCR (read an image a unit sent) ────────────────────────

/**
 * Read all text off an image (a driver's license, a plate, a registration,
 * a document) so the dispatcher can speak it back and/or use it for a
 * lookup or a call. Uses the proven vision model. Best-effort: returns null
 * on any failure or an out-of-range image, so the caller just skips the OCR
 * leg rather than breaking the relay.
 *
 * Returns plain extracted text. The dispatcher's reasoning turn folds this
 * in as "OCR TEXT" context (see DISPATCH_POLICY) — it is never treated as a
 * command on its own.
 */
export async function ocrImage(ai: Ai, image: Uint8Array): Promise<string | null> {
  if (!image || image.byteLength === 0 || image.byteLength > MAX_OCR_BYTES) return null;
  try {
    const out = (await ai.run(VISION_MODEL, {
      image: Array.from(image),
      prompt:
        'You are reading an image for a police dispatcher. Transcribe ALL legible text exactly as printed — ' +
        'names, dates of birth, license/plate numbers, addresses, document titles. ' +
        'Output ONLY the transcribed text, no commentary. If nothing is legible, output an empty string.',
      max_tokens: 1024,
      temperature: 0.1,
    } as never)) as { response?: unknown; description?: unknown };
    const text = String(out?.response ?? out?.description ?? '').trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    console.warn('[aiDispatcher] OCR failed:', (err as Error)?.message);
    return null;
  }
}

// ─── Reasoning + intent routing ─────────────────────────────

// The Worker runs in UTC, so any time the dispatcher states must be converted
// to RMPG's operating timezone (America/Denver, Mountain Time) — otherwise the
// AI guesses or echoes UTC and announces a time ~6h off. We inject the real MT
// time into every turn so "the time is …" is always correct and local.
export function mountainTimeNow(date: Date = new Date()): { time24: string; time12: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const h24 = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const time24 = `${h24}:${m}`;
  const time12 = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date);
  return { time24, time12 };
}

function buildUserPrompt(turn: DispatcherTurn): string {
  const lines: string[] = [];
  if (turn.channelName) lines.push(`Channel: ${turn.channelName}`);
  // Ground the dispatcher in the real local time (Mountain Time) so any
  // time it states ("show you out at … time is …") is correct, never UTC.
  const { time24, time12 } = mountainTimeNow();
  lines.push(`Current time (Mountain Time): ${time24} (${time12}). Use THIS for any time you state; never guess the time.`);
  lines.push('=== LIVE CAD BOARD ===');
  lines.push(turn.awareness);
  lines.push('======================');
  if (turn.recent.length) {
    lines.push('Recent traffic (oldest first):');
    for (const r of turn.recent) lines.push(`  ${r.speaker || 'Unit'}: ${r.text}`);
  }
  if (turn.ocrText && turn.ocrText.trim()) {
    lines.push('=== OCR TEXT (read from an image the unit sent) ===');
    lines.push(turn.ocrText.trim());
    lines.push('===================================================');
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

const ACTION_TYPES = ['set_unit_status', 'create_call'] as const;

// Pull a string field off a loose object (the model may emit '', null, or
// the wrong type). Returns undefined for anything not a non-empty string.
function str(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function parseAction(value: unknown): ActionRequest | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const type = typeof obj.type === 'string' ? obj.type.toLowerCase() : '';
  if (!(ACTION_TYPES as readonly string[]).includes(type)) return undefined;
  // Keep only the fields that belong to each action so a stray "unit" on a
  // create_call (or vice-versa) can't confuse the executor / policy gate.
  if (type === 'set_unit_status') {
    const unit = str(obj, 'unit');
    const status = str(obj, 'status');
    if (!unit || !status) return undefined;
    return { type: type as ActionType, unit, status, location: str(obj, 'location') };
  }
  // create_call
  const incident_type = str(obj, 'incident_type');
  const location_address = str(obj, 'location_address') ?? str(obj, 'location');
  if (!incident_type || !location_address) return undefined;
  return {
    type: type as ActionType,
    incident_type,
    location_address,
    priority: str(obj, 'priority'),
    description: str(obj, 'description'),
    caller_name: str(obj, 'caller_name'),
  };
}

// Build a decision from an already-structured object. Workers AI's
// llama-3.3 returns `response` as a PARSED OBJECT when the output is JSON
// (not a string), so this is the COMMON path, not a fallback.
function decisionFromObject(obj: Record<string, unknown>): DispatcherDecision | null {
  const reply = (typeof obj.reply === 'string' ? obj.reply : '').trim();
  const lookup = parseLookup(obj.lookup);
  const action = parseAction(obj.action);
  // A lookup OR an action with only a holding reply is still actionable.
  if (reply || lookup || action) {
    return {
      intent: (typeof obj.intent === 'string' ? obj.intent : 'general').trim() || 'general',
      reply: reply || (action ? 'Copy, stand by.' : 'Stand by.'),
      lookup,
      action,
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
 * Run the reasoning model with an automatic fallback: Llama 4 Scout first,
 * the proven llama-3.3-70b if Scout throws or returns nothing. Returns the
 * raw `response` (object when the model emits JSON, string otherwise) or
 * null if BOTH fail — the dispatcher then degrades to a verbal ack.
 */
async function runLLM(
  ai: Ai,
  messages: Array<{ role: string; content: string }>,
  opts: { max_tokens: number; temperature: number },
): Promise<unknown> {
  for (const model of [LLM_MODEL, LLM_FALLBACK_MODEL]) {
    try {
      const res = (await ai.run(model, { messages, ...opts } as never)) as { response?: unknown };
      if (res?.response != null && res.response !== '') return res.response;
      console.warn(`[aiDispatcher] ${model} returned empty — trying next`);
    } catch (err) {
      console.warn(`[aiDispatcher] ${model} failed:`, (err as Error)?.message);
    }
  }
  return null;
}

/**
 * Decide what dispatch says back. Returns null when the model fails or
 * elects to stay silent (empty reply).
 */
export async function decideDispatcherReply(ai: Ai, turn: DispatcherTurn): Promise<DispatcherDecision | null> {
  if (!turn.transcript.trim()) return null;
  const response = await runLLM(
    ai,
    [
      { role: 'system', content: DISPATCH_POLICY },
      { role: 'user', content: buildUserPrompt(turn) },
    ],
    { max_tokens: 260, temperature: 0.3 },
  );
  if (response == null) return null;
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
    const response = await runLLM(
      ai,
      [
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
      { max_tokens: 160, temperature: 0.2 },
    );
    let reply = coerceReplyText(response).replace(/```/g, '').trim();
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

// ── Pronunciation: make text read like a human dispatcher ───
// TTS reads raw glyphs literally ("10-4" → "ten dash four", "Blvd" →
// "blvd"). We rewrite the radio shorthand into spoken English so the voice
// pronounces it the way a real dispatcher would say it out loud.
const STREET_ABBR: Record<string, string> = {
  st: 'Street', ave: 'Avenue', blvd: 'Boulevard', rd: 'Road', dr: 'Drive',
  ln: 'Lane', ct: 'Court', pkwy: 'Parkway', hwy: 'Highway', ste: 'Suite',
};

// Acronyms a dispatcher SPELLS OUT on the air ("PSO Client Request" is said
// "P. S. O. Client Request", never the word "Pso"). Curated to unambiguous
// letter-spoken codes — BOLO is deliberately absent (it's said as a word).
const SPOKEN_ACRONYMS = new Set(['PSO', 'CFS', 'DV', 'DUI', 'DWI', 'NCIC', 'EMS', 'ATL']);

export function humanizeForSpeech(text: string): string {
  let s = text;
  // 10-codes → "ten ...": "10-4" → "ten 4" (TTS then says "ten four"),
  // "10-78" → "ten 78" ("ten seventy-eight"). Avoids "ten dash four".
  s = s.replace(/\b10-(\d{1,3})\b/g, 'ten $1');
  // "code-4" / "code4" → "code 4" so it isn't run together.
  s = s.replace(/\bcode[-\s]?(\d{1,2})\b/gi, 'code $1');
  // Spell known UPPERCASE acronyms letter-by-letter ("PSO" → "P. S. O.") so
  // Aura-2 announces the letters. Runs BEFORE the street-abbr pass so the
  // resulting single letters aren't re-matched.
  s = s.replace(/\b[A-Z]{2,5}\b/g, (m) =>
    SPOKEN_ACRONYMS.has(m) ? m.split('').join('. ') + '.' : m,
  );
  // Expand street-type abbreviations (word-boundary, optional trailing dot).
  s = s.replace(/\b([A-Za-z]{2,5})\.?\b/g, (m, w) => {
    const full = STREET_ABBR[String(w).toLowerCase()];
    return full ? full : m;
  });
  return s;
}

/**
 * Synthesize the dispatcher's reply as natural human speech. Primary voice is
 * Deepgram Aura-2 (returns raw MP3 via returnRawResponse); melotts is the
 * fallback so the dispatcher is never voiceless. The client's decodeAudioData
 * sniffs the container, so MP3/WAV bytes stored at radio-audio/<id>.webm both
 * replay fine through the haze chain. Returns null only if both fail.
 */
export async function synthesizeDispatcherVoice(ai: Ai, text: string): Promise<Uint8Array | null> {
  const speech = humanizeForSpeech(text);

  // Primary — Deepgram Aura-2 (raw MP3 Response).
  try {
    const resp = (await ai.run(
      TTS_PRIMARY_MODEL,
      { text: speech, speaker: DISPATCH_VOICE } as never,
      { returnRawResponse: true } as never,
    )) as unknown as Response;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.byteLength > 0) return bytes;
    console.warn('[aiDispatcher] aura returned empty — falling back to melotts');
  } catch (err) {
    console.warn('[aiDispatcher] aura TTS failed, falling back to melotts:', (err as Error)?.message);
  }

  // Fallback — melotts ({audio} base64).
  try {
    const res = (await ai.run(TTS_FALLBACK_MODEL, { prompt: speech, lang: 'en' } as never)) as { audio?: string };
    const b64 = res?.audio;
    if (!b64) return null;
    const bytes = base64ToBytes(b64);
    return bytes.byteLength > 0 ? bytes : null;
  } catch (err) {
    console.error('[aiDispatcher] TTS failed (both voices):', (err as Error)?.message);
    return null;
  }
}

/** Rough spoken-duration estimate (s) from word count — for the TX row. */
export function estimateSpeechSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words * 0.42));
}

// ─── "Always answer a direct address" guarantee ─────────────
// A unit talking TO dispatch must never be met with silence, even if the
// LLM call fails or returns nothing. We detect a direct address from the
// transcript and, as a last resort, speak a deterministic acknowledgment.

// Spoken forms of "dispatch": the word itself, common aliases, and the
// fillers units use to open a call to dispatch ("control", "comms", "base").
const DISPATCH_ADDRESS_RE = /\b(dispatch|dispatcher|control|comm?s|base|radio)\b/i;

/**
 * True when the transmission is plausibly directed at dispatch — either it
 * names dispatch/control, or it's a question (units rarely ask the open air).
 * Deliberately liberal: a false positive just means an extra "copy", while a
 * false negative means ignoring an officer who called us. We err toward
 * answering.
 */
export function isAddressedToDispatch(transcript: string): boolean {
  const t = (transcript || '').trim();
  if (!t) return false;
  if (DISPATCH_ADDRESS_RE.test(t)) return true;
  // A direct question ("what's my next call?", "do you copy?") is an address.
  if (/\?\s*$/.test(t) || /^\s*(what|where|when|who|can you|do you|is there|are there|any)\b/i.test(t)) return true;
  return false;
}

/**
 * Deterministic last-resort reply for a direct address the model couldn't
 * answer — guarantees dispatch is never silent when called. Acknowledges
 * receipt and asks for a repeat rather than pretending to have an answer.
 */
export function fallbackAcknowledgement(callSign: string | null): string {
  const who = callSign && callSign.trim() ? callSign.trim() : 'Unit calling';
  return `${who}, dispatch copies — go ahead with your traffic.`;
}
