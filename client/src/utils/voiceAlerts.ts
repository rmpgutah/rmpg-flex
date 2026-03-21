// ============================================================
// RMPG Flex — Voice-Synthesized Safety Alerts
// Browser-native SpeechSynthesis API for automated dispatch
// safety alerts. Female voice, queued announcements, respects
// both the master sound toggle and a dedicated voice toggle.
// Follows Spillman Flex cadence: crisp, urgent, sequential.
// ============================================================

import { playToneAsync } from './dispatchTones';

// ─── Types ──────────────────────────────────────────────────

/** Screening result shape (mirrors SafetyScreening.tsx) */
interface ScreeningResult {
  persons: Array<{
    person: {
      id: number;
      first_name: string;
      last_name: string;
      caution_flags?: string;
      is_sex_offender?: boolean;
      has_criminal_history?: boolean;
      gang_affiliation?: string;
      watchlist_match?: string;
    };
    warrants: Array<{ id: number; status: string }>;
  }>;
  directWarrantHits: Array<{ id: number }>;
  ofacHits: Array<{ name: string }>;
  utahWarrantHits?: Array<{ warrant_id: string }>;
  premiseWarnings: string[];
  hasWarnings: boolean;
}

/** Call flag shape (subset of CallForService) */
interface CallFlags {
  id?: string;
  weapons_involved?: string;
  domestic_violence?: boolean;
  mental_health_crisis?: boolean;
  felony_in_progress?: boolean;
  officer_safety_caution?: boolean;
  gang_related?: boolean;
  hazmat?: boolean;
  vehicle_pursuit?: boolean;
  foot_pursuit?: boolean;
  ems_requested?: boolean;
  k9_requested?: boolean;
  drugs_involved?: boolean;
  alcohol_involved?: boolean;
  injuries_reported?: boolean;
  zone?: string;
  beat?: string;
  cross_street?: string;
}

interface VoicePhrase {
  text: string;
}

// ─── Constants ──────────────────────────────────────────────

/** localStorage keys */
const VOICE_ALERTS_KEY = 'rmpg-voice-alerts';
const VOICE_SPEED_KEY = 'rmpg-voice-speed';     // 'slow' | 'normal' | 'fast'
const VOICE_VOLUME_KEY = 'rmpg-voice-volume';    // 0.0 - 1.0

/** Inter-phrase pause in milliseconds — tight for rapid-fire dispatch cadence */
const PHRASE_GAP_MS = 200;

/** Post-tone pause before speech begins */
const TONE_GAP_MS = 250;

/** Deduplication cache TTL (60 seconds) */
const DEDUP_TTL_MS = 60_000;

/** Priority urgency levels for preemption (lower = more urgent) */
const PRIORITY_URGENCY: Record<string, number> = {
  PANIC: 0, P1: 1, P2: 2, P3: 3, P4: 4, INFO: 5,
};

/** User-configurable speed presets */
const SPEED_PRESETS: Record<string, number> = {
  slow: 0.85,
  normal: 1.05,
  fast: 1.2,
};

/** Base speech configuration */
function getSpeechRate(): number {
  try {
    const pref = localStorage.getItem(VOICE_SPEED_KEY) || 'normal';
    return SPEED_PRESETS[pref] ?? SPEED_PRESETS.normal;
  } catch { return SPEED_PRESETS.normal; }
}

function getSpeechVolume(): number {
  try {
    const v = parseFloat(localStorage.getItem(VOICE_VOLUME_KEY) || '0.95');
    return isNaN(v) ? 0.95 : Math.max(0, Math.min(1, v));
  } catch { return 0.95; }
}

/**
 * Female dispatcher pitch — slightly lower than default for authority.
 * Real dispatchers sound calm, composed, and authoritative — not chirpy.
 * 0.95 on most TTS engines produces a mature female voice vs. the
 * default 1.0 which sounds younger/higher.
 */
const SPEECH_PITCH = 0.95;

/** Priority-based speech parameters — adjusts rate/pitch/volume for urgency level */
interface PrioritySpeechParams {
  rateMultiplier: number;  // multiplied against user's base rate
  pitchOffset: number;     // added to base pitch
  volumeMultiplier: number;
}

/**
 * Priority tuning: dispatchers get slightly MORE clipped (faster) and
 * MORE authoritative (lower pitch) as urgency increases — the opposite
 * of panic. Real dispatchers lower their voice and tighten delivery
 * when things get serious. Only PANIC breaks this pattern (higher pitch
 * signals extreme urgency).
 */
const PRIORITY_PARAMS: Record<string, PrioritySpeechParams> = {
  PANIC: { rateMultiplier: 1.15, pitchOffset: 0.08, volumeMultiplier: 1.0 },
  P1:    { rateMultiplier: 1.08, pitchOffset: -0.03, volumeMultiplier: 1.0 },
  P2:    { rateMultiplier: 1.0,  pitchOffset: 0,     volumeMultiplier: 0.95 },
  P3:    { rateMultiplier: 0.95, pitchOffset: 0.02,  volumeMultiplier: 0.9 },
  P4:    { rateMultiplier: 0.9,  pitchOffset: 0.03,  volumeMultiplier: 0.85 },
};

// ─── Voice Selection ────────────────────────────────────────

let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesLoaded = false;

/**
 * Select the best available female voice for dispatcher-quality speech.
 *
 * Voice quality tiers (from most to least natural):
 *   1. Neural/Premium voices (macOS Sequoia "Premium", Windows 11 Neural, Chrome Neural)
 *   2. Enhanced voices (macOS "Enhanced" variants)
 *   3. Standard named female voices
 *   4. Any English female voice
 *   5. Any English voice (fallback)
 *
 * For dispatcher use, we prefer voices that are:
 *   - Female (industry standard for dispatch)
 *   - US English (correct pronunciation of street names, codes)
 *   - Lower/mature register (not chirpy or childlike)
 *   - Neural/premium quality (natural prosody, not robotic)
 */
function selectFemaleVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice && voicesLoaded) return cachedVoice;
  if (!isSpeechAvailable()) return null;

  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  voicesLoaded = true;

  // Score each voice — higher score = better choice
  const scored = voices
    .filter(v => v.lang.startsWith('en'))
    .map(v => {
      let score = 0;
      const name = v.name.toLowerCase();

      // ── Quality tier (most important) ──
      if (name.includes('premium'))      score += 1000;  // macOS Sequoia neural voices
      if (name.includes('enhanced'))     score += 800;   // macOS Enhanced voices
      if (name.includes('neural'))       score += 900;   // Windows 11 Neural voices
      if (name.includes('online'))       score += 700;   // Edge Online (cloud neural)
      if (name.includes('natural'))      score += 850;   // Natural variant voices

      // ── Female voice names (dispatch standard) ──
      // macOS voices
      if (name.includes('ava'))          score += 200;   // Ava — mature, authoritative
      if (name.includes('zoe'))          score += 190;   // Zoe — clear, professional
      if (name.includes('samantha'))     score += 180;   // Samantha — classic macOS
      if (name.includes('allison'))      score += 170;   // Allison — neutral US
      if (name.includes('susan'))        score += 160;   // Susan — UK but clear
      if (name.includes('karen'))        score += 150;   // Karen — AU English
      if (name.includes('kate'))         score += 140;   // Kate — UK English
      if (name.includes('victoria'))     score += 130;   // Victoria — formal
      if (name.includes('tessa'))        score += 120;   // Tessa — SA English
      // Windows voices
      if (name.includes('jenny'))        score += 195;   // Jenny — Windows 11 neural (excellent)
      if (name.includes('aria'))         score += 185;   // Aria — Windows neural
      if (name.includes('zira'))         score += 160;   // Zira — classic Windows
      if (name.includes('hazel'))        score += 155;   // Hazel — UK
      // Chrome/Google voices
      if (name.includes('google') && name.includes('female')) score += 170;

      // ── US English preference ──
      if (v.lang === 'en-US')            score += 50;
      if (v.lang.startsWith('en-US'))    score += 40;
      if (v.lang.startsWith('en-GB'))    score += 20;
      if (v.lang.startsWith('en-AU'))    score += 15;

      // ── Penalize male voices ──
      if (name.includes('daniel'))       score -= 500;
      if (name.includes('alex'))         score -= 500;
      if (name.includes('david'))        score -= 500;
      if (name.includes('tom'))          score -= 500;
      if (name.includes('fred'))         score -= 500;
      if (name.includes('ralph'))        score -= 500;
      if (name.includes('guy'))          score -= 500;
      if (name.includes('rishi'))        score -= 500;
      if (name.includes('lee'))          score -= 500;
      if (name.includes('male') && !name.includes('female')) score -= 500;

      // ── Penalize non-human / novelty voices ──
      if (name.includes('whisper'))      score -= 300;
      if (name.includes('grandm'))       score -= 300;
      if (name.includes('junior'))       score -= 300;
      if (name.includes('bells'))        score -= 300;
      if (name.includes('organ'))        score -= 300;
      if (name.includes('cellos'))       score -= 300;
      if (name.includes('trinoids'))     score -= 300;
      if (name.includes('bad news'))     score -= 300;
      if (name.includes('good news'))    score -= 300;
      if (name.includes('bubbles'))      score -= 300;
      if (name.includes('pipe'))         score -= 300;
      if (name.includes('boing'))        score -= 300;
      if (name.includes('bahh'))         score -= 300;
      if (name.includes('deranged'))     score -= 300;
      if (name.includes('hysterical'))   score -= 300;

      return { voice: v, score };
    })
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0 && scored[0].score > -100) {
    cachedVoice = scored[0].voice;
    console.log(`[VoiceAlerts] Selected voice: "${cachedVoice.name}" (${cachedVoice.lang}) score=${scored[0].score}`);
    // Log top 3 for debugging
    scored.slice(0, 3).forEach((s, i) => {
      console.log(`  [${i + 1}] "${s.voice.name}" (${s.voice.lang}) score=${s.score}`);
    });
    return cachedVoice;
  }

  // Fallback candidates in priority order (legacy path)
  const candidates: Array<(v: SpeechSynthesisVoice) => boolean> = [
    (v) => v.lang.startsWith('en-US'),
    (v) => v.lang.startsWith('en'),
  ];

  for (const test of candidates) {
    const match = voices.find(test);
    if (match) {
      cachedVoice = match;
      console.log(`[VoiceAlerts] Selected voice: "${match.name}" (${match.lang})`);
      return cachedVoice;
    }
  }

  // Ultimate fallback — guard against empty voices array
  if (voices.length > 0) {
    cachedVoice = voices[0];
    console.log(`[VoiceAlerts] Fallback voice: "${voices[0].name}" (${voices[0].lang})`);
  }
  return cachedVoice;
}

// Pre-load voices when module initializes (one-time listener to avoid leak)
let _voicesListenerRegistered = false;
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  if (!_voicesListenerRegistered) {
    _voicesListenerRegistered = true;
    speechSynthesis.addEventListener('voiceschanged', () => {
      cachedVoice = null;
      voicesLoaded = false;
      selectFemaleVoice();
    }, { once: false }); // Intentionally persistent — voices can change mid-session (e.g., language pack install)
  }
  // Try immediate load (some browsers have voices ready synchronously)
  selectFemaleVoice();
}

// ─── Toggle Checks ──────────────────────────────────────────

function isSpeechAvailable(): boolean {
  return typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && typeof SpeechSynthesisUtterance !== 'undefined';
}

function isVoiceEnabled(): boolean {
  try {
    return localStorage.getItem('rmpg-sound') !== 'false'
      && localStorage.getItem(VOICE_ALERTS_KEY) !== 'false';
  } catch { return true; }
}

