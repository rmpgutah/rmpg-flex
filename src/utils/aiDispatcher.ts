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
import { log } from './logger';
import type { LookupRequest, ActionRequest, ActionType } from './dispatcherAwareness';

// App-level timeout for any Workers AI call. Without it a stalled model
// (Whisper/Llama/Aura-2/melotts) hangs the runDispatcher tail until the
// platform wall-clock fires, leaving the radio silent far longer than the
// existing .catch() fallbacks would. 15s is generous enough not to clip a
// legitimately slow turn; on reject the call's own fallback/catch degrades.
const AI_RUN_TIMEOUT_MS = 15_000;
function withAiTimeout<T>(p: Promise<T>, label: string, ms = AI_RUN_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`AI timeout: ${label}`)), ms)),
  ]);
}

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
// Deepgram Aura-2 speaker — the confirmed Dispatch voice, chosen by ear
// 2026-07-31 after auditioning all 40 speakers in AURA2_EN_VOICES.
// Measured: median F0 178 Hz; 90.4% RMS retained through the P25
// 300-3400Hz band (tied best of all 40); 5.3s on the reference
// announcement vs asteria's 8.4s — the fastest of the 23 female-register
// speakers, which recovers ~37% of channel time on every announcement.
//
// MUST be a valid aura-2-en speaker (see AURA2_EN_VOICES) — an Aura-1-only
// name errors the model and drops us to the robotic melotts fallback.
// MUST stay in sync with DEFAULT_VOICE_ID in client/src/utils/voiceCatalog.ts.
const DISPATCH_VOICE = 'harmonia';
// Valid @cf/deepgram/aura-2-en speakers (the full model enum). Used to validate
// an operator-chosen voice before it reaches the model, so a stale/invalid stored
// value can never knock the premium voice offline. NOTE: Aura-2 has a different
// roster than Aura-1 — asteria/luna/athena/hera/orion/arcas/orpheus/zeus exist in
// both, but stella/perseus/angus/helios are Aura-1 ONLY.
export const AURA2_EN_VOICES = new Set([
  'amalthea', 'andromeda', 'apollo', 'arcas', 'aries', 'asteria', 'athena', 'atlas',
  'aurora', 'callista', 'cora', 'cordelia', 'delia', 'draco', 'electra', 'harmonia',
  'helena', 'hera', 'hermes', 'hyperion', 'iris', 'janus', 'juno', 'jupiter', 'luna',
  'mars', 'minerva', 'neptune', 'odysseus', 'ophelia', 'orion', 'orpheus', 'pandora',
  'phoebe', 'pluto', 'saturn', 'thalia', 'theia', 'vesta', 'zeus',
]);

// The Aura-2 English TTS model id — exported so other voice surfaces (the
// client-facing /api/tts endpoint) synthesize through the SAME premium voice.
export const AURA2_EN_MODEL = TTS_PRIMARY_MODEL;

/**
 * Resolve a requested voice name to a valid Aura-2 speaker, coercing anything
 * unknown (an Aura-1 leftover, a browser persona name like "en-US-JennyNeural",
 * empty) to a known-good default. Single source of truth for both the radio
 * dispatcher and the /api/tts alert voice.
 */
export function resolveAura2Voice(name: string | null | undefined, fallback: string = DISPATCH_VOICE): string {
  const v = (name || '').trim().toLowerCase();
  return AURA2_EN_VOICES.has(v) ? v : fallback;
}

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
  /**
   * A CAD check the system ALREADY auto-ran from an OCR'd identifier (a plate,
   * VIN, or name read off the image), as a terse facts string. When present the
   * dispatcher reads this hit back instead of re-requesting the same check.
   */
  autoCheck?: string | null;
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
  /**
   * How confident the model is that it correctly understood what the unit said.
   * On 'low' the caller issues a 10-9 ("say again") readback — repeating dispatch's
   * best understanding so the unit can confirm/correct — and SUPPRESSES any
   * lookup/action so dispatch never runs a check or a CAD write on a guess.
   * Defaults to 'high' when the model omits it.
   */
  confidence?: 'high' | 'medium' | 'low';
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
const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

// Parse the model's self-reported understanding-confidence. Defaults to 'high'
// — the 10-9 readback is opt-in, so an omitted/garbage value never silences a
// transmission dispatch actually understood.
function parseConfidence(value: unknown): 'high' | 'medium' | 'low' {
  return typeof value === 'string' && (CONFIDENCE_LEVELS as readonly string[]).includes(value)
    ? (value as 'high' | 'medium' | 'low')
    : 'high';
}

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
  /**
   * Prosody/emotion shaping for the spoken reply (see shapeDelivery). Built by
   * the caller from the live safety read. Omit (or pass undefined) for flat,
   * unshaped delivery — the prior behavior.
   */
  delivery?: DeliveryProfile;
}

