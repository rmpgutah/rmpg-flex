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

/** Inter-phrase pause — deliberate gap between sentences, like a real dispatcher pausing to read the next line */
const PHRASE_GAP_MS = 500;

/** Post-tone pause before speech begins — let the tone ring out */
const TONE_GAP_MS = 400;

/** Deduplication cache TTL (60 seconds) */
const DEDUP_TTL_MS = 60_000;

/** Priority urgency levels for preemption (lower = more urgent) */
const PRIORITY_URGENCY: Record<string, number> = {
  PANIC: 0, P1: 1, P2: 2, P3: 3, P4: 4, INFO: 5,
};

/** User-configurable speed presets — slower, measured, clear */
const SPEED_PRESETS: Record<string, number> = {
  slow: 0.78,
  normal: 0.88,
  fast: 1.0,
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
 * Female dispatcher pitch — natural female register.
 * 0.96 is a confident, natural female voice that doesn't sound forced.
 * Combined with rate 0.95, she sounds like a real person relaying information
 * with practiced calm — not a computer reading a database.
 */
const SPEECH_PITCH = 0.96;

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

/** Phrase counter — used for micro-variation seeding */
let phraseCounter = 0;

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

    // ── Micro-variation for human realism ──
    // Real humans don't speak at exactly the same rate/pitch every sentence.
    // Adding ±2% rate and ±1.5% pitch variation per phrase prevents the
    // uncanny "every sentence sounds identical" TTS effect.
    // Uses a deterministic seed (phrase counter) so it's consistent per phrase
    // but different between phrases.
    phraseCounter++;
    const rateJitter = 1.0 + (Math.sin(phraseCounter * 2.7) * 0.02);    // ±2%
    const pitchJitter = Math.sin(phraseCounter * 1.9) * 0.015;           // ±1.5%

    // Longer sentences get slightly slower (natural human tendency)
    const lengthFactor = spokenText.length > 80 ? 0.97 : spokenText.length > 50 ? 0.985 : 1.0;

    const finalRate = (params ? baseRate * params.rateMultiplier : baseRate) * rateJitter * lengthFactor;
    const finalPitch = SPEECH_PITCH + (params?.pitchOffset ?? 0) + pitchJitter;

    utterance.rate = Math.max(0.5, Math.min(2.0, finalRate));
    utterance.pitch = Math.max(0.5, Math.min(2.0, finalPitch));
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
  let result = text
    // ── Street suffixes — expand for TTS clarity ──
    .replace(/\bSt\b(?!\.)/g, 'Street')
    .replace(/\bAve\b(?!\.)/g, 'Avenue')
    .replace(/\bBlvd\b(?!\.)/g, 'Boulevard')
    .replace(/\bDr\b(?!\.)/g, 'Drive')
    .replace(/\bCt\b(?!\.)/g, 'Court')
    .replace(/\bLn\b(?!\.)/g, 'Lane')
    .replace(/\bPl\b(?!\.)/g, 'Place')
    .replace(/\bCir\b(?!\.)/g, 'Circle')
    .replace(/\bPkwy\b/gi, 'Parkway')
    .replace(/\bTrl\b/gi, 'Trail')
    .replace(/\bWay\b/gi, 'Way')
    .replace(/\bRd\b(?!\.)/g, 'Road')
    // ── Highway designators ──
    .replace(/\bI-(\d+)\b/g, 'Interstate $1')
    .replace(/\bSR-(\d+)\b/g, 'State Route $1')
    .replace(/\bUS-(\d+)\b/g, 'U.S. $1')
    .replace(/\bHwy\b/gi, 'Highway')
    // ── Compass directions ──
    .replace(/\bNB\b/g, 'northbound')
    .replace(/\bSB\b/g, 'southbound')
    .replace(/\bEB\b/g, 'eastbound')
    .replace(/\bWB\b/g, 'westbound')
    .replace(/\bN\.?\s/g, 'North ')
    .replace(/\bS\.?\s/g, 'South ')
    .replace(/\bE\.?\s/g, 'East ')
    .replace(/\bW\.?\s/g, 'West ')
    // ── Dispatch codes / abbreviations ──
    .replace(/\bP1\b/g, 'Priority one')
    .replace(/\bP2\b/g, 'Priority two')
    .replace(/\bP3\b/g, 'Priority three')
    .replace(/\bP4\b/g, 'Priority four')
    .replace(/\b10-4\b/g, 'ten four')
    .replace(/\b10-(\d+)\b/g, 'ten $1')
    .replace(/\bDV\b/g, 'D.V.')
    .replace(/\bDUI\b/g, 'D.U.I.')
    .replace(/\bDWI\b/g, 'D.W.I.')
    .replace(/\bEMS\b/g, 'E.M.S.')
    .replace(/\bBOLO\b/g, 'B.O.L.O.')
    .replace(/\bAPB\b/g, 'A.P.B.')
    .replace(/\bVIN\b/g, 'V.I.N.')
    .replace(/\bDOA\b/g, 'D.O.A.')
    .replace(/\bAKA\b/g, 'A.K.A.')
    .replace(/\bOUI\b/g, 'O.U.I.')
    .replace(/\bCPR\b/g, 'C.P.R.')
    .replace(/\bSLC\b/g, 'Salt Lake City')
    .replace(/\bUT\b/g, 'Utah')
    .replace(/\bDOB\b/g, 'date of birth')
    .replace(/\bSSN\b/g, 'social security number')
    .replace(/\bLKA\b/g, 'last known address')
    // ── Age / physical descriptions ──
    .replace(/\bW\/M\b/gi, 'white male')
    .replace(/\bW\/F\b/gi, 'white female')
    .replace(/\bB\/M\b/gi, 'Black male')
    .replace(/\bB\/F\b/gi, 'Black female')
    .replace(/\bH\/M\b/gi, 'Hispanic male')
    .replace(/\bH\/F\b/gi, 'Hispanic female')
    .replace(/\bA\/M\b/gi, 'Asian male')
    .replace(/\bA\/F\b/gi, 'Asian female')
    .replace(/\bYOA\b/gi, 'years old')
    .replace(/\byoa\b/gi, 'years old')
    .replace(/\bapprox\.?\s/gi, 'approximately ')
    .replace(/\bunk\b/gi, 'unknown')
    // ── Time formats ──
    .replace(/(\d{1,2}):(\d{2}):(\d{2})/g, (_, h, m, s) => {
      const hours = parseInt(h);
      const mins = parseInt(m);
      const secs = parseInt(s);
      if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}, ${mins} minute${mins !== 1 ? 's' : ''}`;
      return `${mins} minute${mins !== 1 ? 's' : ''} and ${secs} second${secs !== 1 ? 's' : ''}`;
    })
    // ── Natural pauses — add commas before conjunctions in long phrases ──
    .replace(/\band\b/g, ', and')
    .replace(/,\s*,/g, ',')  // clean double commas
    // ── Numbers — pause around street numbers ──
    .replace(/(\d{3,5})\s+(South|North|East|West)/g, '$1, $2');

  // ── Auto-spell any remaining ALL-CAPS acronyms (2+ letters) ──
  // "PSO" → "P.S.O.", "RMPG" → "R.M.P.G.", etc.
  // Skip words already dotted, common English words, and known expansions.
  const SKIP_WORDS = new Set([
    // Already handled above or common words that happen to be caps in dispatch
    'THE', 'AND', 'FOR', 'NOT', 'BUT', 'ALL', 'ARE', 'WAS', 'HAS', 'HAD',
    'HIS', 'HER', 'SHE', 'HIM', 'WHO', 'HOW', 'OUT', 'OFF', 'GET', 'GOT',
    'LET', 'SET', 'RUN', 'PUT', 'SAY', 'USE', 'NEW', 'OLD', 'TWO', 'ONE',
    'MAN', 'CAR', 'GUN', 'RED', 'TAN', 'VAN',
    // Directions / status words
    'NORTH', 'SOUTH', 'EAST', 'WEST',
    'ZONE', 'BEAT', 'CALL', 'UNIT',
    // Already expanded by rules above
    'INTERSTATE', 'HIGHWAY', 'STREET', 'AVENUE', 'BOULEVARD', 'ROAD',
    'PRIORITY', 'CAUTION',
  ]);

  result = result.replace(/\b([A-Z]{2,})\b/g, (match) => {
    if (SKIP_WORDS.has(match)) return match;
    if (match.includes('.')) return match; // Already dotted
    // Spell it out: "PSO" → "P.S.O."
    return match.split('').join('.') + '.';
  });

  return result;
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

  // Two sentences — the repetition is intentional, mirrors real radio urgency
  const phrases: VoicePhrase[] = [];
  if (officerName) {
    phrases.push({ text: `Panic alert. Officer ${officerName} is requesting immediate assistance.` });
    phrases.push({ text: `All units respond to officer ${officerName}'s location.` });
  } else {
    phrases.push({ text: 'Panic alert. An officer is requesting immediate assistance.' });
    phrases.push({ text: 'All units respond.' });
  }
  enqueuePhrases(phrases, 'PANIC');
}