export function setVoiceAlertsEnabled(enabled: boolean): void {
  try { localStorage.setItem(VOICE_ALERTS_KEY, String(enabled)); } catch { /* ignore */ }
}

export function getVoiceAlertsEnabled(): boolean {
  try { return localStorage.getItem(VOICE_ALERTS_KEY) !== 'false'; } catch { return true; }
}

/** Set voice speed preference: 'slow', 'normal', or 'fast' */
export function setVoiceSpeed(speed: 'slow' | 'normal' | 'fast'): void {
  try { localStorage.setItem(VOICE_SPEED_KEY, speed); } catch { /* ignore */ }
}

export function getVoiceSpeed(): string {
  try { return localStorage.getItem(VOICE_SPEED_KEY) || 'normal'; } catch { return 'normal'; }
}

/** Set voice volume: 0.0 to 1.0 */
export function setVoiceVolume(volume: number): void {
  try { localStorage.setItem(VOICE_VOLUME_KEY, String(Math.max(0, Math.min(1, volume)))); } catch { /* ignore */ }
}

export function getVoiceVolume(): number {
  return getSpeechVolume();
}

// ─── Deduplication Cache ────────────────────────────────────

const announcedCache = new Map<string, number>();

function wasRecentlyAnnounced(key: string): boolean {
  const ts = announcedCache.get(key);
  if (!ts) return false;
  if (Date.now() - ts > DEDUP_TTL_MS) {
    announcedCache.delete(key);
    return false;
  }
  return true;
}

function markAnnounced(key: string): void {
  announcedCache.set(key, Date.now());
  // Prune old entries periodically
  if (announcedCache.size > 100) {
    const now = Date.now();
    for (const [k, t] of announcedCache) {
      if (now - t > DEDUP_TTL_MS) announcedCache.delete(k);
    }
  }
}

// ─── Speech Queue (with priority preemption) ────────────────

interface QueuedBatch {
  phrases: VoicePhrase[];
  priority: string;
}

let activePriority: string | undefined;
let phraseQueue: QueuedBatch[] = [];
let isSpeaking = false;

/** Last announced batch — for repeat functionality */
let lastAnnouncement: { phrases: VoicePhrase[]; priority: string; timestamp: number } | null = null;

function speakPhrase(phrase: VoicePhrase): Promise<void> {
  return new Promise((resolve) => {
    if (!isSpeechAvailable()) { resolve(); return; }

    // Run pronunciation improvements on the text before speaking
    const spokenText = improvePronounciation(phrase.text);
    const utterance = new SpeechSynthesisUtterance(spokenText);
    const voice = selectFemaleVoice();
    if (voice) utterance.voice = voice;

    // Apply priority-based speech parameters combined with user preferences
    const baseRate = getSpeechRate();
    const baseVolume = getSpeechVolume();
    const params = activePriority ? PRIORITY_PARAMS[activePriority] : undefined;
    utterance.rate = params ? baseRate * params.rateMultiplier : baseRate;
    utterance.pitch = SPEECH_PITCH + (params?.pitchOffset ?? 0);
    utterance.volume = params ? baseVolume * params.volumeMultiplier : baseVolume;

    utterance.lang = 'en-US';
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    speechSynthesis.speak(utterance);
  });
}

async function processQueue(): Promise<void> {
  if (isSpeaking) return;
  isSpeaking = true;

  while (phraseQueue.length > 0) {
    const batch = phraseQueue.shift()!;
    activePriority = batch.priority;
    lastAnnouncement = { phrases: batch.phrases, priority: batch.priority, timestamp: Date.now() };

    for (const phrase of batch.phrases) {
      await speakPhrase(phrase);
      if (batch.phrases.indexOf(phrase) < batch.phrases.length - 1) {
        await delay(PHRASE_GAP_MS);
      }
    }

    // Pause between batches
    if (phraseQueue.length > 0) {
      await delay(PHRASE_GAP_MS);
    }
  }

  activePriority = undefined;
  isSpeaking = false;
}

/**
 * Enqueue phrases with priority preemption.
 * Higher-priority batches (lower urgency number) interrupt lower-priority speech.
 * P1 active shooter preempts P4 noise complaint announcement.
 */
function enqueuePhrases(phrases: VoicePhrase[], priority?: string): void {
  if (phrases.length === 0) return;
  const prio = priority || 'INFO';
  const newUrgency = PRIORITY_URGENCY[prio] ?? 5;

  // If currently speaking a lower-priority batch, interrupt it
  if (isSpeaking && activePriority) {
    const currentUrgency = PRIORITY_URGENCY[activePriority] ?? 5;
    if (newUrgency < currentUrgency) {
      // Cancel current speech, prepend new batch
      if (isSpeechAvailable()) speechSynthesis.cancel();
      isSpeaking = false;
      phraseQueue.unshift({ phrases, priority: prio });
      processQueue().catch(() => { isSpeaking = false; });
      return;
    }
  }

  // Insert in priority order (higher priority = earlier in queue)
  let inserted = false;
  for (let i = 0; i < phraseQueue.length; i++) {
    const existingUrgency = PRIORITY_URGENCY[phraseQueue[i].priority] ?? 5;
    if (newUrgency < existingUrgency) {
      phraseQueue.splice(i, 0, { phrases, priority: prio });
      inserted = true;
      break;
    }
  }
  if (!inserted) phraseQueue.push({ phrases, priority: prio });

  processQueue().catch(() => { isSpeaking = false; });
}

/** Clear all pending phrases and cancel current speech. */
export function clearVoiceQueue(): void {
  phraseQueue = [];
  if (isSpeechAvailable()) {
    speechSynthesis.cancel();
  }
  isSpeaking = false;
}