/** How forcefully the dispatcher should VOICE this reply. Drives shapeDelivery. */
export interface DeliveryProfile {
  /**
   * Spoken urgency: 'normal' = calm and even, 'elevated' = firm/direct,
   * 'high' = forceful and emphatic (emergency command voice). This is the
   * SPOKEN urgency, not the internal alarm level — covert duress is delivered
   * 'normal' so the voice never tips off a nearby suspect (the caller decides).
   */
  stress: 'normal' | 'elevated' | 'high';
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
- A record check the unit requests — you CAN run it. Set the "lookup" field and make "reply" a brief "stand by"; the result is read back automatically, and for a PLATE or PERSON hit the matching record file opens on the dispatcher's console (and on the requesting unit's own device). Supported lookup types: PLATE, PERSON (by name), WARRANT, PREMISE (alerts/hazards at an address), VIN (vehicle by VIN). For premise use {type:"premise", query:"<address>"}; for VIN {type:"vin", query:"<vin or last digits>"}.
- A LOCATION or ETA question about the asking unit ITSELF — "where am I?", "what's my twenty?", "10-20", "what's my ETA?", "how far am I out?", "time to the scene?" — you CAN answer from the unit's live GPS. Set "lookup" type "unit_location" (where they are) or "eta" (drive time to their assigned call); leave "query" empty (the unit is identified by who's transmitting) and make "reply" a brief "stand by". The computed answer is read back automatically — do NOT guess a location, beat, distance, or time yourself.
- A CALL STATUS question — "status on CFS26-0042", "what's the status of that call", "who's on <call>", "how's <call> going" — set "lookup" {type:"call_status", query:"<call number>"}; the live status/units/disposition is read back automatically.
- A CLOSEST-UNIT question — "who's closest to <address>", "nearest unit to <place>", "what do I have near <intersection>" — set "lookup" {type:"closest_unit", query:"<address>"}; the system geocodes it and names the nearest available unit by GPS.
- A "SAY AGAIN" to dispatch — "say again your last", "repeat your last", "10-9", "didn't copy your last" — set "lookup" {type:"last_dispatch", query:""}; dispatch's previous transmission is re-read automatically. Make "reply" a brief "stand by".
- A CAD WRITE the unit requests — you CAN do data entry. Set the "action" field:
    • STATUS change — "10-8 / in service", "10-7 / out of service", "show me out / out at <place> / on scene / arrived", "en route", "tied up" — action {type:"set_unit_status", unit:"<call-sign>", status:"<what they said>", location:"<place if given>"}.
    • START / CREATE a call — action {type:"create_call", incident_type:"<short type>", priority:"<P1|P2|P3|P4>", location_address:"<address>", description:"<details>", caller_name:"<if given>"}; the call number is read back automatically.
    • CLEAR / CLOSE a call ("clear me from <call>", "show <call> cleared", "10-8 from <call>") — action {type:"clear_call", call_number:"<call number, e.g. CFS26-00042>", disposition:"<outcome if given>"}.
    • DISPATCH BACKUP ("start me another unit", "10-78", "need backup on <call>") — action {type:"dispatch_backup", unit:"<requesting call-sign if known>", call_number:"<call number if given>"}; the system picks the nearest available unit and you read back who's responding.
    • ISSUE A BOLO ("put out a BOLO on …", "be on the lookout for …", "attempt to locate …") — action {type:"create_bolo", bolo_type:"person|vehicle|other", title:"<short headline>", subject_description:"<person details if any>", vehicle_description:"<vehicle details if any>", description:"<the rest>", priority:"<P1|P2|P3|P4>"}; the BOLO number is read back and it lands on the board for all units. The BOLO is issued under the REQUESTING unit's officer.
  Only set "action" when the unit clearly asked. If a required detail is missing, ask for it instead of guessing.
- If you are given OCR TEXT read from an image the unit sent, treat it as facts you may read back or use to fill a lookup/action — but never invent fields the OCR didn't contain. If you are ALSO given a CAD AUTO-CHECK block, the system already ran the check on the plate/VIN/name in that image — read that result back to the unit (warrants, stolen flag, owner) and do NOT request the same check again.
- Plain unit-to-unit chatter not directed at dispatch → a brief "copy" is enough.

UNDERSTANDING CONFIDENCE (10-9) — on EVERY transmission, set the "confidence" field to how sure you are that you correctly understood what the unit SAID: "high" | "medium" | "low". Use "low" when the transcript is garbled, fragmentary, contradictory, or has more than one plausible reading, or names a plate/address/name/call number you can't make out cleanly. When confidence is "low", DO NOT guess and DO NOT set a lookup or action — instead 10-9 the unit: repeat back your best understanding of what you heard and ask them to confirm or say again, e.g. "10-9 — I copy '<your best read of what they said>', say again to confirm." It is always better to read it back and re-confirm than to run a check or log a status on a mis-hear. EXCEPTION: never delay a clear emergency to re-confirm — answer urgently first.

OFFICER SAFETY ASSESSMENT — on EVERY transmission, set the "safety" field reading the unit's stress/duress: {"stress":"normal|elevated|high","duress":true|false,"reason":"<short>"}. Use "high" stress for shouting, calls for help, "shots fired", "officer down", "10-33", panic, or a frantic/breathless delivery. Set "duress":true if the unit may be coerced, in danger, or covertly signaling distress. When stress is high or duress is true, your reply MUST be urgent: acknowledge immediately, confirm help is rolling, and tell other units to hold traffic. Default to {"stress":"normal","duress":false} for routine traffic.

Common 10-codes: 10-4 acknowledged, 10-8 in service, 10-7 out of service, 10-20 location, 10-23 arrived, 10-28 plate check, 10-29 wants/warrants, 10-33 emergency/officer needs help, 10-76 en route, 10-78 need backup, 10-97 arrived on scene, code 4 = scene secure.

Never invent unit numbers, names, plates, warrants, call numbers, or facts you were not given in the snapshot or a lookup result. If you don't have a detail, ask for it briefly.`;