/** Extended call data — mirrors CallForService for full dispatch readout */
interface DispatchCallData extends CallFlags {
  call_number?: string;
  incident_type?: string;
  location?: string;
  priority?: string;
  // Caller
  caller_name?: string;
  caller_phone?: string;
  caller_relationship?: string;
  // Narrative
  narrative?: string;
  description?: string;
  comments?: string;
  // Location detail
  cross_street?: string;
  location_building?: string;
  location_floor?: string;
  location_room?: string;
  apartment?: string;
  business_name?: string;
  property_name?: string;
  client_name?: string;
  zone_name?: string;
  beat_name?: string;
  beat_descriptor?: string;
  section_name?: string;
  // Subject/vehicle
  suspect_description?: string;
  subject_description?: string;
  vehicle_description?: string;
  vehicle_plate?: string;
  direction_of_travel?: string;
  num_subjects?: number;
  num_victims?: number;
  // Scene
  scene_safety?: string;
  weather_conditions?: string;
  lighting_conditions?: string;
  // Operational
  reporting_party?: string;
  assigned_units?: string[];
  juvenile_involved?: boolean;
  fire_requested?: boolean;
  le_notified?: boolean;
  le_agency?: string;
  source?: string;
}

/**
 * Announce a dispatch event like a real human dispatcher would.
 *
 * Natural conversational flow with contractions, transitions, and
 * contextual detail. Every available field is read — officers in the
 * field depend on this information.
 *
 * Example:
 * "Dispatch on call 42. We've got a domestic violence, priority one.
 *  You're going to 500 South State Street, apartment 204, that's the Marriott.
 *  Cross street's going to be 500 East. You're in Zone 3, Beat Alpha.
 *  Caller says there's a male subject hitting a female in the parking lot.
 *  Your reporting party is Jane Smith, she's the neighbor. She's still on the line.
 *  We've got two subjects and one victim on scene.
 *  Your suspect's a white male, red shirt, about 30 years old, last seen heading southbound.
 *  There's a black Honda Civic in the lot, plate Alpha Bravo Charlie 1 2 3.
 *  Adam-12 and Baker-7 are responding.
 *  Just so you know, it's dark out there with rain.
 *  Be advised, there's a juvenile involved.
 *  Caution, armed subject reported. Prior D.V. at this location."
 */