/** Full reset — clear queue, dedup cache, and cached voice. Call on logout/shift change. */
export function resetVoiceState(): void {
  clearVoiceQueue();
  announcedCache.clear();
  cachedVoice = null;
  lastAnnouncement = null;
}

/**
 * Replay the last announcement. Useful when officers miss an alert.
 * Skips dedup cache — always plays regardless of timing.
 */
export function repeatLastAnnouncement(): void {
  if (!isVoiceEnabled() || !isSpeechAvailable() || !lastAnnouncement) return;
  enqueuePhrases(lastAnnouncement.phrases, lastAnnouncement.priority);
}

/** Get info about the last announcement for UI display. */
export function getLastAnnouncement(): { text: string; timestamp: number } | null {
  if (!lastAnnouncement) return null;
  return {
    text: lastAnnouncement.phrases.map(p => p.text).join(' '),
    timestamp: lastAnnouncement.timestamp,
  };
}

// ─── Natural Speech Helpers ─────────────────────────────────

/**
 * Convert robotic ALL-CAPS dispatch text into natural spoken English.
 *
 * TTS engines handle sentence-case text with proper punctuation far better:
 * - Commas produce ~200ms pauses (breathing room)
 * - Periods produce ~400ms pauses (sentence finality)
 * - Semicolons produce ~300ms pauses (list separation)
 *
 * Phrasing follows real dispatcher cadence:
 * - Lead with "Caution" or "Be advised" for safety alerts
 * - Short, declarative sentences
 * - No filler words ("um", "uh", "basically")
 * - Professional monotone authority, not conversational
 */
function naturalPhrase(text: string): string {
  const NATURAL_MAP: Record<string, string> = {
    // Safety alerts — lead with "Caution" for officer attention
    'ACTIVE WARRANTS': 'Caution; active warrants on file.',
    'ARMED SUSPECT': 'Caution; armed suspect.',
    'VIOLENT SUSPECT': 'Caution; violent suspect.',
    'MENTAL SUSPECT': 'Be advised; mental health concern.',
    'KNOWN DRUG USER': 'Be advised; known drug user.',
    'ESCAPE RISK': 'Caution; escape risk.',
    'SUICIDE RISK': 'Caution; suicide risk.',
    'REGISTERED SEX OFFENDER': 'Be advised; registered sex offender.',
    'GANG AFFILIATED': 'Be advised; gang affiliation.',
    'WATCHLIST MATCH': 'Caution; watchlist match.',
    'FEDERAL WATCHLIST HIT': 'Caution; federal watchlist hit.',
    'UTAH STATE WARRANT': 'Caution; Utah state warrant on file.',
    'CRIMINAL HISTORY': 'Be advised; prior criminal history.',
    'WARRANT HIT': 'Caution; warrant hit.',

    // Call flags — clipped dispatcher style
    'ARMED SUBJECT': 'Caution; armed subject reported.',
    'FELONY IN PROGRESS': 'Felony in progress.',
    'OFFICER SAFETY CAUTION': 'Officer safety; use caution on approach.',
    'VEHICLE PURSUIT': 'Vehicle pursuit; in progress.',
    'FOOT PURSUIT': 'Foot pursuit; in progress.',
    'DOMESTIC VIOLENCE': 'Domestic violence call.',
    'GANG RELATED': 'Gang related.',
    'HAZMAT': 'Hazmat situation; stage and hold.',
    'MENTAL HEALTH CRISIS': 'Mental health crisis.',
    'INJURIES REPORTED': 'Injuries reported.',
    'E M S REQUESTED': 'E.M.S. requested.',
    'K 9 REQUESTED': 'K-9 requested.',
    'DRUGS INVOLVED': 'Drugs involved.',
    'ALCOHOL INVOLVED': 'Alcohol involved.',

    // Premise history
    'PRIOR ARMED CALLS AT LOCATION': 'Be advised; prior armed calls at this location.',
    'PRIOR DOMESTIC VIOLENCE AT LOCATION': 'Be advised; prior D.V. at this location.',
    'PRIOR DRUG ACTIVITY AT LOCATION': 'Be advised; prior drug activity at this location.',

    // Emergency
    'PANIC ALERT': 'Panic alert.',
    'OFFICER NEEDS ASSISTANCE': 'Officer needs immediate assistance.',

    // Vehicle
    'STOLEN VEHICLE': 'Stolen vehicle.',
    'BOLO HIT': 'B.O.L.O. hit confirmed.',
    'HIT AND RUN': 'Hit and run.',

    // Status
    'DISPATCH': 'Dispatch.',
    'NEW CALL': 'New call.',
    'PRIORITY ONE': 'Priority one.',
    'PRIORITY TWO': 'Priority two.',
  };

  return NATURAL_MAP[text] || text;
}

/**
 * Post-process text for TTS pronunciation improvements.
 * Handles common dispatch abbreviations, numbers, and codes
 * that TTS engines mispronounce.
 */