const FORMAT_INSTRUCTION = `Respond with ONLY a JSON object, no prose around it:
{"intent":"<status_update|out_at_location|backup_request|emergency|lookup_request|location_request|eta_request|call_status|closest_unit|say_again|data_entry|en_route|arrived|code4|chatter|unclear>","reply":"<exactly what dispatch says over the radio — one or two short sentences>","confidence":"high|medium|low","safety":{"stress":"normal|elevated|high","duress":false},"lookup":{"type":"plate|person|warrant|premise|vin|unit_location|eta|call_status|closest_unit|last_dispatch","query":"<value; empty for unit_location/eta/last_dispatch>"},"action":{"type":"set_unit_status|create_call|clear_call|dispatch_backup|create_bolo","unit":"<call-sign>","status":"<status>","location":"<place>","incident_type":"<type>","priority":"<P1|P2|P3|P4>","location_address":"<address>","description":"<details>","caller_name":"<name>","call_number":"<call #>","disposition":"<outcome>","bolo_type":"person|vehicle|other","title":"<bolo headline>","subject_description":"<person>","vehicle_description":"<vehicle>"}}
ALWAYS include "safety" and "confidence". Include "lookup" for a record check (plate/person/warrant/premise/vin), a unit_location/eta question about the asking unit (query empty), a call_status (query = call number), a closest_unit (query = address), or a last_dispatch "say again" (query empty). Include "action" ONLY for a status/call write; send only the fields that action type needs. Omit "lookup"/"action" otherwise.
If you are not sure what the unit said, set "confidence":"low", set intent to "unclear", OMIT "lookup"/"action", and make "reply" a 10-9 readback that repeats your best understanding and asks them to say again to confirm.`;

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

// ─── Speech-recognition vocabulary biasing ──────────────────
// Whisper is a free-running decoder: given a noisy, P25-hazed radio burst it
// will happily emit a real-but-wrong word ("Maya list" for "mileage"). The
// fix is its `initial_prompt` — a short priming text in the SAME style and
// vocabulary as the audio. Whisper biases its first decode window toward the
// terms it sees there, so feeding it the agency name, dispatch verbs, 10-codes,
// and (dynamically) the live call-signs + recent traffic makes it spell our
// domain right instead of guessing. This is the single biggest STT-quality
// lever and it costs nothing extra per call.

/**
 * Built-in domain glossary — the always-on baseline biasing text. Written as
 * natural radio-style prose (Whisper prompts work best as an *example* in the
 * target vocabulary, not a bare word list). Keep it tight: every char competes
 * for Whisper's ~224-token prompt budget against the live context appended
 * after it. Operator-specific terms (local streets, client/property names,
 * officer names) belong in the `stt_vocabulary` radio setting, not here.
 */
export const STT_DOMAIN_GLOSSARY =
  'RMPG Dispatch radio traffic for Rocky Mountain Protective Group, a security and law-enforcement agency in Salt Lake City, Utah. '
  + 'Standard police dispatch vocabulary: dispatch, control, copy, ten-four, 10-4, 10-8 in service, 10-7 out of service, 10-20 location, '
  + '10-76 en route, 10-78 backup, 10-97 on scene, code 4, show me out, stand by, be advised, BOLO, attempt to locate, '
  + 'license plate, registration, warrant, mileage, odometer, in service, out of service. '
  + 'Example traffic: "Dispatch, D19, show me out at 329 Penney Avenue, South Salt Lake. Can you update my mileage?"';

export interface TranscriptionContext {
  /** Operator-authored vocabulary hint (live, from the stt_vocabulary setting). */
  vocabulary?: string | null;
  /** Live call-signs relevant on the channel (recent speakers + on-duty units). */
  callSigns?: string[];
  /** Recent transcripts on this channel, oldest→newest, for term/style continuity. */
  recent?: string[];
}

// Whisper only honors roughly the LAST 224 tokens of the prompt — when the text
// is over budget it truncates from the FRONT. We exploit that: the fixed
// glossary leads, then operator vocab, then the clip-specific live context
// (call-signs + most-recent traffic) trails, so the most predictive material is
// what survives if anything is dropped. ~900 chars ≈ a safe ceiling.
const STT_PROMPT_MAX_CHARS = 900;

function clampTail(s: string, max: number): string {
  return s.length <= max ? s : s.slice(s.length - max);
}

/**
 * Compose the Whisper `initial_prompt` for one transmission: the built-in
 * glossary plus any live, channel-aware context. Everything is optional — with
 * an empty context this is just the domain glossary, which already fixes the
 * common mishears. Exported so it can be unit-tested / reused.
 */
export function buildTranscriptionPrompt(ctx: TranscriptionContext = {}): string {
  const parts: string[] = [STT_DOMAIN_GLOSSARY];

  const vocab = (ctx.vocabulary || '').trim();
  if (vocab) parts.push(`Local terms: ${vocab.replace(/\s+/g, ' ').slice(0, 600)}`);

  const signs = Array.from(new Set((ctx.callSigns || []).map((s) => (s || '').trim()).filter(Boolean))).slice(0, 24);
  if (signs.length) parts.push(`Units on the air: ${signs.join(', ')}.`);

  // Last two transmissions only — closest context to this clip, placed last.
  const recent = (ctx.recent || []).map((s) => (s || '').trim()).filter(Boolean).slice(-2);
  if (recent.length) parts.push(recent.join(' '));

  return clampTail(parts.join(' '), STT_PROMPT_MAX_CHARS);
}

/**
 * Transcribe a recorded transmission. Tries whisper-large-v3-turbo first
 * (higher quality, base64 `audio`, honors `initial_prompt`); if that throws or
 * returns empty it falls back to the base whisper model (array-of-bytes
 * `audio`, no prompt support). Both were verified to accept our WebM/Opus
 * recordings. Returns null only when both fail, so the caller simply skips the
 * reply rather than crashing the relay.
 *
 * `opts.initialPrompt` (build it with buildTranscriptionPrompt) biases the
 * decoder toward our domain vocabulary + live call-signs — the difference
 * between "update my mileage" and "update my Maya list".
 */