export async function announceDispatchEvent(call: DispatchCallData): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `dispatch:${call.id || 'unknown'}:${call.call_number || ''}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  const isP = call.vehicle_pursuit || call.foot_pursuit;
  const tone = isP ? 'pursuit' : (call.priority === 'P1' ? 'code3' : 'info');
  await playToneAsync(tone as any);
  await delay(TONE_GAP_MS);

  const phrases: VoicePhrase[] = [];

  // ── Opening ──
  let opening = 'Dispatch';
  if (call.call_number) opening += ` on call ${shortCallNumber(call.call_number)}`;
  phrases.push({ text: opening + '.' });

  // ── What type ──
  if (call.incident_type) {
    let typeLine = `We've got a ${formatIncidentType(call.incident_type)}`;
    if (call.priority) typeLine += `, ${call.priority}`;
    phrases.push({ text: typeLine + '.' });
  }

  // ── Where — full location with building/floor/room detail ──
  if (call.location) {
    let locLine = `You're going to ${call.location}`;
    if (call.apartment) locLine += `, apartment ${call.apartment}`;
    else if (call.location_room) locLine += `, room ${call.location_room}`;
    if (call.location_floor) locLine += `, ${ordinal(call.location_floor)} floor`;
    if (call.location_building) locLine += `, ${call.location_building} building`;
    if (call.business_name || call.property_name || call.client_name) {
      const name = call.business_name || call.property_name || call.client_name;
      locLine += `, that's the ${name}`;
    }
    phrases.push({ text: locLine + '.' });
  }

  if (call.cross_street) {
    phrases.push({ text: `Cross street's going to be ${call.cross_street}.` });
  }

  // ── Zone / Beat / Section ──
  const areaParts: string[] = [];
  if (call.zone_name || call.zone) areaParts.push(`Zone ${call.zone_name || call.zone}`);
  if (call.beat_name || call.beat) areaParts.push(`Beat ${call.beat_name || call.beat}`);
  if (call.section_name) areaParts.push(`${call.section_name} section`);
  if (areaParts.length > 0) {
    phrases.push({ text: `You're in ${areaParts.join(', ')}.` });
  }

  // ── Narrative — the story ──
  const narr = call.narrative || call.description || call.comments || '';
  if (narr) {
    const cleaned = truncateForSpeech(narr, 180);
    // Use "Caller says" or "We're told" to make it conversational
    const callerVerb = call.source === 'phone' ? 'Caller says' :
                       call.source === 'walk_in' ? 'Walk-in reports' :
                       call.source === 'officer' ? 'Officer reports' : 'We\'re told';
    phrases.push({ text: `${callerVerb} ${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}${cleaned.endsWith('.') ? '' : '.'}` });
  }

  // ── Who called ──
  if (call.caller_name && call.caller_name !== 'Anonymous') {
    let rpLine = `Your reporting party is ${call.caller_name}`;
    if (call.caller_relationship) rpLine += `, ${call.caller_relationship}`;
    if (call.caller_phone) rpLine += `. Callback number is ${formatPhone(call.caller_phone)}`;
    phrases.push({ text: rpLine + '.' });
  } else if (call.reporting_party) {
    phrases.push({ text: `Reporting party is ${call.reporting_party}.` });
  }

  // ── How many people ──
  if (call.num_subjects || call.num_victims) {
    const parts: string[] = [];
    if (call.num_subjects) parts.push(`${call.num_subjects} subject${call.num_subjects > 1 ? 's' : ''}`);
    if (call.num_victims) parts.push(`${call.num_victims} victim${call.num_victims > 1 ? 's' : ''}`);
    phrases.push({ text: `We've got ${parts.join(' and ')} on scene.` });
  }

  // ── Suspect description ──
  const suspDesc = call.suspect_description || call.subject_description;
  if (suspDesc) {
    let suspLine = `Your suspect's described as ${suspDesc}`;
    if (call.direction_of_travel) suspLine += `, last seen heading ${call.direction_of_travel}`;
    phrases.push({ text: suspLine + '.' });
  }

  // ── Vehicle ──
  if (call.vehicle_description || call.vehicle_plate) {
    let vLine = call.vehicle_description ? `There's a ${call.vehicle_description}` : 'Vehicle';
    if (call.vehicle_plate) vLine += `, plate ${spellOutPlate(call.vehicle_plate)}`;
    if (call.direction_of_travel && !suspDesc) vLine += `, last seen heading ${call.direction_of_travel}`;
    phrases.push({ text: vLine + '.' });
  }

  // ── Who's responding ──
  if (call.assigned_units && call.assigned_units.length > 0) {
    const unitList = call.assigned_units.length <= 2
      ? call.assigned_units.join(' and ')
      : call.assigned_units.slice(0, -1).join(', ') + ', and ' + call.assigned_units[call.assigned_units.length - 1];
    phrases.push({ text: `${unitList} responding.` });
  }

  // ── Scene conditions ──
  if (call.lighting_conditions || call.weather_conditions) {
    const conds: string[] = [];
    if (call.lighting_conditions) conds.push(`it's ${call.lighting_conditions.toLowerCase()}`);
    if (call.weather_conditions) conds.push(call.weather_conditions.toLowerCase());
    phrases.push({ text: `Just so you know, ${conds.join(' with ')}.` });
  }
  if (call.scene_safety) {
    phrases.push({ text: `Scene safety note: ${call.scene_safety}.` });
  }

  // ── Additional context flags ──
  if (call.juvenile_involved) {
    phrases.push({ text: 'Be advised, there\'s a juvenile involved on this one.' });
  }
  if (call.alcohol_involved) {
    phrases.push({ text: 'Alcohol is involved.' });
  }
  if (call.fire_requested) {
    phrases.push({ text: 'Fire department has been requested and is en route.' });
  }
  if (call.ems_requested) {
    phrases.push({ text: 'E.M.S. has been requested.' });
  }
  if (call.k9_requested) {
    phrases.push({ text: 'K-9 unit has been requested.' });
  }
  if (call.le_notified && call.le_agency) {
    phrases.push({ text: `${call.le_agency} has been notified and is aware.` });
  } else if (call.le_notified) {
    phrases.push({ text: 'Local law enforcement has been notified.' });
  }

  // ── Call source context ──
  if (call.source === '911' || call.source === 'emergency') {
    phrases.push({ text: 'This came in through 9-1-1.' });
  } else if (call.source === 'alarm') {
    phrases.push({ text: 'This is an alarm activation.' });
  }

  // ── Safety flags (last = sticks in memory) ──
  const safetyPhrases = buildCallPhrases(call);
  if (safetyPhrases.length > 0) {
    // Add a transition before safety block
    phrases.push({ text: 'Safety information follows.' });
    for (const sp of safetyPhrases) {
      phrases.push(sp);
    }
  }

  // ── Closing ──
  phrases.push({ text: 'Use caution.' });

  enqueuePhrases(phrases, call.priority);
}