function improvePronounciation(text: string): string {
  return text
    // Spell out abbreviations TTS often botches
    .replace(/\bSt\b(?!\.)/g, 'Street')    // "500 South St" → "500 South Street" (for speech only)
    .replace(/\bAve\b(?!\.)/g, 'Avenue')
    .replace(/\bBlvd\b(?!\.)/g, 'Boulevard')
    .replace(/\bDr\b(?!\.)/g, 'Drive')
    .replace(/\bCt\b(?!\.)/g, 'Court')
    .replace(/\bLn\b(?!\.)/g, 'Lane')
    .replace(/\bPl\b(?!\.)/g, 'Place')
    .replace(/\bCir\b(?!\.)/g, 'Circle')
    // Highway/Interstate
    .replace(/\bI-(\d+)\b/g, 'Interstate $1')
    .replace(/\bSR-(\d+)\b/g, 'State Route $1')
    .replace(/\bUS-(\d+)\b/g, 'U.S. $1')
    .replace(/\bHwy\b/gi, 'Highway')
    // Directions — TTS needs full words for natural delivery
    .replace(/\bNB\b/g, 'northbound')
    .replace(/\bSB\b/g, 'southbound')
    .replace(/\bEB\b/g, 'eastbound')
    .replace(/\bWB\b/g, 'westbound')
    // Common dispatch codes
    .replace(/\bP1\b/g, 'Priority one')
    .replace(/\bP2\b/g, 'Priority two')
    .replace(/\bP3\b/g, 'Priority three')
    .replace(/\bP4\b/g, 'Priority four')
    .replace(/\b10-4\b/g, 'ten four')
    .replace(/\bDV\b/g, 'D.V.')
    .replace(/\bDUI\b/g, 'D.U.I.')
    .replace(/\bEMS\b/g, 'E.M.S.')
    .replace(/\bBOLO\b/g, 'B.O.L.O.')
    .replace(/\bAPB\b/g, 'A.P.B.')
    .replace(/\bVIN\b/g, 'V.I.N.')
    // Numbers — add slight pauses around street numbers for clarity
    .replace(/(\d{3,5})\s+(South|North|East|West)/g, '$1, $2');
}

// ─── Phrase Builders ────────────────────────────────────────

/**
 * Build spoken phrases from a safety screening result.
 * Each unique alert condition produces one short phrase
 * converted to natural spoken English for human-like delivery.
 */
function buildScreeningPhrases(result: ScreeningResult): VoicePhrase[] {
  const phrases: VoicePhrase[] = [];
  const seen = new Set<string>();

  const add = (text: string) => {
    if (!seen.has(text)) { seen.add(text); phrases.push({ text: naturalPhrase(text) }); }
  };

  // Person-level alerts
  for (const item of result.persons) {
    const p = item.person;

    // Active warrants
    if (item.warrants.length > 0) {
      add('ACTIVE WARRANTS');
    }

    // Caution flag keywords
    if (p.caution_flags) {
      const flags = p.caution_flags.toUpperCase();
      if (flags.includes('ARMED')) add('ARMED SUSPECT');
      if (flags.includes('VIOLENT')) add('VIOLENT SUSPECT');
      if (flags.includes('MENTAL')) add('MENTAL SUSPECT');
      if (flags.includes('DRUGS') || flags.includes('NARCOTICS')) add('KNOWN DRUG USER');
      if (flags.includes('ESCAPE')) add('ESCAPE RISK');
      if (flags.includes('SUICID')) add('SUICIDE RISK');
    }

    // Sex offender
    if (p.is_sex_offender) add('REGISTERED SEX OFFENDER');

    // Gang affiliation
    if (p.gang_affiliation) add('GANG AFFILIATED');

    // OFAC watchlist
    if (p.watchlist_match) add('WATCHLIST MATCH');

    // Criminal history
    if (p.has_criminal_history) add('CRIMINAL HISTORY');
  }

  // Direct warrant hits (not linked to a person)
  if (result.directWarrantHits.length > 0) {
    add('WARRANT HIT');
  }

  // OFAC / Federal sanctions
  if ((result.ofacHits || []).length > 0) {
    add('FEDERAL WATCHLIST HIT');
  }

  // Utah state warrants
  if ((result.utahWarrantHits || []).length > 0) {
    add('UTAH STATE WARRANT');
  }

  // Premise history warnings
  for (const w of (result.premiseWarnings || [])) {
    if (w === 'ARMED_HISTORY') add('PRIOR ARMED CALLS AT LOCATION');
    else if (w === 'DV_HISTORY') add('PRIOR DOMESTIC VIOLENCE AT LOCATION');
    else if (w === 'DRUGS_HISTORY') add('PRIOR DRUG ACTIVITY AT LOCATION');
  }

  return phrases;
}

/**
 * Build spoken phrases from a call's boolean flags.
 * Critical flags first, then high, then medium priority.
 * All phrases converted to natural spoken English.
 */
function buildCallPhrases(call: CallFlags): VoicePhrase[] {
  const phrases: VoicePhrase[] = [];

  // Critical — weapon type specificity
  if (call.weapons_involved && call.weapons_involved !== 'None') {
    const weapon = call.weapons_involved.toLowerCase();
    if (weapon.includes('firearm') || weapon.includes('gun') || weapon.includes('rifle') || weapon.includes('pistol')) {
      phrases.push({ text: `Caution, subject armed with ${weapon}.` });
    } else if (weapon.includes('knife') || weapon.includes('blade') || weapon.includes('edged')) {
      phrases.push({ text: `Caution, subject armed with edged weapon.` });
    } else if (weapon === 'unknown' || weapon === 'yes') {
      phrases.push({ text: naturalPhrase('ARMED SUBJECT') });
    } else {
      phrases.push({ text: `Caution, subject armed, ${weapon}.` });
    }
  }
  if (call.felony_in_progress) phrases.push({ text: naturalPhrase('FELONY IN PROGRESS') });
  if (call.officer_safety_caution) phrases.push({ text: naturalPhrase('OFFICER SAFETY CAUTION') });
  if (call.vehicle_pursuit) phrases.push({ text: naturalPhrase('VEHICLE PURSUIT') });
  if (call.foot_pursuit) phrases.push({ text: naturalPhrase('FOOT PURSUIT') });
  if (call.domestic_violence) phrases.push({ text: naturalPhrase('DOMESTIC VIOLENCE') });
  if (call.gang_related) phrases.push({ text: naturalPhrase('GANG RELATED') });
  if (call.hazmat) phrases.push({ text: naturalPhrase('HAZMAT') });

  // High
  if (call.mental_health_crisis) phrases.push({ text: naturalPhrase('MENTAL HEALTH CRISIS') });
  if (call.injuries_reported) phrases.push({ text: naturalPhrase('INJURIES REPORTED') });
  if (call.ems_requested) phrases.push({ text: naturalPhrase('E M S REQUESTED') });
  if (call.k9_requested) phrases.push({ text: naturalPhrase('K 9 REQUESTED') });
  if (call.drugs_involved) phrases.push({ text: naturalPhrase('DRUGS INVOLVED') });

  return phrases;
}