export async function transcribeTransmission(
  ai: Ai,
  audio: Uint8Array,
  opts: { initialPrompt?: string } = {},
): Promise<string | null> {
  const prompt = (opts.initialPrompt || '').trim();
  // Primary — whisper-large-v3-turbo (base64 string input). Three tuning knobs
  // beyond the raw audio:
  //   • initial_prompt — vocabulary biasing (see buildTranscriptionPrompt).
  //   • vad_filter — voice-activity detection trims the dead air around a keyed
  //     PTT burst, recovering short clips that would otherwise come back empty
  //     ("no transcript").
  //   • condition_on_previous_text:false — kills the repetition-hallucination
  //     loop that short, clipped radio bursts are especially prone to.
  try {
    const input: Record<string, unknown> = {
      audio: bytesToBase64(audio),
      language: 'en',
      vad_filter: true,
      condition_on_previous_text: false,
    };
    if (prompt) input.initial_prompt = prompt;
    const res = (await withAiTimeout(ai.run(WHISPER_MODEL, input as never), 'whisper-turbo')) as { text?: string };
    const text = (res?.text || '').trim();
    if (text) return text;
    log.warn('turbo whisper returned empty — trying base whisper');
  } catch (err) {
    log.warn('turbo whisper failed, trying base whisper', { err });
  }

  // Fallback — base whisper (classic array-of-bytes input; no prompt support).
  try {
    const res = (await withAiTimeout(ai.run(TRANSCRIBE_FALLBACK_MODEL, { audio: Array.from(audio) } as never), 'whisper-base')) as { text?: string };
    const text = (res?.text || '').trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    log.error('transcription failed (both models)', {}, err);
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
    const out = (await withAiTimeout(ai.run(VISION_MODEL, {
      image: Array.from(image),
      prompt:
        'You are reading an image for a police dispatcher. Transcribe ALL legible text exactly as printed — ' +
        'names, dates of birth, license/plate numbers, addresses, document titles. ' +
        'Output ONLY the transcribed text, no commentary. If nothing is legible, output an empty string.',
      max_tokens: 1024,
      temperature: 0.1,
    } as never), 'vision-ocr')) as { response?: unknown; description?: unknown };
    const text = String(out?.response ?? out?.description ?? '').trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    log.warn('OCR failed', { err });
    return null;
  }
}

// ─── Structured OCR (detect doc type + pull key fields) ─────
// The plain ocrImage() returns raw text the LLM *might* chain into a lookup.
// This pulls the identifiers OUT deterministically — doc type + the fields a
// dispatcher would actually run (plate, VIN, name/DOB, DL number) — so the
// caller can AUTO-run the matching CAD check instead of hoping the model does.
// One vision call; rawText is the same transcript ocrImage would return.

export type OcrDocType =
  | 'driver_license' | 'license_plate' | 'vehicle_registration' | 'document' | 'unknown';

export interface OcrExtraction {
  docType: OcrDocType;
  /** All legible text (same shape ocrImage returns). */
  rawText: string;
  /** Identifiers a dispatcher would run a check on. Empty fields omitted. */
  fields: {
    name?: string; dob?: string;
    dl_number?: string; dl_state?: string;
    plate?: string; plate_state?: string;
    vin?: string; make?: string; model?: string; year?: string;
  };
}

const OCR_DOC_TYPES: OcrDocType[] = ['driver_license', 'license_plate', 'vehicle_registration', 'document', 'unknown'];

function pickField(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim() && !/^(n\/?a|none|unknown|null)$/i.test(v.trim())) {
      return v.trim();
    }
  }
  return undefined;
}

/**
 * Read an image AND structure it: detect the document type and extract the
 * runnable identifiers. Best-effort — returns null on any failure (caller falls
 * back to plain ocrImage / skips). One vision-model call.
 */
export async function ocrExtractStructured(ai: Ai, image: Uint8Array): Promise<OcrExtraction | null> {
  if (!image || image.byteLength === 0 || image.byteLength > MAX_OCR_BYTES) return null;
  try {
    const out = (await withAiTimeout(ai.run(VISION_MODEL, {
      image: Array.from(image),
      prompt:
        'You are reading an image for a police dispatcher. Identify the document and extract its ' +
        'key identifiers. Respond with ONLY a JSON object, no prose:\n' +
        '{"doc_type":"driver_license|license_plate|vehicle_registration|document|unknown",' +
        '"raw_text":"<ALL legible text, exactly as printed>",' +
        '"name":"","dob":"","dl_number":"","dl_state":"","plate":"","plate_state":"",' +
        '"vin":"","make":"","model":"","year":""}\n' +
        'Fill only fields you can actually read; leave the rest empty strings. Never invent a value.',
      max_tokens: 1024,
      temperature: 0.1,
    } as never), 'vision-ocr-structured')) as { response?: unknown; description?: unknown };

    const raw = String(out?.response ?? out?.description ?? '').trim();
    if (!raw) return null;

    // Tolerant JSON extraction (the model may fence or pad it).
    let parsed: Record<string, unknown> | null = null;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>; } catch { /* not JSON */ }
    }
    if (!parsed) {
      // No JSON — treat the whole thing as raw OCR text, unstructured.
      return { docType: 'unknown', rawText: raw, fields: {} };
    }

    const dtRaw = typeof parsed.doc_type === 'string' ? parsed.doc_type.toLowerCase().trim() : 'unknown';
    const docType = (OCR_DOC_TYPES as string[]).includes(dtRaw) ? (dtRaw as OcrDocType) : 'unknown';
    const rawText = pickField(parsed, 'raw_text', 'text') || '';
    const fields: OcrExtraction['fields'] = {
      name: pickField(parsed, 'name', 'full_name'),
      dob: pickField(parsed, 'dob', 'date_of_birth'),
      dl_number: pickField(parsed, 'dl_number', 'license_number', 'dl'),
      dl_state: pickField(parsed, 'dl_state'),
      plate: pickField(parsed, 'plate', 'plate_number', 'license_plate'),
      plate_state: pickField(parsed, 'plate_state'),
      vin: pickField(parsed, 'vin'),
      make: pickField(parsed, 'make'),
      model: pickField(parsed, 'model'),
      year: pickField(parsed, 'year'),
    };
    // Drop undefined keys so callers can `if (fields.plate)` cleanly.
    for (const k of Object.keys(fields) as (keyof typeof fields)[]) {
      if (fields[k] == null) delete fields[k];
    }
    return { docType, rawText: rawText || raw, fields };
  } catch (err) {
    log.warn('structured OCR failed', { err });
    return null;
  }
}

