// ============================================================
// RMPG Flex — Voice-Synthesized Safety Alerts
// Browser-native SpeechSynthesis API for automated dispatch
// safety alerts. Female voice, queued announcements, respects
// both the master sound toggle and a dedicated voice toggle.
// Follows Spillman Flex cadence: crisp, urgent, sequential.
// ============================================================

import { playToneAsync } from './dispatchTones';
import { devLog } from './devLog';

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
}

interface VoicePhrase {
  text: string;
}

// ─── Constants ──────────────────────────────────────────────

/** localStorage key for voice alerts toggle (separate from rmpg-sound) */
const VOICE_ALERTS_KEY = 'rmpg-voice-alerts';

/** Inter-phrase pause in milliseconds */
const PHRASE_GAP_MS = 200;

/** Post-tone pause before speech begins */
const TONE_GAP_MS = 300;

/** Deduplication cache TTL (60 seconds) */
const DEDUP_TTL_MS = 60_000;

/** SpeechSynthesisUtterance configuration */
const SPEECH_RATE = 1.05;   // slightly faster — urgent dispatch cadence
const SPEECH_PITCH = 1.0;   // natural pitch
const SPEECH_VOLUME = 0.9;  // loud but not clipping

// ─── Voice Selection ────────────────────────────────────────

let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesLoaded = false;

/**
 * Select the best available female voice.
 * Priority: Zira (Windows) → Google US Female → Samantha (macOS)
 * → any "female" voice → any English voice → default.
 */
function selectFemaleVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice && voicesLoaded) return cachedVoice;
  if (!isSpeechAvailable()) return null;

  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  voicesLoaded = true;

  // Priority candidates
  const candidates: Array<(v: SpeechSynthesisVoice) => boolean> = [
    (v) => /zira/i.test(v.name),
    (v) => /google.*us.*english/i.test(v.name) && /female/i.test(v.name),
    (v) => /samantha/i.test(v.name),
    (v) => /female/i.test(v.name) && v.lang.startsWith('en'),
    (v) => v.lang.startsWith('en-US'),
    (v) => v.lang.startsWith('en'),
  ];

  for (const test of candidates) {
    const match = voices.find(test);
    if (match) {
      cachedVoice = match;
      devLog(`[VoiceAlerts] Selected voice: "${match.name}" (${match.lang})`);
      return cachedVoice;
    }
  }

  // Ultimate fallback
  cachedVoice = voices[0];
  devLog(`[VoiceAlerts] Fallback voice: "${voices[0].name}" (${voices[0].lang})`);
  return cachedVoice;
}

// Pre-load voices when module initializes
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  speechSynthesis.addEventListener('voiceschanged', () => {
    cachedVoice = null;
    voicesLoaded = false;
    selectFemaleVoice();
  });
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
  return localStorage.getItem('rmpg-sound') !== 'false'
    && localStorage.getItem(VOICE_ALERTS_KEY) !== 'false';
}

export function setVoiceAlertsEnabled(enabled: boolean): void {
  localStorage.setItem(VOICE_ALERTS_KEY, String(enabled));
}