// ─── Main Entry Points ──────────────────────────────────────

/**
 * Announce safety alerts from a screening result.
 * Call this AFTER playTone('warning') — it handles the post-tone
 * delay and sequential speech internally.
 */
export function announceScreeningAlerts(result: ScreeningResult): void {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;
  if (!result.hasWarnings) return;

  // Build a dedup key from the person names in the result
  const nameKey = result.persons.map(p => `${p.person.last_name},${p.person.first_name}`).join('|');
  const dedupKey = `screening:${nameKey}`;
  if (wasRecentlyAnnounced(dedupKey)) return;

  const phrases = buildScreeningPhrases(result);
  if (phrases.length === 0) return;

  markAnnounced(dedupKey);

  // Wait for the warning tone to finish, then speak
  setTimeout(() => {
    enqueuePhrases(phrases);
  }, TONE_GAP_MS);
}

/**
 * Announce safety alerts from a call's flags.
 * Only speaks if the call has safety-relevant flags.
 * Plays a warning tone before speaking.
 */
export async function announceCallAlerts(call: CallFlags): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const phrases = buildCallPhrases(call);
  if (phrases.length === 0) return;

  // Dedup: hash which flags are set
  const flagHash = phrases.map(p => p.text).join(',');
  const dedupKey = `call:${call.id || 'unknown'}:${flagHash}`;
  if (wasRecentlyAnnounced(dedupKey)) return;

  markAnnounced(dedupKey);

  // Play warning tone first, then speak
  await playToneAsync('warning');
  await delay(TONE_GAP_MS);
  enqueuePhrases(phrases);
}

/**
 * Announce a panic alert.
 * Called when a panic_alert WebSocket event arrives.
 * Plays the alarm tone, then speaks "PANIC ALERT. OFFICER NEEDS ASSISTANCE."
 */
export async function announcePanicAlert(officerName?: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `panic:${officerName || 'unknown'}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  // Play officer_down siren (max urgency wailing tone)
  await playToneAsync('officer_down');
  await delay(TONE_GAP_MS);

  // Single urgent utterance — no pauses for panic
  const msg = officerName
    ? `Panic alert, officer ${officerName} needs immediate assistance.`
    : 'Panic alert, officer needs immediate assistance.';
  enqueuePhrases([{ text: msg }], 'PANIC');
}

/**
 * Announce a dispatch event: "DISPATCH — [CALL NUMBER] — [INCIDENT TYPE] — [LOCATION]"
 * plus any safety flags on the call. Triggered on call_status_changed to 'dispatched'.
 */
export async function announceDispatchEvent(call: CallFlags & {
  call_number?: string;
  incident_type?: string;
  location?: string;
  priority?: string;
}): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `dispatch:${call.id || 'unknown'}:${call.call_number || ''}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  // Select tone based on pursuit/priority
  const isP = call.vehicle_pursuit || call.foot_pursuit;
  const tone = isP ? 'pursuit' : (call.priority === 'P1' ? 'code3' : 'info');
  await playToneAsync(tone as any);
  await delay(TONE_GAP_MS);

  // Build single condensed utterance: "Dispatch, call 42, Suspicious Activity, P1, Zone 3, 500 South State."
  const parts: string[] = ['Dispatch'];
  if (call.call_number) parts.push(shortCallNumber(call.call_number));
  if (call.incident_type) parts.push(formatIncidentType(call.incident_type));
  if (call.priority === 'P1' || call.priority === 'P2') parts.push(call.priority);
  if ((call as any).zone) parts.push(`Zone ${(call as any).zone}`);
  if ((call as any).beat) parts.push(`Beat ${(call as any).beat}`);
  if (call.location) parts.push(abbreviateAddress(call.location));
  if ((call as any).cross_street) parts.push(`cross ${abbreviateAddress((call as any).cross_street)}`);

  const phrases: VoicePhrase[] = [{ text: parts.join(', ') + '.' }];

  // Append safety flags as a second condensed utterance
  const safetyPhrases = buildCallPhrases(call);
  if (safetyPhrases.length > 0) {
    phrases.push({ text: safetyPhrases.map(p => p.text.replace(/\.$/, '')).join(', ') + '.' });
  }

  enqueuePhrases(phrases);
}

/**
 * Announce a new call arrival: "NEW CALL — [CALL NUMBER] — [INCIDENT TYPE]"
 * Plays a tone and announces call details. Used on call_created events.
 */
export async function announceNewCall(call: CallFlags & {
  call_number?: string;
  incident_type?: string;
  priority?: string;
}): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `newcall:${call.id || 'unknown'}:${call.call_number || ''}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  // Priority-based tone selection: P1 gets alarm, P2 gets warning, P3/P4 get caution
  const tone = call.priority === 'P1' ? 'alarm' : call.priority === 'P2' ? 'warning' : 'caution';
  await playToneAsync(tone);
  await delay(TONE_GAP_MS);

  // Build single condensed utterance: "New call, 42, Burglary, P1, Zone 3."
  const parts: string[] = ['New call'];
  if (call.call_number) parts.push(shortCallNumber(call.call_number));
  if (call.incident_type) parts.push(formatIncidentType(call.incident_type));
  if (call.priority === 'P1' || call.priority === 'P2') parts.push(call.priority);
  if ((call as any).zone) parts.push(`Zone ${(call as any).zone}`);
  if ((call as any).beat) parts.push(`Beat ${(call as any).beat}`);

  const phrases: VoicePhrase[] = [{ text: parts.join(', ') + '.' }];

  // Append safety flags as single condensed utterance
  const safetyPhrases = buildCallPhrases(call);
  if (safetyPhrases.length > 0) {
    phrases.push({ text: safetyPhrases.map(p => p.text.replace(/\.$/, '')).join(', ') + '.' });
  }

  enqueuePhrases(phrases, call.priority);
}

// ─── Status / Unit / BOLO / Warrant Announcements ───────────

/**
 * Announce a call status change (dispatched, enroute, onscene, cleared, etc.).
 * Plays an info tone then speaks the status label and call number.
 */
export async function announceStatusChange(call: any, newStatus: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const callNum = call?.call_number || call?.id || '';
  const dedupKey = `status:${callNum}:${newStatus}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  const statusLabels: Record<string, string> = {
    dispatched: 'Dispatched',
    enroute: 'Enroute',
    onscene: 'On scene',
    cleared: 'Cleared',
    closed: 'Closed',
    pending: 'Pending',
  };
  const label = statusLabels[newStatus] || newStatus;

  await playToneAsync('info');
  await delay(TONE_GAP_MS);
  enqueuePhrases([{ text: `${label}, call ${shortCallNumber(callNum)}.` }]);
}