/**
 * From a structured OCR result, pick the single best CAD lookup to auto-run.
 * Most-specific identifier first: plate → VIN → person-by-name. Returns null
 * when nothing runnable was extracted.
 */
export function lookupFromOcr(x: OcrExtraction): LookupRequest | null {
  const f = x.fields;
  if (f.plate && f.plate.replace(/[^A-Za-z0-9]/g, '').length >= 4) {
    return { type: 'plate', query: f.plate };
  }
  if (f.vin && f.vin.replace(/[^A-Za-z0-9]/g, '').length >= 6) {
    return { type: 'vin', query: f.vin };
  }
  if (f.name && (f.name.includes(' ') || f.name.trim().length >= 3)) {
    return { type: 'person', query: f.name };
  }
  return null;
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
  if (turn.autoCheck && turn.autoCheck.trim()) {
    lines.push('=== CAD AUTO-CHECK (already run from the image) ===');
    lines.push(turn.autoCheck.trim());
    lines.push('Read THIS result back to the unit — do not re-request the same check.');
    lines.push('===================================================');
  }
  lines.push('');
  lines.push(`New transmission from ${turn.speaker || 'an unidentified unit'}:`);
  lines.push(`"${turn.transcript}"`);
  lines.push('');
  lines.push(FORMAT_INSTRUCTION);
  return lines.join('\n');
}

const LOOKUP_TYPES = [
  'plate', 'person', 'warrant', 'premise', 'vin', 'unit_location', 'eta',
  'call_status', 'closest_unit', 'last_dispatch',
] as const;

// Lookups that need NO query — the subject is the transmitting unit (where am I
// / ETA) or the channel itself (say again). call_status / closest_unit DO need
// a query (the call number / the address), so they're not in this set.
const UNIT_CENTRIC_LOOKUPS = new Set(['unit_location', 'eta', 'last_dispatch']);

function parseLookup(value: unknown): LookupRequest | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const type = typeof obj.type === 'string' ? obj.type.toLowerCase() : '';
  const q = typeof obj.query === 'string' ? obj.query.trim() : '';
  if (!(LOOKUP_TYPES as readonly string[]).includes(type)) return undefined;
  if (!q && !UNIT_CENTRIC_LOOKUPS.has(type)) return undefined;
  return { type: type as LookupRequest['type'], query: q };
}

const ACTION_TYPES = ['set_unit_status', 'create_call', 'clear_call', 'dispatch_backup', 'create_bolo'] as const;

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
  if (type === 'create_bolo') {
    const title = str(obj, 'title');
    const description = str(obj, 'description');
    const subject_description = str(obj, 'subject_description');
    const vehicle_description = str(obj, 'vehicle_description');
    // Need at least one piece of detail to issue a BOLO.
    if (!title && !description && !subject_description && !vehicle_description) return undefined;
    return {
      type: type as ActionType,
      bolo_type: str(obj, 'bolo_type'), // person|vehicle|other; mapped server-side
      title, description, subject_description, vehicle_description,
      priority: str(obj, 'priority'),
    };
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
  const confidence = parseConfidence(obj.confidence);
  // A lookup OR an action OR a safety concern OR a low-confidence read with only
  // a holding reply is still actionable — a high-stress/duress read or a 10-9
  // "say again" must never be dropped just because the spoken reply was terse.
  if (reply || lookup || action || safety.stress !== 'normal' || safety.duress || confidence === 'low') {
    return {
      intent: (typeof obj.intent === 'string' ? obj.intent : 'general').trim() || 'general',
      reply: reply || (action ? 'Copy, stand by.' : 'Stand by.'),
      lookup,
      action,
      safety,
      confidence,
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
      const res = (await withAiTimeout(ai.run(model, { messages, ...opts } as never), `llm:${model}`)) as { response?: unknown };
      if (res?.response != null && res.response !== '') return res.response;
      log.warn(`${model} returned empty — trying next`);
    } catch (err) {
      log.warn(`${model} failed`, { err });
    }
  }
  return null;
}

/**
 * Clamp a spoken reply to a character budget WITHOUT chopping mid-word. A raw
 * slice(0, cap) makes the dispatcher's voice trail off ("...show you out at two
 * hund—"); this prefers the last sentence terminator within budget, else the
 * last word boundary, so the voice always finishes a complete thought.
 * Exported for testing.
 */