/**
 * Announce a new call — full human readout for P1/P2, brief for P3/P4.
 */
export async function announceNewCall(call: DispatchCallData): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `newcall:${call.id || 'unknown'}:${call.call_number || ''}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  const tone = call.priority === 'P1' ? 'code3' : call.priority === 'P2' ? 'warning' : 'caution';
  await playToneAsync(tone);
  await delay(TONE_GAP_MS);

  const phrases: VoicePhrase[] = [];
  const isHighPriority = call.priority === 'P1' || call.priority === 'P2';

  // ── Opening ──
  let opening = 'New call coming in';
  if (call.call_number) opening += `, number ${shortCallNumber(call.call_number)}`;
  phrases.push({ text: opening + '.' });

  // ── Type ──
  if (call.incident_type) {
    let typeLine = `It's a ${formatIncidentType(call.incident_type)}`;
    if (call.priority) typeLine += `, ${call.priority}`;
    phrases.push({ text: typeLine + '.' });
  }

  // ── Location ──
  if (call.location) {
    let locLine = call.location;
    if (call.apartment) locLine += `, apartment ${call.apartment}`;
    else if (call.location_room) locLine += `, room ${call.location_room}`;
    if (call.location_floor) locLine += `, ${ordinal(call.location_floor)} floor`;
    if (call.business_name || call.property_name || call.client_name) {
      locLine += `, at the ${call.business_name || call.property_name || call.client_name}`;
    }
    phrases.push({ text: locLine + '.' });
  }

  if (isHighPriority && call.cross_street) {
    phrases.push({ text: `Cross street is ${call.cross_street}.` });
  }

  // Zone/Beat
  const areaParts: string[] = [];
  if (call.zone_name || call.zone) areaParts.push(`Zone ${call.zone_name || call.zone}`);
  if (call.beat_name || call.beat) areaParts.push(`Beat ${call.beat_name || call.beat}`);
  if (areaParts.length > 0) {
    phrases.push({ text: areaParts.join(', ') + '.' });
  }

  // ── Narrative (ALL priorities get it now — officers need to know what they're walking into) ──
  const narr = call.narrative || call.description || call.comments || '';
  if (narr) {
    const maxLen = isHighPriority ? 200 : 120;
    const cleaned = truncateForSpeech(narr, maxLen);
    const verb = call.source === 'phone' || call.source === '911' ? 'Caller says' :
                 call.source === 'walk_in' ? 'Walk-in is reporting' :
                 call.source === 'officer' ? 'Officer on scene reports' :
                 call.source === 'alarm' ? 'Alarm company reports' : 'We\'re told';
    phrases.push({ text: `${verb} ${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}${cleaned.endsWith('.') ? '' : '.'}` });
  }

  // ── Caller info ──
  if (call.caller_name && call.caller_name !== 'Anonymous') {
    let rpLine = `Your reporting party is ${call.caller_name}`;
    if (call.caller_relationship) rpLine += `, the ${call.caller_relationship}`;
    if (call.caller_phone) rpLine += `. You can reach them at ${formatPhone(call.caller_phone)}`;
    phrases.push({ text: rpLine + '.' });
  } else if (call.source === 'phone' || call.source === '911') {
    phrases.push({ text: 'Caller declined to give a name.' });
  }

  // ── People on scene ──
  if (call.num_subjects || call.num_victims) {
    const ppl: string[] = [];
    if (call.num_subjects) ppl.push(`${call.num_subjects} subject${call.num_subjects > 1 ? 's' : ''}`);
    if (call.num_victims) ppl.push(`${call.num_victims} victim${call.num_victims > 1 ? 's' : ''}`);
    phrases.push({ text: `We're looking at ${ppl.join(' and ')} on scene.` });
  }

  // ── Suspect description (all priorities) ──
  const suspDesc = call.suspect_description || call.subject_description;
  if (suspDesc) {
    let suspLine = `Your suspect's described as ${suspDesc}`;
    if (call.direction_of_travel) suspLine += `, last seen heading ${call.direction_of_travel}`;
    phrases.push({ text: suspLine + '.' });
  }

  // ── Vehicle (all priorities) ──
  if (call.vehicle_description) {
    let vLine = `There's a ${call.vehicle_description}`;
    if (call.vehicle_plate) vLine += `, plate ${spellOutPlate(call.vehicle_plate)}`;
    if (call.direction_of_travel && !suspDesc) vLine += `, last seen heading ${call.direction_of_travel}`;
    phrases.push({ text: vLine + '.' });
  }

  // ── Additional context flags ──
  if (call.juvenile_involved) {
    phrases.push({ text: 'Be advised, there\'s a juvenile involved.' });
  }
  if (call.alcohol_involved) {
    phrases.push({ text: 'Alcohol is a factor on this one.' });
  }
  if (call.drugs_involved) {
    phrases.push({ text: 'Drugs are involved.' });
  }

  // ── Scene conditions (all priorities — officer safety) ──
  if (call.lighting_conditions || call.weather_conditions) {
    const conds: string[] = [];
    if (call.lighting_conditions) conds.push(`it's ${call.lighting_conditions.toLowerCase()} out there`);
    if (call.weather_conditions) conds.push(call.weather_conditions.toLowerCase());
    phrases.push({ text: `Just so you know, ${conds.join(', with ')}.` });
  }

  // ── Call source context ──
  if (call.source === '911' || call.source === 'emergency') {
    phrases.push({ text: 'This came in through 9-1-1.' });
  }

  // ── Safety flags ──
  const safetyPhrases = buildCallPhrases(call);
  if (safetyPhrases.length > 0) {
    phrases.push({ text: 'Safety information follows.' });
    for (const sp of safetyPhrases) {
      phrases.push(sp);
    }
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

  const statusSentences: Record<string, string> = {
    dispatched: 'has been dispatched',
    enroute: 'is now enroute',
    onscene: 'is on scene',
    cleared: 'has been cleared',
    closed: 'is now closed',
    pending: 'is pending',
    hold: 'is on hold',
    cancelled: 'has been cancelled',
    backup_enroute: 'has backup enroute',
  };
  const statusText = statusSentences[newStatus] || `is now ${newStatus}`;
  const incidentType = call?.incident_type ? `, ${formatIncidentType(call.incident_type)}` : '';
  const location = call?.location || call?.location_address || '';
  const locText = location ? ` at ${abbreviateAddress(location)}` : '';

  await playToneAsync('info');
  await delay(TONE_GAP_MS);

  const phrases: VoicePhrase[] = [
    { text: `Call ${shortCallNumber(callNum)} ${statusText}${incidentType}${locText}.` }
  ];

  // On scene — read safety-critical info the officer needs RIGHT NOW
  if (newStatus === 'onscene' && call) {
    const suspDesc = call.suspect_description || call.subject_description;
    if (suspDesc) {
      phrases.push({ text: `Suspect is described as ${suspDesc}.` });
    }
    if (call.weapons_involved && call.weapons_involved !== 'None') {
      phrases.push({ text: `Be advised, weapons involved: ${call.weapons_involved}.` });
    }
    if (call.num_subjects && call.num_subjects > 1) {
      phrases.push({ text: `${call.num_subjects} subjects on scene.` });
    }
    if (call.scene_safety) {
      phrases.push({ text: `Scene safety: ${call.scene_safety}.` });
    }
  }

  // Enroute — remind of location and key details
  if (newStatus === 'enroute' && call) {
    if (call.cross_street) {
      phrases.push({ text: `Cross street is ${call.cross_street}.` });
    }
    const narr = call.narrative || call.description;
    if (narr) {
      const cleaned = truncateForSpeech(narr, 80);
      phrases.push({ text: cleaned.endsWith('.') ? cleaned : cleaned + '.' });
    }
  }

  enqueuePhrases(phrases);
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
  const incType = call?.incident_type ? `, ${formatIncidentType(call.incident_type)}` : '';
  const location = call?.location || call?.location_address || '';
  const loc = location ? ` at ${abbreviateAddress(location)}` : '';
  const phrases: VoicePhrase[] = [];

  // Who's going where
  const msg = unitNames
    ? `${unitNames} has been dispatched to call ${shortCallNumber(callNum)}${incType}${loc}.`
    : `Units dispatched to call ${shortCallNumber(callNum)}${incType}${loc}.`;
  phrases.push({ text: msg });

  // Critical safety info for the responding officer
  if (call) {
    if (call.weapons_involved && call.weapons_involved !== 'None') {
      phrases.push({ text: `Be advised, weapons involved: ${call.weapons_involved}.` });
    }
    if (call.officer_safety_caution) {
      phrases.push({ text: 'Officer safety caution, use caution on approach.' });
    }
    const suspDesc = call.suspect_description || call.subject_description;
    if (suspDesc) {
      phrases.push({ text: `Suspect is described as ${suspDesc}.` });
    }
    if (call.vehicle_description) {
      let vLine = `Vehicle is a ${call.vehicle_description}`;
      if (call.vehicle_plate) vLine += `, plate ${spellOutPlate(call.vehicle_plate)}`;
      phrases.push({ text: vLine + '.' });
    }
    if (call.cross_street) {
      phrases.push({ text: `Cross street is ${call.cross_street}.` });
    }
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
  const phrases: VoicePhrase[] = [{ text: 'Attention all units. Be on the lookout.' }];
  if (description) phrases.push({ text: description + '.' });
  enqueuePhrases(phrases, 'P2');
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
  const phrases: VoicePhrase[] = [{ text: `Caution. We have an active warrant hit on ${personName}.` }];
  if (count > 1) {
    phrases.push({ text: `${count} active warrants on file.` });
  }
  enqueuePhrases(phrases, 'P1');
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
 * Truncate narrative text to a max character length for speech.
 * Cuts at sentence boundaries when possible. Strips HTML tags.
 * Dispatcher reads only the essential first sentence or two.
 */
function truncateForSpeech(text: string, maxLen: number): string {
  // Strip HTML tags if any
  let clean = text.replace(/<[^>]*>/g, '').trim();
  if (clean.length <= maxLen) return clean;

  // Try to cut at a sentence boundary
  const truncated = clean.substring(0, maxLen);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastExclaim = truncated.lastIndexOf('!');
  const cutPoint = Math.max(lastPeriod, lastExclaim);

  if (cutPoint > maxLen * 0.4) {
    return truncated.substring(0, cutPoint + 1);
  }
  // Fall back to word boundary
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated;
}

/**
 * Spell out a license plate using NATO phonetic alphabet.
 * "ABC123" → "Alpha Bravo Charlie, one two three"
 * This is how real dispatchers read plates over radio — letter by letter.
 */
function spellOutPlate(plate: string): string {
  const NATO: Record<string, string> = {
    A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo',
    F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliet',
    K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar',
    P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango',
    U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee',
    Z: 'Zulu',
  };

  const letters: string[] = [];
  const numbers: string[] = [];
  let inNumbers = false;

  for (const ch of plate.toUpperCase().replace(/[^A-Z0-9]/g, '')) {
    if (/[A-Z]/.test(ch)) {
      if (inNumbers && numbers.length > 0) {
        letters.push(numbers.join(' '));
        numbers.length = 0;
      }
      inNumbers = false;
      letters.push(NATO[ch] || ch);
    } else {
      inNumbers = true;
      numbers.push(ch);
    }
  }
  if (numbers.length > 0) letters.push(numbers.join(' '));

  return letters.join(', ');
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
 * Convert floor number to ordinal: "1" → "first", "2" → "second", "3" → "third", "12" → "12th".
 */
function ordinal(floor: string): string {
  const n = parseInt(floor, 10);
  if (isNaN(n)) return floor;
  const words: Record<number, string> = {
    1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth',
    6: 'sixth', 7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth',
  };
  if (words[n]) return words[n];
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Format phone number for natural speech.
 * "8015551234" → "801, 555, 1234"
 * Dispatchers read phone numbers in groups with pauses.
 */
function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}, ${digits.slice(3, 6)}, ${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `${digits.slice(1, 4)}, ${digits.slice(4, 7)}, ${digits.slice(7)}`;
  }
  return phone; // return as-is if non-standard
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