/**
 * Announce units dispatched to a call.
 * Speaks each unit call sign and the call number.
 */
export async function announceUnitDispatched(call: any, units?: any[]): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const callNum = call?.call_number || call?.id || '';
  const unitNames = units?.map((u: any) => u.call_sign || u.callSign || u.name).filter(Boolean).join(', ') || '';
  const dedupKey = `unitdispatch:${callNum}:${unitNames}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('info');
  await delay(TONE_GAP_MS);
  const phrases: VoicePhrase[] = [];
  if (unitNames) {
    phrases.push({ text: `Unit ${unitNames} dispatched to call ${callNum}.` });
  } else {
    phrases.push({ text: `Units dispatched to call ${callNum}.` });
  }
  enqueuePhrases(phrases);
}

/**
 * Announce a new BOLO (Be On the Lookout) alert.
 * Plays a warning tone then speaks the BOLO title/description.
 */
export async function announceBolo(data: any): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `bolo:${data.id || data.title || Date.now()}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('warning');
  await delay(TONE_GAP_MS);

  const description = data.title || data.description || '';
  const msg = description ? `BOLO, ${description}.` : 'New BOLO alert.';
  enqueuePhrases([{ text: msg }]);
}

/**
 * Announce an active warrant hit from safety screening.
 * Plays an alarm tone then speaks the subject name and warrant count.
 */
export async function announceWarrantHit(data: any): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const personName = data.personName || data.person_name || 'Unknown subject';
  const dedupKey = `warrant:${personName}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('alarm');
  await delay(TONE_GAP_MS);

  const count = data.warrantCount || data.warrant_count || 0;
  const msg = count > 0
    ? `Active warrant, ${personName}, ${count} warrant${count > 1 ? 's' : ''}.`
    : `Active warrant, ${personName}.`;
  enqueuePhrases([{ text: msg }]);
}

// ─── All-Units / Backup / Pursuit Announcements ─────────────

/**
 * Announce an all-units broadcast. Plays the distinctive 3-note ascending tone.
 * Used for BOLOs, APBs, and supervisor-initiated all-channel alerts.
 */
export async function announceAllUnits(message: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `allunits:${message.slice(0, 50)}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('all_units');
  await delay(TONE_GAP_MS);
  enqueuePhrases([{ text: `All units, ${message}.` }], 'P1');
}

/**
 * Announce a backup request with location.
 * Uses code3 tone and P1 priority for immediate attention.
 */
export async function announceBackupRequest(data: {
  officer_name?: string;
  location?: string;
  call_number?: string;
  urgency?: 'routine' | 'urgent' | 'emergency';
}): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `backup:${data.officer_name || ''}:${data.call_number || Date.now()}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  const tone = data.urgency === 'emergency' ? 'officer_down' : 'code3';
  await playToneAsync(tone);
  await delay(TONE_GAP_MS);

  const parts: string[] = ['Backup requested'];
  if (data.officer_name) parts.push(`by ${data.officer_name}`);
  if (data.call_number) parts.push(`call ${shortCallNumber(data.call_number)}`);
  if (data.location) parts.push(abbreviateAddress(data.location));

  const priority = data.urgency === 'emergency' ? 'PANIC' : 'P1';
  enqueuePhrases([{ text: parts.join(', ') + '.' }], priority);
}

/**
 * Announce a pursuit update (vehicle or foot).
 * Uses the pursuit siren tone.
 */
export async function announcePursuit(data: {
  type: 'vehicle' | 'foot';
  direction?: string;
  speed?: string;
  location?: string;
  description?: string;
  call_number?: string;
}): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `pursuit:${data.call_number || Date.now()}:${data.location || ''}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('pursuit');
  await delay(TONE_GAP_MS);

  const parts: string[] = [data.type === 'foot' ? 'Foot pursuit' : 'Vehicle pursuit'];
  if (data.direction) parts.push(data.direction);
  if (data.location) parts.push(abbreviateAddress(data.location));
  if (data.speed) parts.push(`${data.speed} miles per hour`);
  if (data.description) parts.push(data.description);

  enqueuePhrases([{ text: parts.join(', ') + '.' }], 'P1');
}

// ─── Demo / Test ─────────────────────────────────────────────

/**
 * All available voice alert phrases, grouped by category.
 * Used by the demo function and can be referenced for documentation.
 */