export function clampSpoken(text: string, cap: number): string {
  const s = (text || '').trim();
  if (s.length <= cap) return s;
  const w = s.slice(0, cap);
  // Last sentence terminator in the budget window.
  let cut = -1;
  for (let i = w.length - 1; i >= 0; i--) {
    const ch = w[i];
    if (ch === '.' || ch === '!' || ch === '?') { cut = i; break; }
  }
  // Use it only if it's not so early that we'd drop most of the line.
  if (cut >= Math.floor(cap * 0.5)) return w.slice(0, cut + 1).trim();
  const sp = w.lastIndexOf(' ');
  return (sp > 0 ? w.slice(0, sp) : w).trim();
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
  decision.reply = clampSpoken(decision.reply, cap);
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
    return clampSpoken(reply, cap);
  } catch (err) {
    log.error('phrase lookup failed', {}, err);
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
const SPOKEN_ACRONYMS = new Set(['PSO', 'CFS', 'DV', 'DUI', 'DWI', 'NCIC', 'EMS', 'ATL',
  'LEO', 'ID', 'HOA', 'LLC', 'ETA', 'RMPG', 'GPS', 'SGT', 'LT', 'CPT', 'SRO',
  'DMV', 'CAD', 'RMS', 'PD', 'SO', 'SLC', 'LE', 'SOP',
]);

const TEN_CODES: Record<string, string> = {
  '10-0': 'ten zero',
  '10-1': 'ten one',
  '10-2': 'ten two',
  '10-3': 'ten three',
  '10-4': 'ten four',
  '10-5': 'ten five',
  '10-6': 'ten six',
  '10-7': 'ten seven',
  '10-8': 'ten eight',
  '10-9': 'ten nine',
  '10-10': 'ten ten',
  '10-11': 'ten eleven',
  '10-12': 'ten twelve',
  '10-13': 'ten thirteen',
  '10-14': 'ten fourteen',
  '10-15': 'ten fifteen',
  '10-16': 'ten sixteen',
  '10-17': 'ten seventeen',
  '10-18': 'ten eighteen',
  '10-19': 'ten nineteen',
  '10-20': 'ten twenty',
  '10-21': 'ten twenty-one',
  '10-22': 'ten twenty-two',
  '10-23': 'ten twenty-three',
  '10-24': 'ten twenty-four',
  '10-25': 'ten twenty-five',
  '10-28': 'ten twenty-eight',
  '10-29': 'ten twenty-nine',
  '10-30': 'ten thirty',
  '10-31': 'ten thirty-one',
  '10-32': 'ten thirty-two',
  '10-33': 'ten thirty-three',
  '10-34': 'ten thirty-four',
  '10-35': 'ten thirty-five',
  '10-36': 'ten thirty-six',
  '10-37': 'ten thirty-seven',
  '10-38': 'ten thirty-eight',
  '10-39': 'ten thirty-nine',
  '10-40': 'ten forty',
  '10-41': 'ten forty-one',
  '10-42': 'ten forty-two',
  '10-43': 'ten forty-three',
  '10-44': 'ten forty-four',
  '10-45': 'ten forty-five',
  '10-46': 'ten forty-six',
  '10-47': 'ten forty-seven',
  '10-48': 'ten forty-eight',
  '10-49': 'ten forty-nine',
  '10-50': 'ten fifty',
  '10-51': 'ten fifty-one',
  '10-52': 'ten fifty-two',
  '10-53': 'ten fifty-three',
  '10-54': 'ten fifty-four',
  '10-55': 'ten fifty-five',
  '10-56': 'ten fifty-six',
  '10-57': 'ten fifty-seven',
  '10-58': 'ten fifty-eight',
  '10-59': 'ten fifty-nine',
  '10-60': 'ten sixty',
  '10-61': 'ten sixty-one',
  '10-62': 'ten sixty-two',
  '10-63': 'ten sixty-three',
  '10-64': 'ten sixty-four',
  '10-65': 'ten sixty-five',
  '10-66': 'ten sixty-six',
  '10-67': 'ten sixty-seven',
  '10-68': 'ten sixty-eight',
  '10-69': 'ten sixty-nine',
  '10-70': 'ten seventy',
  '10-71': 'ten seventy-one',
  '10-72': 'ten seventy-two',
  '10-73': 'ten seventy-three',
  '10-74': 'ten seventy-four',
  '10-75': 'ten seventy-five',
  '10-76': 'ten seventy-six',
  '10-77': 'ten seventy-seven',
  '10-78': 'ten seventy-eight',
  '10-79': 'ten seventy-nine',
  '10-80': 'ten eighty',
  '10-81': 'ten eighty-one',
  '10-82': 'ten eighty-two',
  '10-83': 'ten eighty-three',
  '10-84': 'ten eighty-four',
  '10-85': 'ten eighty-five',
  '10-86': 'ten eighty-six',
  '10-87': 'ten eighty-seven',
  '10-88': 'ten eighty-eight',
  '10-89': 'ten eighty-nine',
  '10-90': 'ten ninety',
  '10-91': 'ten ninety-one',
  '10-92': 'ten ninety-two',
  '10-93': 'ten ninety-three',
  '10-94': 'ten ninety-four',
  '10-95': 'ten ninety-five',
  '10-96': 'ten ninety-six',
  '10-97': 'ten ninety-seven',
  '10-98': 'ten ninety-eight',
  '10-99': 'ten ninety-nine',
  '10-100': 'ten hundred',
};

const PRIORITY_MAP: Record<string, string> = {
  'P1': 'Priority One',
  'P2': 'Priority Two',
  'P3': 'Priority Three',
  'P4': 'Priority Four',
};

const DIRECTIONS: Record<string, string> = {
  'NB': 'northbound',
  'SB': 'southbound',
  'EB': 'eastbound',
  'WB': 'westbound',
};

// Common words never expanded as acronyms
const COMMON_WORDS = new Set([
  'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN',
  'HAD', 'HER', 'HIS', 'ITS', 'MAY', 'WAS', 'WILL', 'WITH',
  'ABOUT', 'AFTER', 'BEEN', 'BEFORE', 'BETWEEN', 'COULD', 'DOES',
  'EACH', 'FROM', 'HAVE', 'INTO', 'MORE', 'MOST', 'MUCH', 'MUST',
  'NEAR', 'ONLY', 'OVER', 'SAME', 'SOME', 'SUCH', 'THAN', 'THAT',
  'THEM', 'THEN', 'THERE', 'THESE', 'THIS', 'THOSE', 'TIME',
  'UNDER', 'UPON', 'VERY', 'WERE', 'WHAT', 'WHEN', 'WHERE',
  'WHICH', 'WHILE', 'WOULD', 'YEAR', 'YOUR',
  'BLACK', 'WHITE', 'BROWN', 'BLUE', 'GRAY', 'GREY', 'GREEN',
  'RED', 'YELLOW', 'ORANGE', 'PURPLE', 'PINK', 'TAN', 'GOLD',
  'SILVER', 'MAROON', 'NAVY',
  'SALT', 'LAKE', 'CITY', 'UTAH', 'COUNTY',
  'ACTIVE', 'CLOSED', 'SEARCH', 'RECORDS', 'OFFICER',
]);

// ── Phonetic readback (NATO + spoken digits) ────────────────
// Dispatchers don't say "plate A-B-C-1-2-3" as run-together glyphs — they
// read it phonetically ("Alpha Bravo Charlie, one two three") so it survives
// a noisy P25 channel. We apply this to ALPHANUMERIC IDENTIFIERS only — never
// to ordinary words — so a plate/DL/VIN/warrant/case number reads back the way
// a real dispatcher voices it.
const NATO: Record<string, string> = {
  A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot',
  G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliet', K: 'Kilo', L: 'Lima',
  M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
  S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey',
  X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
};
// Spoken digits — "niner" for 9 is the radio convention (avoids confusion with
// "five"/foreign "nein" on a degraded channel).
const DIGIT_WORDS: Record<string, string> = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
  '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'niner',
};