export function getVoiceAlertsEnabled(): boolean {
  return localStorage.getItem(VOICE_ALERTS_KEY) !== 'false';
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

// ─── Speech Queue ───────────────────────────────────────────

let phraseQueue: VoicePhrase[] = [];
let isSpeaking = false;

function speakPhrase(phrase: VoicePhrase): Promise<void> {
  return new Promise((resolve) => {
    if (!isSpeechAvailable()) { resolve(); return; }

    const utterance = new SpeechSynthesisUtterance(phrase.text);
    const voice = selectFemaleVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = SPEECH_RATE;
    utterance.pitch = SPEECH_PITCH;
    utterance.volume = SPEECH_VOLUME;
    utterance.lang = 'en-US';
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve(); // don't block queue on errors
    speechSynthesis.speak(utterance);
  });
}

async function processQueue(): Promise<void> {
  if (isSpeaking) return;
  isSpeaking = true;

  while (phraseQueue.length > 0) {
    const phrase = phraseQueue.shift()!;
    await speakPhrase(phrase);
    // Inter-phrase pause
    if (phraseQueue.length > 0) {
      await delay(PHRASE_GAP_MS);
    }
  }

  isSpeaking = false;
}

function enqueuePhrases(phrases: VoicePhrase[]): void {
  if (phrases.length === 0) return;
  phraseQueue.push(...phrases);
  processQueue();
}

/** Clear all pending phrases and cancel current speech. */
export function clearVoiceQueue(): void {
  phraseQueue = [];
  if (isSpeechAvailable()) {
    speechSynthesis.cancel();
  }
  isSpeaking = false;
}

// ─── Phrase Builders ────────────────────────────────────────

/**
 * Build spoken phrases from a safety screening result.
 * Each unique alert condition produces one short phrase.
 */
function buildScreeningPhrases(result: ScreeningResult): VoicePhrase[] {
  const phrases: VoicePhrase[] = [];
  const seen = new Set<string>();

  const add = (text: string) => {
    if (!seen.has(text)) { seen.add(text); phrases.push({ text }); }
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
 */
function buildCallPhrases(call: CallFlags): VoicePhrase[] {
  const phrases: VoicePhrase[] = [];

  // Critical
  if (call.weapons_involved) phrases.push({ text: 'ARMED SUBJECT' });
  if (call.felony_in_progress) phrases.push({ text: 'FELONY IN PROGRESS' });
  if (call.officer_safety_caution) phrases.push({ text: 'OFFICER SAFETY CAUTION' });
  if (call.vehicle_pursuit) phrases.push({ text: 'VEHICLE PURSUIT' });
  if (call.foot_pursuit) phrases.push({ text: 'FOOT PURSUIT' });
  if (call.domestic_violence) phrases.push({ text: 'DOMESTIC VIOLENCE' });
  if (call.gang_related) phrases.push({ text: 'GANG RELATED' });
  if (call.hazmat) phrases.push({ text: 'HAZMAT' });

  // High
  if (call.mental_health_crisis) phrases.push({ text: 'MENTAL HEALTH CRISIS' });
  if (call.injuries_reported) phrases.push({ text: 'INJURIES REPORTED' });
  if (call.ems_requested) phrases.push({ text: 'E M S REQUESTED' });
  if (call.k9_requested) phrases.push({ text: 'K 9 REQUESTED' });
  if (call.drugs_involved) phrases.push({ text: 'DRUGS INVOLVED' });

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

  // Play alarm tone (urgent repeating two-tone)
  await playToneAsync('alarm');
  await delay(TONE_GAP_MS);

  const phrases: VoicePhrase[] = [
    { text: 'PANIC ALERT' },
    { text: 'OFFICER NEEDS ASSISTANCE' },
  ];
  if (officerName) {
    phrases.push({ text: officerName });
  }
  enqueuePhrases(phrases);
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

  // Play info tone for dispatch confirmation
  await playToneAsync('info');
  await delay(TONE_GAP_MS);

  const phrases: VoicePhrase[] = [{ text: 'DISPATCH' }];
  if (call.call_number) phrases.push({ text: `CALL ${call.call_number}` });
  if (call.incident_type) {
    const type = call.incident_type.replace(/_/g, ' ').toUpperCase();
    phrases.push({ text: type });
  }
  if (call.priority === 'P1') phrases.push({ text: 'PRIORITY ONE' });
  else if (call.priority === 'P2') phrases.push({ text: 'PRIORITY TWO' });
  if (call.location) phrases.push({ text: `AT ${call.location}` });

  // Append safety flags
  const safetyPhrases = buildCallPhrases(call);
  if (safetyPhrases.length > 0) phrases.push(...safetyPhrases);

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

  // Play caution tone for new calls
  await playToneAsync('caution');
  await delay(TONE_GAP_MS);

  const phrases: VoicePhrase[] = [{ text: 'NEW CALL' }];
  if (call.call_number) phrases.push({ text: `CALL ${call.call_number}` });
  if (call.incident_type) {
    const type = call.incident_type.replace(/_/g, ' ').toUpperCase();
    phrases.push({ text: type });
  }
  if (call.priority === 'P1') phrases.push({ text: 'PRIORITY ONE' });
  else if (call.priority === 'P2') phrases.push({ text: 'PRIORITY TWO' });

  // Append safety flags
  const safetyPhrases = buildCallPhrases(call);
  if (safetyPhrases.length > 0) phrases.push(...safetyPhrases);

  enqueuePhrases(phrases);
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
    devLog(`[VoiceAlerts Demo] ── ${group.label} ──`);
    await playToneAsync(group.tone);
    await delay(TONE_GAP_MS);

    for (const text of group.phrases) {
      await speakPhrase({ text });
      await delay(PHRASE_GAP_MS);
    }

    // Pause between groups
    await delay(800);
  }

  devLog('[VoiceAlerts Demo] ── Complete ──');
}

// ─── Helpers ────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