export const VOICE_ALERT_CATALOG = {
  // ── Emergency ──
  emergency: [
    'PANIC ALERT',
    'OFFICER NEEDS ASSISTANCE',
  ],
  // ── Person Alerts (from safety screening) ──
  person: [
    'ACTIVE WARRANTS',
    'ARMED SUSPECT',
    'VIOLENT SUSPECT',
    'MENTAL SUSPECT',
    'KNOWN DRUG USER',
    'ESCAPE RISK',
    'SUICIDE RISK',
    'REGISTERED SEX OFFENDER',
    'GANG AFFILIATED',
    'WATCHLIST MATCH',
    'FEDERAL WATCHLIST HIT',
    'UTAH STATE WARRANT',
    'CRIMINAL HISTORY',
    'WARRANT HIT',
  ],
  // ── Call Flag Alerts (from dispatch call) ──
  callFlags: [
    'ARMED SUBJECT',
    'FELONY IN PROGRESS',
    'OFFICER SAFETY CAUTION',
    'VEHICLE PURSUIT',
    'FOOT PURSUIT',
    'DOMESTIC VIOLENCE',
    'GANG RELATED',
    'HAZMAT',
    'MENTAL HEALTH CRISIS',
    'INJURIES REPORTED',
    'E M S REQUESTED',
    'K 9 REQUESTED',
    'DRUGS INVOLVED',
  ],
  // ── Premise / Location Alerts ──
  premise: [
    'PRIOR ARMED CALLS AT LOCATION',
    'PRIOR DOMESTIC VIOLENCE AT LOCATION',
    'PRIOR DRUG ACTIVITY AT LOCATION',
  ],
  // ── Vehicle Alerts ──
  vehicle: [
    'STOLEN VEHICLE',
    'BOLO HIT',
    'HIT AND RUN',
  ],
} as const;

/**
 * Demo all voice alerts — plays each phrase sequentially with tone intros.
 * Useful for testing voice selection, volume, and cadence.
 * Groups are separated by a different tone type.
 */
export async function demoAllVoiceAlerts(): Promise<void> {
  if (!isSpeechAvailable()) {
    console.warn('[VoiceAlerts] SpeechSynthesis not available');
    return;
  }

  // Clear any pending queue
  clearVoiceQueue();

  const groups: Array<{ label: string; tone: 'alarm' | 'warning' | 'caution'; phrases: readonly string[] }> = [
    { label: 'Emergency', tone: 'alarm', phrases: VOICE_ALERT_CATALOG.emergency },
    { label: 'Person Alerts', tone: 'warning', phrases: VOICE_ALERT_CATALOG.person },
    { label: 'Call Flag Alerts', tone: 'warning', phrases: VOICE_ALERT_CATALOG.callFlags },
    { label: 'Premise Alerts', tone: 'caution', phrases: VOICE_ALERT_CATALOG.premise },
    { label: 'Vehicle Alerts', tone: 'warning', phrases: VOICE_ALERT_CATALOG.vehicle },
  ];

  for (const group of groups) {
    console.log(`[VoiceAlerts Demo] ── ${group.label} ──`);
    await playToneAsync(group.tone);
    await delay(TONE_GAP_MS);

    for (const text of group.phrases) {
      await speakPhrase({ text: naturalPhrase(text) });
      await delay(PHRASE_GAP_MS);
    }

    // Pause between groups
    await delay(800);
  }

  console.log('[VoiceAlerts Demo] ── Complete ──');
}

// ─── Helpers ────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format incident types for natural speech.
 * "suspicious_activity" → "Suspicious Activity"
 * "dv_assault" → "DV Assault"
 * Common dispatch abbreviations are preserved (DV, DUI, etc.)
 */
function formatIncidentType(type: string): string {
  const INCIDENT_SPEECH: Record<string, string> = {
    'dv_assault': 'Domestic violence assault',
    'dv_dispute': 'Domestic violence dispute',
    'dui': 'D.U.I.',
    'dwi': 'D.W.I.',
    'agg_assault': 'Aggravated assault',
    'owi': 'Operating while intoxicated',
    'hit_and_run': 'Hit and run',
    'shots_fired': 'Shots fired',
    'man_with_gun': 'Man with a gun',
    'man_with_knife': 'Man with a knife',
    'armed_robbery': 'Armed robbery',
    'subject_stop': 'Subject stop',
    'traffic_stop': 'Traffic stop',
    'welfare_check': 'Welfare check',
    'missing_person': 'Missing person',
    'suicidal_subject': 'Suicidal subject',
    'stolen_vehicle': 'Stolen vehicle',
    'noise_complaint': 'Noise complaint',
    'suspicious_vehicle': 'Suspicious vehicle',
    'suspicious_activity': 'Suspicious activity',
    'trespass': 'Trespass',
    'burglary_in_progress': 'Burglary in progress',
    'alarm_residential': 'Residential alarm',
    'alarm_commercial': 'Commercial alarm',
  };

  const lower = type.toLowerCase();
  if (INCIDENT_SPEECH[lower]) return INCIDENT_SPEECH[lower];

  // Default: replace underscores with spaces, title case
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Shorten call numbers for speech: "2024-0042" → "42", "CFS-2024-123" → "123".
 * Dispatchers say the short number, not the full prefix.
 */
function shortCallNumber(num: string): string {
  // Strip leading prefix (CFS-, year-, etc.) and leading zeros
  return num.replace(/^[A-Z]+-/i, '').replace(/^\d{4}-?0*/, '') || num;
}

/**
 * Abbreviate addresses for speech brevity:
 * "500 South State Street, Salt Lake City, UT 84111" → "500 South State"
 * Strip city/state/zip, shorten common suffixes.
 */
function abbreviateAddress(addr: string): string {
  // Remove city, state, zip after comma
  let short = addr.split(',')[0].trim();
  // Shorten common suffixes
  short = short
    .replace(/\bStreet\b/i, 'St')
    .replace(/\bAvenue\b/i, 'Ave')
    .replace(/\bBoulevard\b/i, 'Blvd')
    .replace(/\bDrive\b/i, 'Dr')
    .replace(/\bCourt\b/i, 'Ct')
    .replace(/\bPlace\b/i, 'Pl')
    .replace(/\bLane\b/i, 'Ln')
    .replace(/\bCircle\b/i, 'Cir');
  return short;
}