/** Spell an alphanumeric identifier phonetically: letters→NATO, digits→spoken
 *  (niner for 9), separators dropped. "ABC123" → "Alpha Bravo Charlie one two three". */
export function spellAlnum(token: string): string {
  const out: string[] = [];
  for (const ch of token.toUpperCase()) {
    if (NATO[ch]) out.push(NATO[ch]);
    else if (DIGIT_WORDS[ch]) out.push(DIGIT_WORDS[ch]);
    // hyphen / space / other separators are dropped — they're not voiced
  }
  return out.join(' ');
}

/** Spell a run of digits one at a time: "12" → "one two" (for call-sign prefixes). */
function spellDigits(digits: string): string {
  return digits.split('').map((d) => DIGIT_WORDS[d] || d).join(' ');
}

// Keywords that introduce an alphanumeric identifier a dispatcher spells out.
// Deliberately EXCLUDES "unit" — call-signs are word-based ("12-Adam") and are
// handled separately (digits spelled, the word kept).
const ID_KEYWORD_RE =
  /\b(plate|license|licence|dl|d\.l\.|vin|warrant|case|tag|registration|reg|id)\s+(?:number\s+|no\.?\s+|#\s*)?([A-Za-z0-9][A-Za-z0-9-]{1,11})\b/gi;

// A standalone plate-like token: contains BOTH a letter and a digit, 4–8 chars,
// and is NOT part of a hyphenated sequence (so a hyphenated call number like
// "CFS26-00042" is left for the structured readback, not spelled glyph-by-glyph).
const PLATE_LIKE_RE =
  /(?<![A-Za-z0-9-])(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{4,8}(?![A-Za-z0-9-])/g;

// A word-based call-sign with a numeric prefix: "12-Adam" → "one two Adam".
const CALLSIGN_RE = /\b(\d{1,3})-([A-Z][a-z]+)\b/g;

export function humanizeForSpeech(text: string): string {
  let s = text;

  // 0. Phonetic identifiers FIRST, before acronym/abbrev steps could touch the
  //    letter runs. Spell out plate/DL/VIN/warrant/case numbers the dispatcher
  //    way. Keyword-introduced IDs are highest-precision; standalone plate-like
  //    tokens catch a plate read without the keyword; call-signs keep their word.
  s = s.replace(ID_KEYWORD_RE, (_m, kw, id) => `${kw} ${spellAlnum(id)}`);
  s = s.replace(PLATE_LIKE_RE, (m) => spellAlnum(m));
  s = s.replace(CALLSIGN_RE, (_m, d, w) => `${spellDigits(d)} ${w}`);

  // 1. Expand 10-codes
  s = s.replace(/\b10-\d{1,3}\b/g, (match) => {
    return TEN_CODES[match.toUpperCase()] || match;
  });

  // 2. "code-4" / "code4" → "code 4" so it isn't run together.
  s = s.replace(/\bcode[-\s]?(\d{1,2})\b/gi, 'code $1');

  // 3. Expand priority codes: "P1" → "Priority One"
  s = s.replace(/\bP[1-4]\b/gi, (match) => {
    return PRIORITY_MAP[match.toUpperCase()] || match;
  });

  // 4. Spell known UPPERCASE acronyms letter-by-letter
  s = s.replace(/\b[A-Z]{2,5}\b/g, (m) => {
    if (COMMON_WORDS.has(m)) return m;
    return SPOKEN_ACRONYMS.has(m) ? m.split('').join('. ') + '.' : m;
  });

  // 5. Expand street-type abbreviations (word-boundary, optional trailing dot).
  s = s.replace(/\b([A-Za-z]{2,5})\.?\b/g, (m, w) => {
    const full = STREET_ABBR[String(w).toLowerCase()];
    return full ? full : m;
  });

  // 6. NB/SB/EB/WB directionals
  s = s.replace(/\b(NB|SB|EB|WB)\b/gi, (match) => {
    return DIRECTIONS[match.toUpperCase()] || match;
  });

  // 7. Normalize CLOCK times: "14:32" → "14 32 hours". COLON-form only — the
  //    dispatcher's stated times come from mountainTimeNow() as "HH:MM", so this
  //    still voices them. The old bare-4-digit rule ("[01]\d[0-5]\d") also
  //    matched YEARS, plate fragments, and street numbers ("2024" → "20 24
  //    hours", "1200 block" → "12 00 hours block") — it's removed.
  s = s.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_, hour, min) => {
    return `${hour} ${min} hours`;
  });

  // 8. "enroute" → "en route", "onscene" → "on scene"
  s = s.replace(/\benroute\b/gi, 'en route');
  s = s.replace(/\bonscene\b/gi, 'on scene');

  return s;
}

