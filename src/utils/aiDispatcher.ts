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
  /**
   * Officer-safety read on THIS transmission. The model assesses whether the
   * unit sounds stressed or under duress (panic language, calls for help,
   * incomplete/urgent speech). The caller escalates on 'high'/duress — see
   * VoiceHubDO. Always present; defaults to a calm read.
   */
  safety?: SafetyAssessment;
}

export interface SafetyAssessment {
  /** 'normal' | 'elevated' | 'high' — urgency/stress in the transmission. */
  stress: 'normal' | 'elevated' | 'high';
  /** True if the unit may be under duress / coerced / calling for help. */
  duress: boolean;
  /** One short clause on why (for the TX tag / supervisor alert). */
  reason?: string;
}

const STRESS_LEVELS = ['normal', 'elevated', 'high'] as const;

function parseSafety(value: unknown): SafetyAssessment {
  const fallback: SafetyAssessment = { stress: 'normal', duress: false };
  if (!value || typeof value !== 'object') return fallback;
  const obj = value as Record<string, unknown>;
  const stress = typeof obj.stress === 'string' && (STRESS_LEVELS as readonly string[]).includes(obj.stress)
    ? (obj.stress as SafetyAssessment['stress']) : 'normal';
  const duress = obj.duress === true || obj.duress === 'true';
  const reason = typeof obj.reason === 'string' && obj.reason.trim() ? obj.reason.trim().slice(0, 120) : undefined;
  return { stress, duress, reason };
}

/**
 * Live, operator-tunable overrides for one dispatch turn. Built by the caller
 * (VoiceHubDO) from the org-wide radio settings, so a change in Admin → Radio
 * takes effect on the very next transmission. Everything is optional — an
 * empty object reproduces the built-in defaults.
 */
export interface DispatcherOptions {
  /** Extra directives appended to DISPATCH_POLICY (operator persona knob). */
  persona?: string;
  /** Deepgram Aura-2 speaker for the reply voice. */
  voice?: string;
  /** LLM sampling temperature (0–1). */
  temperature?: number;
  /** Hard cap on spoken reply length (characters). */
  maxReplyChars?: number;
}

