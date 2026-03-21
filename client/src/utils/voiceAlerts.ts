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

const SPEECH_PITCH = 1.02;

/** Priority-based speech parameters — adjusts rate/pitch/volume for urgency level */
interface PrioritySpeechParams {
  rateMultiplier: number;  // multiplied against user's base rate
  pitchOffset: number;     // added to base pitch
  volumeMultiplier: number;
}

const PRIORITY_PARAMS: Record<string, PrioritySpeechParams> = {
  PANIC: { rateMultiplier: 1.15, pitchOffset: 0.15, volumeMultiplier: 1.0 },
  P1:    { rateMultiplier: 1.1,  pitchOffset: 0.12, volumeMultiplier: 1.0 },
  P2:    { rateMultiplier: 1.0,  pitchOffset: 0.05, volumeMultiplier: 0.95 },
  P3:    { rateMultiplier: 0.95, pitchOffset: 0,    volumeMultiplier: 0.9 },
  P4:    { rateMultiplier: 0.9,  pitchOffset: -0.02, volumeMultiplier: 0.85 },
};

// ─── Voice Selection ────────────────────────────────────────

let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesLoaded = false;

/**
 * Select the best available female voice.
 * Priority: Premium enhanced voices first (Google WaveNet, Apple Enhanced),
 * then standard female voices, then any English voice.
 * Higher-quality voices produce dramatically more natural-sounding alerts.
 */
function selectFemaleVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice && voicesLoaded) return cachedVoice;
  if (!isSpeechAvailable()) return null;

  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  voicesLoaded = true;

  // Priority candidates — premium/enhanced voices first for natural sound
  const candidates: Array<(v: SpeechSynthesisVoice) => boolean> = [
    // Tier 1: Premium enhanced voices (dramatically more natural)
    (v) => /samantha.*enhanced/i.test(v.name),                          // macOS Enhanced Samantha
    (v) => /karen.*enhanced/i.test(v.name),                             // macOS Enhanced Karen
    (v) => /google.*us.*english.*female/i.test(v.name),                 // Chrome Google HD Female
    (v) => /microsoft.*zira.*online/i.test(v.name),                     // Edge Online Zira (neural)
    (v) => /microsoft.*jenny/i.test(v.name),                            // Windows 11 Jenny (neural)
    // Tier 2: Standard quality named voices
    (v) => /zira/i.test(v.name),                                        // Windows Zira
    (v) => /samantha/i.test(v.name),                                    // macOS Samantha (standard)
    (v) => /karen/i.test(v.name) && v.lang.startsWith('en'),            // macOS Karen (AU English)
    (v) => /google.*english/i.test(v.name) && /female/i.test(v.name),   // Any Google Female
    // Tier 3: Any female English voice
    (v) => /female/i.test(v.name) && v.lang.startsWith('en'),
    // Tier 4: Any English voice
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

    const utterance = new SpeechSynthesisUtterance(phrase.text);
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
 * TTS engines handle sentence-case text far better — proper intonation,
 * natural pacing, and no letter-by-letter spelling of acronyms.
 * Punctuation pauses (commas, periods) add breathing room.
 */
function naturalPhrase(text: string): string {
  // Map of dispatch shorthand → natural spoken form
  const NATURAL_MAP: Record<string, string> = {
    'ACTIVE WARRANTS': 'Active warrants on file.',
    'ARMED SUSPECT': 'Caution, armed suspect.',
    'VIOLENT SUSPECT': 'Caution, violent suspect.',
    'MENTAL SUSPECT': 'Mental health concern noted.',
    'KNOWN DRUG USER': 'Known drug user.',
    'ESCAPE RISK': 'Caution, escape risk.',
    'SUICIDE RISK': 'Caution, suicide risk.',
    'REGISTERED SEX OFFENDER': 'Registered sex offender.',
    'GANG AFFILIATED': 'Gang affiliation noted.',
    'WATCHLIST MATCH': 'Watchlist match detected.',
    'FEDERAL WATCHLIST HIT': 'Federal watchlist hit.',
    'UTAH STATE WARRANT': 'Utah state warrant on file.',
    'CRIMINAL HISTORY': 'Prior criminal history.',
    'WARRANT HIT': 'Warrant hit.',
    'ARMED SUBJECT': 'Caution, armed subject reported.',
    'FELONY IN PROGRESS': 'Felony in progress.',
    'OFFICER SAFETY CAUTION': 'Officer safety caution.',
    'VEHICLE PURSUIT': 'Vehicle pursuit in progress.',
    'FOOT PURSUIT': 'Foot pursuit in progress.',
    'DOMESTIC VIOLENCE': 'Domestic violence call.',
    'GANG RELATED': 'Gang related incident.',
    'HAZMAT': 'Hazmat situation.',
    'MENTAL HEALTH CRISIS': 'Mental health crisis.',
    'INJURIES REPORTED': 'Injuries reported.',
    'E M S REQUESTED': 'E.M.S. requested.',
    'K 9 REQUESTED': 'K-9 requested.',
    'DRUGS INVOLVED': 'Drugs involved.',
    'PRIOR ARMED CALLS AT LOCATION': 'Prior armed calls at location.',
    'PRIOR DOMESTIC VIOLENCE AT LOCATION': 'Prior DV at location.',
    'PRIOR DRUG ACTIVITY AT LOCATION': 'Prior drug activity at location.',
    'PANIC ALERT': 'Panic alert.',
    'OFFICER NEEDS ASSISTANCE': 'Officer needs immediate assistance.',
    'STOLEN VEHICLE': 'Stolen vehicle.',
    'BOLO HIT': 'Be on the lookout, hit confirmed.',
    'HIT AND RUN': 'Hit and run.',
    'DISPATCH': 'Dispatch.',
    'NEW CALL': 'New call.',
    'PRIORITY ONE': 'Priority one.',
    'PRIORITY TWO': 'Priority two.',
  };

  return NATURAL_MAP[text] || text;
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