// ── Delivery shaping (emotion / stress / enforcement tone) ──
// Aura-2 exposes NO emotion parameter — it infers pacing + emphasis from the
// TEXT (punctuation, capitalization). So we encode the desired delivery INTO
// the text: capitalized command phrases read with emphasis ("ALL UNITS, HOLD
// YOUR TRAFFIC"), and a hard exclamation close lands an emergency directive.
// This gives the voice dynamic flux + enforcement weight instead of a flat
// monotone. Curated to genuine command/urgency phrases — never ordinary words,
// and never single capital letters (which humanizeForSpeech would spell out).
const COMMAND_WORDS_RE =
  /\b(all units|hold(?: your)? traffic|clear the (?:air|channel|net)|emergency traffic|code (?:3|three)|shots fired|officer down|stand by|en route|rolling|help is (?:en route|rolling)|hold your fire)\b/gi;

/**
 * Shape a reply's PROSODY for the situation by rewriting its text — the only
 * emotion lever Aura-2 gives us. Calm and even on routine traffic; firm and
 * emphatic under stress; forceful with an emergency exclamation on 'high'.
 * A no-op for empty text or when no profile is supplied (today's flat delivery).
 * Exported for testing.
 */
export function shapeDelivery(text: string, profile?: DeliveryProfile): string {
  const s = (text || '').trim();
  if (!s || !profile) return s;
  if (profile.stress === 'high') {
    // Emphasize command words AND harden the close (trailing period → "!") so
    // the emergency directive lands with urgency.
    return s.replace(COMMAND_WORDS_RE, (m) => m.toUpperCase()).replace(/\.(\s*)$/, '!$1');
  }
  if (profile.stress === 'elevated') {
    // Firm, direct — emphasize commands without the emergency exclamation.
    return s.replace(COMMAND_WORDS_RE, (m) => m.toUpperCase());
  }
  return s; // normal — calm, as written
}

/**
 * Synthesize the dispatcher's reply as natural human speech. Primary voice is
 * Deepgram Aura-2 (returns raw MP3 via returnRawResponse); melotts is the
 * fallback so the dispatcher is never voiceless. The client's decodeAudioData
 * sniffs the container, so MP3/WAV bytes stored at radio-audio/<id>.webm both
 * replay fine through the haze chain. Returns null only if both fail.
 *
 * `opts.delivery` shapes the spoken prosody (emotion/stress/enforcement tone)
 * BEFORE the pronunciation pass, so the emphasis it adds survives into Aura-2.
 */
export async function synthesizeDispatcherVoice(
  ai: Ai,
  text: string,
  opts: DispatcherOptions = {},
): Promise<Uint8Array | null> {
  const speech = humanizeForSpeech(shapeDelivery(text, opts.delivery));
  // Validate the operator's voice against the model's real roster — an unknown
  // name (e.g. an Aura-1 leftover) would error the model and force the robotic
  // melotts fallback, so coerce it to the known-good default instead.
  const speaker = resolveAura2Voice(opts.voice);

  // Primary — Deepgram Aura-2. encoding:'mp3' is explicit so the bytes are
  // always a browser-decodable MP3 (decodeAudioData can't parse raw linear16
  // PCM, which is among Aura-2's selectable encodings) — guarantees the
  // dispatcher's voice actually plays, not just synthesizes.
  try {
    const resp = (await withAiTimeout(ai.run(
      TTS_PRIMARY_MODEL,
      { text: speech, speaker, encoding: 'mp3' } as never,
      { returnRawResponse: true } as never,
    ), 'aura-tts')) as unknown as Response;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.byteLength > 0) return bytes;
    console.warn('[aiDispatcher] aura returned empty — falling back to melotts');
  } catch (err) {
    console.warn('[aiDispatcher] aura TTS failed, falling back to melotts:', (err as Error)?.message);
  }

  // Fallback — melotts ({audio} base64).
  try {
    const res = (await withAiTimeout(ai.run(TTS_FALLBACK_MODEL, { prompt: speech, lang: 'en' } as never), 'melotts')) as { audio?: string };
    const b64 = res?.audio;
    if (!b64) return null;
    const bytes = base64ToBytes(b64);
    return bytes.byteLength > 0 ? bytes : null;
  } catch (err) {
    log.error('[aiDispatcher] TTS failed (both voices)', {}, err as Error);
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

/**
 * 10-9 ("say again") readback for a transmission dispatch isn't sure it heard
 * right. Standard radio practice: rather than guess, dispatch repeats back what
 * it THINKS it heard and asks the unit to confirm or correct — so an officer is
 * never acted on (plate run, status logged) from a mis-hear. The heard text is
 * trimmed to a short clause to keep the readback radio-brief.
 */
export function sayAgainReadback(callSign: string | null, heard: string): string {
  const who = callSign && callSign.trim() ? callSign.trim() : 'Unit calling';
  const h = (heard || '').replace(/\s+/g, ' ').trim();
  if (!h) return `${who}, dispatch did not copy your last — 10-9, say again.`;
  const snippet = h.length > 120 ? `${h.slice(0, 117).trimEnd()}…` : h;
  return `${who}, 10-9 — I copy: "${snippet}". Say again to confirm.`;
}