// Compose the system prompt: the built-in radio-procedure policy plus any
// operator persona directives. Persona is APPENDED (not replaced) so the core
// radio discipline + JSON contract always survive an operator edit.
function buildSystemPrompt(persona?: string): string {
  const extra = (persona || '').trim();
  return extra
    ? `${DISPATCH_POLICY}\n\nADDITIONAL OPERATOR DIRECTIVES (follow these; they refine the persona above but never the JSON output rules):\n${extra}`
    : DISPATCH_POLICY;
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
- A record check the unit requests — you CAN run it. Set the "lookup" field and make "reply" a brief "stand by"; the result is read back automatically. Supported lookup types: PLATE, PERSON (by name), WARRANT, PREMISE (alerts/hazards at an address), VIN (vehicle by VIN). For premise use {type:"premise", query:"<address>"}; for VIN {type:"vin", query:"<vin or last digits>"}.
- A CAD WRITE the unit requests — you CAN do data entry. Set the "action" field:
    • STATUS change — "10-8 / in service", "10-7 / out of service", "show me out / out at <place> / on scene / arrived", "en route", "tied up" — action {type:"set_unit_status", unit:"<call-sign>", status:"<what they said>", location:"<place if given>"}.
    • START / CREATE a call — action {type:"create_call", incident_type:"<short type>", priority:"<P1|P2|P3|P4>", location_address:"<address>", description:"<details>", caller_name:"<if given>"}; the call number is read back automatically.
    • CLEAR / CLOSE a call ("clear me from <call>", "show <call> cleared", "10-8 from <call>") — action {type:"clear_call", call_number:"<call number, e.g. CFS26-00042>", disposition:"<outcome if given>"}.
    • DISPATCH BACKUP ("start me another unit", "10-78", "need backup on <call>") — action {type:"dispatch_backup", unit:"<requesting call-sign if known>", call_number:"<call number if given>"}; the system picks the nearest available unit and you read back who's responding.
  Only set "action" when the unit clearly asked. If a required detail is missing, ask for it instead of guessing.
- If you are given OCR TEXT read from an image the unit sent, treat it as facts you may read back or use to fill a lookup/action — but never invent fields the OCR didn't contain.
- Plain unit-to-unit chatter not directed at dispatch → a brief "copy" is enough.

OFFICER SAFETY ASSESSMENT — on EVERY transmission, set the "safety" field reading the unit's stress/duress: {"stress":"normal|elevated|high","duress":true|false,"reason":"<short>"}. Use "high" stress for shouting, calls for help, "shots fired", "officer down", "10-33", panic, or a frantic/breathless delivery. Set "duress":true if the unit may be coerced, in danger, or covertly signaling distress. When stress is high or duress is true, your reply MUST be urgent: acknowledge immediately, confirm help is rolling, and tell other units to hold traffic. Default to {"stress":"normal","duress":false} for routine traffic.

Common 10-codes: 10-4 acknowledged, 10-8 in service, 10-7 out of service, 10-20 location, 10-23 arrived, 10-28 plate check, 10-29 wants/warrants, 10-33 emergency/officer needs help, 10-76 en route, 10-78 need backup, 10-97 arrived on scene, code 4 = scene secure.

Never invent unit numbers, names, plates, warrants, call numbers, or facts you were not given in the snapshot or a lookup result. If you don't have a detail, ask for it briefly.`;

const FORMAT_INSTRUCTION = `Respond with ONLY a JSON object, no prose around it:
{"intent":"<status_update|out_at_location|backup_request|emergency|lookup_request|data_entry|en_route|arrived|code4|chatter|unclear>","reply":"<exactly what dispatch says over the radio — one or two short sentences>","safety":{"stress":"normal|elevated|high","duress":false},"lookup":{"type":"plate|person|warrant|premise|vin","query":"<value>"},"action":{"type":"set_unit_status|create_call|clear_call|dispatch_backup","unit":"<call-sign>","status":"<status>","location":"<place>","incident_type":"<type>","priority":"<P1|P2|P3|P4>","location_address":"<address>","description":"<details>","caller_name":"<name>","call_number":"<call #>","disposition":"<outcome>"}}
ALWAYS include "safety". Include "lookup" ONLY for a record check. Include "action" ONLY for a status/call write; send only the fields that action type needs. Omit "lookup"/"action" otherwise.
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

const LOOKUP_TYPES = ['plate', 'person', 'warrant', 'premise', 'vin'] as const;

function parseLookup(value: unknown): LookupRequest | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const type = typeof obj.type === 'string' ? obj.type.toLowerCase() : '';
  const q = typeof obj.query === 'string' ? obj.query.trim() : '';
  if (!q || !(LOOKUP_TYPES as readonly string[]).includes(type)) return undefined;
  return { type: type as LookupRequest['type'], query: q };
}

const ACTION_TYPES = ['set_unit_status', 'create_call', 'clear_call', 'dispatch_backup'] as const;

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
  if (type === 'clear_call') {
    const call_number = str(obj, 'call_number');
    if (!call_number) return undefined;
    return { type: type as ActionType, call_number, disposition: str(obj, 'disposition') };
  }
  if (type === 'dispatch_backup') {
    const unit = str(obj, 'unit');
    const call_number = str(obj, 'call_number');
    if (!unit && !call_number) return undefined;
    return { type: type as ActionType, unit, call_number };
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
  const safety = parseSafety(obj.safety);
  // A lookup OR an action OR a safety concern with only a holding reply is
  // still actionable — a high-stress/duress read must never be dropped just
  // because the spoken reply was terse.
  if (reply || lookup || action || safety.stress !== 'normal' || safety.duress) {
    return {
      intent: (typeof obj.intent === 'string' ? obj.intent : 'general').trim() || 'general',
      reply: reply || (action ? 'Copy, stand by.' : 'Stand by.'),
      lookup,
      action,
      safety,
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
export async function decideDispatcherReply(
  ai: Ai,
  turn: DispatcherTurn,
  opts: DispatcherOptions = {},
): Promise<DispatcherDecision | null> {
  if (!turn.transcript.trim()) return null;
  const cap = opts.maxReplyChars ?? MAX_REPLY_CHARS;
  const response = await runLLM(
    ai,
    [
      { role: 'system', content: buildSystemPrompt(opts.persona) },
      { role: 'user', content: buildUserPrompt(turn) },
    ],
    { max_tokens: 260, temperature: opts.temperature ?? 0.3 },
  );
  if (response == null) return null;
  const decision = coerceDecision(response);
  if (!decision) return null;
  if (decision.reply.length > cap) {
    decision.reply = decision.reply.slice(0, cap).trimEnd();
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
  opts: DispatcherOptions = {},
): Promise<string> {
  const cap = opts.maxReplyChars ?? MAX_REPLY_CHARS;
  try {
    const response = await runLLM(
      ai,
      [
        { role: 'system', content: buildSystemPrompt(opts.persona) },
        {
          role: 'user',
          content:
            `${turn.speaker || 'A unit'} requested a ${lookup.type} check on "${lookup.query}".\n` +
            `CAD result:\n${resultText}\n\n` +
            `Read this back over the radio to the unit — terse, professional, the unit's call-sign first. ` +
            `State ONLY what the result says; never add facts. Respond with ONLY the spoken line, no JSON, no quotes.`,
        },
      ],
      { max_tokens: 160, temperature: opts.temperature ?? 0.2 },
    );
    let reply = coerceReplyText(response).replace(/```/g, '').trim();
    // If the model wrapped it in JSON anyway, recover the reply field.
    if (reply.startsWith('{')) reply = parseDecision(reply)?.reply ?? '';
    if (!reply) return resultText;
    return reply.length > cap ? reply.slice(0, cap).trimEnd() : reply;
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
export async function synthesizeDispatcherVoice(
  ai: Ai,
  text: string,
  opts: DispatcherOptions = {},
): Promise<Uint8Array | null> {
  const speech = humanizeForSpeech(text);
  const speaker = opts.voice || DISPATCH_VOICE;

  // Primary — Deepgram Aura-2 (raw MP3 Response).
  try {
    const resp = (await ai.run(
      TTS_PRIMARY_MODEL,
      { text: speech, speaker } as never,
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
