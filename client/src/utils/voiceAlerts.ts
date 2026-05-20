// ============================================================
// RMPG Flex — Voice-Synthesized Safety Alerts
// Browser-native SpeechSynthesis API for automated dispatch
// safety alerts. Female voice, queued announcements, respects
// both the master sound toggle and a dedicated voice toggle.
// Follows Spillman Flex cadence: crisp, urgent, sequential.
// ============================================================

import { playToneAsync } from './dispatchTones';
import { renderCallNarrative, type Terseness, type CallSlots } from './narrativeRenderer';

// ─── Terseness adapter (Task 1.6) ───────────────────────────
// Reads the user's voice persona terseness from localStorage (written
// by useVoicePersona). In 'terse' / 'narrative' modes we delegate
// phrasing to renderCallNarrative; 'standard' keeps the existing rich
// phrase pipeline for backward compatibility.

function currentTerseness(): Terseness {
  const raw = typeof localStorage !== 'undefined'
    ? localStorage.getItem('rmpg-voice-terseness')
    : null;
  return raw === 'narrative' || raw === 'terse' ? raw : 'standard';
}

function priorityToNumber(p?: string): number | undefined {
  if (!p) return undefined;
  const m = p.match(/^P([1-4])$/);
  return m ? Number(m[1]) : undefined;
}

function humanizeType(t?: string): string | undefined {
  if (!t) return undefined;
  return t.replace(/_/g, ' ').toUpperCase();
}

function toCallSlots(call: {
  call_number?: string;
  priority?: string;
  incident_type?: string;
  location?: string;
  location_address?: string;
  apartment?: string;
  zone_code?: string;
  beat_code?: string;
  dispatch_code?: string;
  suspect_description?: string;
  vehicle_description?: string;
  assigned_units?: string[];
}): CallSlots {
  return {
    call_number: call.call_number,
    priority: priorityToNumber(call.priority),
    incident_type: humanizeType(call.incident_type),
    location_address: call.location_address ?? call.location,
    apartment: call.apartment,
    zone_code: call.zone_code,
    beat_code: call.beat_code,
    dispatch_code: call.dispatch_code,
    suspect_description: call.suspect_description,
    vehicle_description: call.vehicle_description,
    assigned_units: call.assigned_units,
  };
}

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

/** Inter-phrase pause in milliseconds — slightly longer for natural breathing rhythm */
const PHRASE_GAP_MS = 350;

/** Post-tone pause before speech begins */
const TONE_GAP_MS = 400;

/** Deduplication cache TTL (60 seconds) */
const DEDUP_TTL_MS = 60_000;

/** SpeechSynthesisUtterance configuration — tuned for natural human-like cadence */
const SPEECH_RATE = 0.95;   // slightly slower than default — clearer, more natural
const SPEECH_PITCH = 1.02;  // very slight pitch lift for authority/clarity
const SPEECH_VOLUME = 0.92; // loud but not clipping

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
      return cachedVoice;
    }
  }

  // Ultimate fallback — guard against empty voices array
  if (voices.length > 0) {
    cachedVoice = voices[0];
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
  // Route ALL speech through Edge TTS (neural voice) — no browser SpeechSynthesis
  return new Promise(async (resolve) => {
    try {
      const { speak: edgeSpeak } = await import('./edgeTTS');
      await edgeSpeak(phrase.text);
    } catch {
      // Edge TTS unavailable — fall back to browser SpeechSynthesis as last resort
      if (isSpeechAvailable()) {
        const utterance = new SpeechSynthesisUtterance(phrase.text);
        const voice = selectFemaleVoice();
        if (voice) utterance.voice = voice;
        utterance.rate = SPEECH_RATE;
        utterance.pitch = SPEECH_PITCH;
        utterance.volume = SPEECH_VOLUME;
        utterance.lang = 'en-US';
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        speechSynthesis.speak(utterance);
        return;
      }
    }
    resolve();
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
}

// ─── NATO Phonetic Alphabet ─────────────────────────────────

const NATO_ALPHABET: Record<string, string> = {
  A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo',
  F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliet',
  K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar',
  P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango',
  U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee',
  Z: 'Zulu',
};

/**
 * Convert alphanumeric text to NATO phonetic alphabet.
 * Letters become their NATO word; digits stay as-is.
 * Example: "ABC1234" → "Alpha Bravo Charlie 1 2 3 4"
 */
export function toPhonetic(text: string): string {
  return text.toUpperCase().split('').map(ch => {
    if (NATO_ALPHABET[ch]) return NATO_ALPHABET[ch];
    if (/\d/.test(ch)) return ch; // digits stay as-is
    return '';
  }).filter(Boolean).join(' ');
}

/**
 * Format a license plate using NATO phonetic alphabet.
 * Strips non-alphanumeric characters, then converts each character.
 * Example: "ABC-1234" → "Alpha Bravo Charlie 1 2 3 4"
 */
function formatPlatePhonetic(plate: string): string {
  return plate.replace(/[^A-Z0-9]/gi, '').split('').map(ch => {
    const upper = ch.toUpperCase();
    return NATO_ALPHABET[upper] || ch;
  }).join(' ');
}

// ─── Natural Speech Helpers ─────────────────────────────────

/** Pattern for license plates: 2-4 letters followed by 1-5 digits (with optional separator) */
const PLATE_PATTERN = /\b([A-Z]{2,4})[- ]?(\d{1,5})\b/gi;

/** Pattern for mixed alphanumeric plates like 7A1B2C3 */
const MIXED_PLATE_PATTERN = /\b(\d[A-Z]\d[A-Z]\d[A-Z]\d)\b/gi;

/** Pattern for 24-hour time: HH:MM */
const TIME_24H_PATTERN = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;

/**
 * Convert robotic ALL-CAPS dispatch text into natural spoken English.
 * TTS engines handle sentence-case text far better — proper intonation,
 * natural pacing, and no letter-by-letter spelling of acronyms.
 * Punctuation pauses (commas, periods) add breathing room.
 *
 * Also handles:
 * - License plate conversion to NATO phonetic alphabet
 * - 24-hour time to spoken form ("14:30" → "at fourteen thirty hours")
 */
function naturalPhrase(text: string): string {
  // Convert license plates to phonetic before checking the map
  let processed = text.replace(PLATE_PATTERN, (_match, letters, digits) => {
    return `plate ${formatPlatePhonetic(letters + digits)}`;
  });
  processed = processed.replace(MIXED_PLATE_PATTERN, (_match, plate) => {
    return `plate ${formatPlatePhonetic(plate)}`;
  });

  // Convert 24-hour time to spoken form
  processed = processed.replace(TIME_24H_PATTERN, (_match, hours, minutes) => {
    const h = parseInt(hours, 10);
    const m = parseInt(minutes, 10);
    if (m === 0) return `at ${h} hundred hours`;
    return `at ${h} ${m < 10 ? 'oh ' + m : m} hours`;
  });

  // If the processed text was transformed, return it (skip the static map)
  if (processed !== text) return processed;

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
    'INJURIES REPORTED': 'Injuries have been reported.',
    'E M S REQUESTED': 'E.M.S. has been requested.',
    'K 9 REQUESTED': 'K-9 unit has been requested.',
    'DRUGS INVOLVED': 'Drugs are involved.',
    'PRIOR ARMED CALLS AT LOCATION': 'Prior armed calls at this location.',
    'PRIOR DOMESTIC VIOLENCE AT LOCATION': 'Prior domestic violence at this location.',
    'PRIOR DRUG ACTIVITY AT LOCATION': 'Prior drug activity at this location.',
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
    if (p.gang_affiliation && !['none', '0', 'n/a', 'na', ''].includes(p.gang_affiliation.toLowerCase().trim())) add('GANG AFFILIATED');

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

  // Critical
  if (call.weapons_involved && call.weapons_involved !== 'None') phrases.push({ text: naturalPhrase('ARMED SUBJECT') });
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

// ─── Safety Flag Summary ───────────────────────────────────

/**
 * Build a concise, spoken-friendly summary of active safety flags.
 * Returns a comma-separated string like "weapons involved, domestic violence, officer safety"
 * or empty string if no flags.
 */
function buildSafetyFlagSummary(call: CallFlags): string {
  const flags: string[] = [];
  // Critical flags first
  if (call.weapons_involved && call.weapons_involved !== 'None') flags.push('weapons involved');
  if (call.felony_in_progress) flags.push('felony in progress');
  if (call.officer_safety_caution) flags.push('officer safety');
  if (call.vehicle_pursuit) flags.push('vehicle pursuit');
  if (call.foot_pursuit) flags.push('foot pursuit');
  if (call.domestic_violence) flags.push('domestic violence');
  if (call.gang_related) flags.push('gang related');
  if (call.hazmat) flags.push('hazmat');
  // High priority
  if (call.mental_health_crisis) flags.push('mental health crisis');
  if (call.injuries_reported) flags.push('injuries reported');
  if (call.ems_requested) flags.push('E.M.S. requested');
  if (call.k9_requested) flags.push('K-9 requested');
  if (call.drugs_involved) flags.push('drugs involved');
  return flags.join(', ');
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
 * Announce safety alerts from a call's flags with call reference:
 * "Caution. Call 26-CFS00110 has active flags: weapons involved, officer safety. Use caution on approach."
 */
export async function announceCallAlerts(call: CallFlags & {
  call_number?: string;
  location?: string;
  location_address?: string;
}): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const flagSummary = buildSafetyFlagSummary(call);
  if (!flagSummary) return;

  // Dedup
  const dedupKey = `call:${call.id || 'unknown'}:${flagSummary}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  // Play warning tone first, then speak
  await playToneAsync('warning');
  await delay(TONE_GAP_MS);

  const phrases: VoicePhrase[] = [];
  const callRef = call.call_number ? `Call ${call.call_number}` : 'Current call';
  phrases.push({ text: `Caution. ${callRef} has active flags: ${flagSummary}.` });
  phrases.push({ text: 'Use caution on approach.' });

  enqueuePhrases(phrases);
}

/**
 * Announce a panic alert with location details:
 * "PANIC ALERT. OFFICER NEEDS IMMEDIATE ASSISTANCE. Officer Smith, unit S19. All units respond."
 */
export async function announcePanicAlert(officerName?: string, location?: string, callSign?: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `panic:${officerName || 'unknown'}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  // Play alarm tone twice for emphasis (urgent repeating two-tone)
  await playToneAsync('alarm');
  await delay(200);
  await playToneAsync('alarm');
  await delay(TONE_GAP_MS);

  const phrases: VoicePhrase[] = [
    { text: 'Panic alert. Officer needs immediate assistance.' },
  ];
  if (officerName || callSign) {
    let officer = '';
    if (officerName) officer += `Officer ${officerName}`;
    if (callSign) officer += officer ? `, unit ${callSign}` : `Unit ${callSign}`;
    phrases.push({ text: `${officer}.` });
  }
  if (location) {
    phrases.push({ text: `Location: ${location}.` });
  }
  phrases.push({ text: 'All units respond.' });
  enqueuePhrases(phrases);
}

/**
 * Announce a dispatch event with full detail:
 * "Dispatch, call 26-CFS00110. Priority 2. PSO Client Request at 3392 Mockingbird Way.
 *  Caution: weapons involved, officer safety."
 */
export async function announceDispatchEvent(call: CallFlags & {
  call_number?: string;
  incident_type?: string;
  location?: string;
  location_address?: string;
  priority?: string;
  caller_name?: string;
  city?: string;
  assigned_units?: string[];
}): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `dispatch:${call.id || 'unknown'}:${call.call_number || ''}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  // Play alert tone for dispatch
  await playToneAsync('alert');
  await delay(TONE_GAP_MS);

  // Terseness adapter: short-circuit rich phrasing for 'terse' or 'narrative'.
  const t = currentTerseness();
  if (t !== 'standard') {
    const text = renderCallNarrative(toCallSlots(call), t);
    if (text) enqueuePhrases([{ text }]);
    return;
  }

  const phrases: VoicePhrase[] = [];

  // "Dispatch, call 26-CFS00110"
  phrases.push({ text: `Dispatch${call.call_number ? `, call ${call.call_number}` : ''}.` });

  // Priority
  const priorityLabel = call.priority === 'P1' ? 'Priority 1, emergency.' : call.priority === 'P2' ? 'Priority 2.' : '';
  if (priorityLabel) phrases.push({ text: priorityLabel });

  // Incident type + location
  const type = call.incident_type ? call.incident_type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : '';
  const loc = call.location || call.location_address || '';
  if (type && loc) {
    const city = call.city || '';
    phrases.push({ text: `${type} at ${loc}${city ? `, ${city}` : ''}.` });
  } else if (type) {
    phrases.push({ text: `${type}.` });
  } else if (loc) {
    phrases.push({ text: `At ${loc}.` });
  }

  // Assigned units
  if (call.assigned_units && call.assigned_units.length > 0) {
    const unitList = call.assigned_units.slice(0, 3).join(', ');
    phrases.push({ text: `Units: ${unitList}.` });
  }

  // Safety flags — concise summary
  const flagSummary = buildSafetyFlagSummary(call);
  if (flagSummary) {
    phrases.push({ text: `Caution: ${flagSummary}. Use caution on approach.` });
  }

  enqueuePhrases(phrases);
}

/**
 * Announce a new call arrival with full dispatch cadence:
 * "Attention all units. New priority 2 call. PSO Client Request at 3392 Mockingbird Way. Caller: Michael Currie."
 * Plays a priority-appropriate tone and announces call details. Used on call_created events.
 */
export async function announceNewCall(call: CallFlags & {
  call_number?: string;
  incident_type?: string;
  priority?: string;
  location?: string;
  location_address?: string;
  caller_name?: string;
  caller_phone?: string;
  city?: string;
  description?: string;
}): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `newcall:${call.id || 'unknown'}:${call.call_number || ''}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  // Play priority-appropriate tone
  if (call.priority === 'P1') await playToneAsync('alarm');
  else if (call.priority === 'P2') await playToneAsync('warning');
  else await playToneAsync('caution');
  await delay(TONE_GAP_MS);

  // Terseness adapter: short-circuit rich phrasing for 'terse' or 'narrative'.
  const t = currentTerseness();
  if (t !== 'standard') {
    const text = renderCallNarrative(toCallSlots(call), t);
    if (text) enqueuePhrases([{ text }]);
    return;
  }

  const phrases: VoicePhrase[] = [];

  // Opening — "Attention all units" for P1/P2, just "New call" for routine
  if (call.priority === 'P1' || call.priority === 'P2') {
    phrases.push({ text: 'Attention all units.' });
  }

  // Priority + call type
  const priorityLabel = call.priority === 'P1' ? 'priority 1' : call.priority === 'P2' ? 'priority 2' : call.priority === 'P3' ? 'priority 3' : call.priority === 'P4' ? 'priority 4' : '';
  const type = call.incident_type ? call.incident_type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : 'call';
  phrases.push({ text: `New ${priorityLabel} call. ${type}.` });

  // Location
  const loc = call.location || call.location_address || '';
  if (loc) {
    const city = call.city || '';
    phrases.push({ text: `At ${loc}${city ? `, ${city}` : ''}.` });
  }

  // Caller
  if (call.caller_name) {
    phrases.push({ text: `Caller: ${call.caller_name}.` });
  }

  // Safety flags — critical ones announced inline
  const flagSummary = buildSafetyFlagSummary(call);
  if (flagSummary) {
    phrases.push({ text: `Caution: ${flagSummary}.` });
  }

  enqueuePhrases(phrases);
}

// ─── Additional Dispatch Voice Alerts ────────────────────────

/**
 * Announce a status change with dispatch cadence:
 * "Unit S19, en route to call 26-CFS00110."
 * "Unit S19, on scene at 3392 Mockingbird Way."
 * "Unit S19, clear from call 26-CFS00110. Disposition: Personal Service."
 */
export async function announceStatusChange(callOrSign: string | { call_sign?: string; call_number?: string; location?: string; location_address?: string; disposition?: string; assigned_units?: string[] }, newStatus: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  // Support both simple callSign string and rich call object
  let callSign: string;
  let callNumber: string | undefined;
  let location: string | undefined;
  let disposition: string | undefined;

  if (typeof callOrSign === 'string') {
    callSign = callOrSign;
  } else {
    callSign = callOrSign.call_sign || (callOrSign.assigned_units?.[0]) || 'unknown';
    callNumber = callOrSign.call_number;
    location = callOrSign.location || callOrSign.location_address;
    disposition = callOrSign.disposition;
  }

  const dedupKey = `status:${callSign}:${newStatus}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  // Play appropriate chirp based on status
  const statusNorm = newStatus.replace(/_/g, '').toLowerCase();
  if (statusNorm === 'enroute') {
    await playToneAsync('info');
    await delay(200);
    enqueuePhrases([{ text: `Unit ${callSign}, en route${callNumber ? ` to call ${callNumber}` : ''}.` }]);
  } else if (statusNorm === 'onscene') {
    await playToneAsync('info');
    await delay(100);
    await playToneAsync('info');
    await delay(200);
    enqueuePhrases([{ text: `Unit ${callSign}, on scene${location ? ` at ${location}` : callNumber ? ` on call ${callNumber}` : ''}.` }]);
  } else if (statusNorm === 'cleared' || statusNorm === 'closed') {
    enqueuePhrases([{
      text: `Unit ${callSign}, clear${callNumber ? ` from call ${callNumber}` : ''}.${disposition ? ` Disposition: ${disposition.replace(/_/g, ' ').toUpperCase()}.` : ''}`
    }]);
  } else {
    const status = newStatus.replace(/_/g, ' ').toUpperCase();
    enqueuePhrases([{ text: `Unit ${callSign}, now ${status}.` }]);
  }
}

/**
 * Announce unit dispatched with location details:
 * "Unit S19, dispatched to call 26-CFS00110. PSO Client Request at 3392 Mockingbird Way."
 */
export async function announceUnitDispatched(callOrSign: string | { call_sign?: string; call_number?: string; incident_type?: string; location?: string; location_address?: string; assigned_units?: string[] }, callNumberOrUnits?: string | string[]): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  let callSign: string;
  let callNumber: string | undefined;
  let incidentType: string | undefined;
  let location: string | undefined;

  if (typeof callOrSign === 'string') {
    callSign = callOrSign;
    callNumber = typeof callNumberOrUnits === 'string' ? callNumberOrUnits : undefined;
  } else {
    // Rich call object — units passed as second arg
    const unitNames = Array.isArray(callNumberOrUnits) ? callNumberOrUnits : [];
    callSign = unitNames.length > 0 ? unitNames.join(' and ') : (callOrSign.call_sign || callOrSign.assigned_units?.[0] || 'unit');
    callNumber = callOrSign.call_number;
    incidentType = callOrSign.incident_type;
    location = callOrSign.location || callOrSign.location_address;
  }

  const dedupKey = `dispatched:${callSign}:${callNumber || ''}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('info');
  await delay(200);

  const phrases: VoicePhrase[] = [];
  let mainText = `Unit ${callSign}, dispatched`;
  if (callNumber) mainText += ` to call ${callNumber}`;
  mainText += '.';
  phrases.push({ text: mainText });

  if (incidentType) {
    const type = incidentType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    phrases.push({ text: `${type}${location ? ` at ${location}` : ''}.` });
  } else if (location) {
    phrases.push({ text: `At ${location}.` });
  }

  enqueuePhrases(phrases);
}

/**
 * Announce BOLO alert with details:
 * "Attention all units. Be on the lookout. [Title]. [Description]. Use caution."
 */
export async function announceBolo(title: string, priority?: string, details?: { description?: string; vehicle_description?: string; suspect_description?: string; last_seen_location?: string; call_number?: string }): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;
  const dedupKey = `bolo:${title}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);
  await playToneAsync('warning');
  await delay(TONE_GAP_MS);

  const phrases: VoicePhrase[] = [
    { text: 'Attention all units.' },
    { text: `Be on the lookout. ${title}.` },
  ];
  if (details?.suspect_description) {
    phrases.push({ text: `Subject description: ${details.suspect_description}.` });
  }
  if (details?.vehicle_description) {
    phrases.push({ text: `Vehicle: ${details.vehicle_description}.` });
  }
  if (details?.last_seen_location) {
    phrases.push({ text: `Last seen near ${details.last_seen_location}.` });
  }
  if (details?.call_number) {
    phrases.push({ text: `Reference call ${details.call_number}.` });
  }
  if (priority === 'P1') phrases.push({ text: 'Priority one. Use extreme caution.' });
  else phrases.push({ text: 'Use caution.' });
  enqueuePhrases(phrases);
}

/** Announce warrant hit */
export async function announceWarrantHit(data: { person_name?: string; warrant_count?: number }): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;
  const name = data.person_name || 'unknown subject';
  const dedupKey = `warrant:${name}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);
  await playToneAsync('caution');
  await delay(TONE_GAP_MS);
  const phrases: VoicePhrase[] = [{ text: naturalPhrase('ACTIVE WARRANTS') }, { text: `Subject: ${name}.` }];
  if (data.warrant_count && data.warrant_count > 1) phrases.push({ text: `${data.warrant_count} active warrants.` });
  enqueuePhrases(phrases);
}

/** Announce backup request */
export async function announceBackupRequest(callOrData: any, requestingUnit?: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  // Support legacy signature: announceBackupRequest({ officer_name, location, call_number })
  if (!requestingUnit && callOrData && typeof callOrData === 'object' && !callOrData.call_number && callOrData.officer_name) {
    const who = callOrData.officer_name || 'unknown';
    const dedupKey = `backup:${who}`;
    if (wasRecentlyAnnounced(dedupKey)) return;
    markAnnounced(dedupKey);
    await playToneAsync('warning');
    await delay(TONE_GAP_MS);
    const phrases: VoicePhrase[] = [{ text: `Backup requested by ${who}.` }];
    if (callOrData.location) phrases.push({ text: `Location: ${callOrData.location}.` });
    enqueuePhrases(phrases);
    return;
  }

  // New signature: announceBackupRequest(call, requestingUnit)
  const callNum = callOrData?.call_number || 'unknown';
  const loc = callOrData?.location_address || callOrData?.location || 'unknown location';
  const unit = requestingUnit || 'unknown unit';
  const dedupKey = `backup:${callNum}:${unit}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('backup_request');
  await delay(TONE_GAP_MS);

  enqueuePhrases([
    { text: `Backup requested for call ${callNum} at ${loc} by ${unit}. Available units respond.` },
  ]);
}

/** Announce pursuit */
export async function announcePursuit(data: { officer_name?: string; location?: string; direction?: string; speed?: string }): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;
  const who = data.officer_name || 'unknown unit';
  const dedupKey = `pursuit:${who}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);
  await playToneAsync('warning');
  await delay(TONE_GAP_MS);
  const phrases: VoicePhrase[] = [{ text: `Pursuit in progress. ${who}.` }];
  if (data.direction) phrases.push({ text: `Direction of travel: ${data.direction}.` });
  if (data.location) phrases.push({ text: `Location: ${data.location}.` });
  enqueuePhrases(phrases);
}

/** Announce all-units broadcast */
export async function announceAllUnits(message: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;
  const dedupKey = `allunits:${message.slice(0, 50)}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);
  await playToneAsync('caution');
  await delay(TONE_GAP_MS);
  enqueuePhrases([{ text: naturalPhrase('ATTENTION ALL UNITS') }, { text: `${message}.` }]);
}

// ─── Enhanced Dispatch Voice Alerts ─────────────────────────

/**
 * Announce periodic status check for units on scene:
 * "Status check. Unit S19 has been on scene at 3392 Mockingbird Way for 22 minutes."
 * Called from DispatchPage timer logic — no internal setInterval.
 */
export async function announceStatusCheck(callSign: string, location: string, minutes: number): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `statuscheck:${callSign}:${Math.floor(minutes / 5)}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('info');
  await delay(200);

  enqueuePhrases([
    { text: `Status check. Unit ${callSign} has been on scene${location ? ` at ${location}` : ''} for ${minutes} minutes.` },
  ]);
}

/**
 * Announce unit proximity alert:
 * "Advisory. Unit 5820 is within 500 meters of Unit S19's active call at Mockingbird Way."
 */
export async function announceProximityAlert(unit1: string, unit2: string, location: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `proximity:${unit1}:${unit2}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('caution');
  await delay(200);

  enqueuePhrases([
    { text: `Advisory. Unit ${unit1} is within 500 meters of Unit ${unit2}'s active call${location ? ` at ${location}` : ''}.` },
  ]);
}

/**
 * Announce shift change reminder:
 * "Attention. Shift change in 30 minutes. Active calls: 2. Units on scene: 1."
 */
export async function announceShiftReminder(minutesLeft: number, activeCalls: number, unitsOnScene: number): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `shiftreminder:${minutesLeft}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('caution');
  await delay(TONE_GAP_MS);

  enqueuePhrases([
    { text: `Attention. Shift change in ${minutesLeft} minutes. Active calls: ${activeCalls}. Units on scene: ${unitsOnScene}.` },
  ]);
}

/**
 * Announce call priority escalation:
 * "Priority escalation. Call 26-CFS00110 upgraded from P3 to P1. Weapons now involved."
 */
export async function announceEscalation(callNumber: string, oldPriority: string, newPriority: string, reason?: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `escalation:${callNumber}:${newPriority}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  // Use alarm for P1 escalations, warning for others
  if (newPriority === 'P1') await playToneAsync('alarm');
  else await playToneAsync('warning');
  await delay(TONE_GAP_MS);

  const phrases: VoicePhrase[] = [
    { text: `Priority escalation. Call ${callNumber} upgraded from ${oldPriority} to ${newPriority}.` },
  ];
  if (reason) {
    phrases.push({ text: `${reason}.` });
  }
  enqueuePhrases(phrases);
}

/**
 * Announce enhanced backup request with unit and location:
 * "Backup requested. Unit S19 requesting backup at 3392 Mockingbird Way. All available units respond."
 */
export async function announceBackupRequestEnhanced(unit: string, location: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `backupreq:${unit}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('warning');
  await delay(200);
  await playToneAsync('warning');
  await delay(TONE_GAP_MS);

  enqueuePhrases([
    { text: `Backup requested. Unit ${unit} requesting backup${location ? ` at ${location}` : ''}.` },
    { text: 'All available units respond.' },
  ]);
}

/**
 * Announce call update (notes, priority change, etc.):
 * "Update on call 26-CFS00110. New note added by Dispatch."
 */
export async function announceCallUpdate(callNumber: string, updateType: string, author?: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `callupdate:${callNumber}:${updateType}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  enqueuePhrases([
    { text: `Update on call ${callNumber}. ${updateType}${author ? ` by ${author}` : ''}.` },
  ]);
}

/**
 * Announce unit assignment to a call:
 * "Unit S19 assigned to call 26-CFS00110."
 */
export async function announceUnitAssignment(unitCallSign: string, callNumber: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `unitassign:${unitCallSign}:${callNumber}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('info');
  await delay(200);

  enqueuePhrases([
    { text: `Unit ${unitCallSign} assigned to call ${callNumber}.` },
  ]);
}

/**
 * Announce call archived with summary:
 * "Call 26-CFS00110 archived. Disposition: Personal Service. Response time: 18 minutes."
 */
export async function announceCallArchived(callNumber: string, disposition?: string, responseTimeMin?: number): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `archived:${callNumber}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  const phrases: VoicePhrase[] = [
    { text: `Call ${callNumber} archived.` },
  ];
  if (disposition) {
    phrases.push({ text: `Disposition: ${disposition.replace(/_/g, ' ').toUpperCase()}.` });
  }
  if (responseTimeMin != null && responseTimeMin > 0) {
    phrases.push({ text: `Response time: ${responseTimeMin} minutes.` });
  }
  enqueuePhrases(phrases);
}

/**
 * Announce current time:
 * "The current time is 14 thirty hours."
 */
export async function announceTime(): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const timeStr = m === 0 ? `${h} hundred hours` : `${h} ${m < 10 ? 'oh ' + m : m} hours`;

  await playToneAsync('info');
  await delay(200);
  enqueuePhrases([{ text: `The current time is ${timeStr}.` }]);
}

/**
 * Announce all-clear on a call:
 * "All clear. Call 26-CFS00110. Scene is secure."
 */
export async function announceAllClear(callNumber: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `allclear:${callNumber}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('info');
  await delay(200);
  enqueuePhrases([{ text: `All clear. Call ${callNumber}. Scene is secure.` }]);
}

/**
 * Announce acknowledgment tone (10-4):
 * Just plays the info tone with a short "Copy" phrase.
 */
export async function announceAcknowledgment(): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;
  await playToneAsync('info');
  await delay(100);
  await playToneAsync('info');
}

// ─── Process Service & Operational Voice Alerts ────────────────

/**
 * Announce a return visit scheduling:
 * "Return visit scheduled. Call 26-CFS00110 queued for second attempt. Next window: 6PM to 9PM."
 */
export async function announceReturnVisit(callNumber: string, attemptNumber: number, nextWindow?: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `returnvisit:${callNumber}:${attemptNumber}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('info');
  await delay(200);

  const ordinal = attemptNumber === 2 ? 'second' : attemptNumber === 3 ? 'third' : `${attemptNumber}th`;
  const phrases: VoicePhrase[] = [
    { text: `Return visit scheduled. Call ${callNumber} queued for ${ordinal} attempt.` },
  ];
  if (nextWindow) {
    phrases.push({ text: `Next window: ${nextWindow}.` });
  }
  enqueuePhrases(phrases);
}

/**
 * Announce serve completion summary:
 * "Service complete. Personal service on Alexis Sanchez at 3392 Mockingbird Way. Documents: Summons and Complaint. Attempt 1 of 3."
 */
export async function announceServeComplete(name: string, address: string, docType: string, attempt: number, result: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `servecomplete:${name}:${attempt}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('info');
  await delay(200);

  const phrases: VoicePhrase[] = [
    { text: `Service complete. ${result.replace(/_/g, ' ').toUpperCase()} on ${name}${address ? ` at ${address}` : ''}.` },
  ];
  if (docType) {
    phrases.push({ text: `Documents: ${docType.replace(/_/g, ' ').toUpperCase()}.` });
  }
  phrases.push({ text: `Attempt ${attempt}.` });
  enqueuePhrases(phrases);
}

/**
 * Announce multiple calls stacked at the same location:
 * "Advisory. 3 calls stacked at 15 South West Temple. Units S19, 5820 assigned."
 */
export async function announceCallStack(count: number, address: string, units: string[]): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `callstack:${address}:${count}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('caution');
  await delay(200);

  const phrases: VoicePhrase[] = [
    { text: `Advisory. ${count} calls stacked at ${address}.` },
  ];
  if (units.length > 0) {
    phrases.push({ text: `Units ${units.slice(0, 4).join(', ')} assigned.` });
  }
  enqueuePhrases(phrases);
}

/**
 * Announce GPS speed advisory when unit exceeds threshold:
 * "Speed advisory. Unit S19 traveling at 78 miles per hour on Interstate 15."
 */
export async function announceSpeedAdvisory(callSign: string, speed: number, road?: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `speed:${callSign}:${Math.floor(speed / 10)}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('caution');
  await delay(200);

  const phrases: VoicePhrase[] = [
    { text: `Speed advisory. Unit ${callSign} traveling at ${Math.round(speed)} miles per hour${road ? ` on ${road}` : ''}.` },
  ];
  enqueuePhrases(phrases);
}

/**
 * Announce court deadline reminder:
 * "Reminder. Serve deadline for case 2:25-CV-01053 expires in 4 hours. Property: Alexis Sanchez."
 */
export async function announceCourtDeadline(caseNumber: string, hoursRemaining: number, property?: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `deadline:${caseNumber}:${Math.floor(hoursRemaining)}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('warning');
  await delay(TONE_GAP_MS);

  const timeStr = hoursRemaining < 1
    ? `${Math.round(hoursRemaining * 60)} minutes`
    : `${Math.round(hoursRemaining)} hours`;

  const phrases: VoicePhrase[] = [
    { text: `Reminder. Serve deadline for case ${caseNumber} expires in ${timeStr}.` },
  ];
  if (property) {
    phrases.push({ text: `Property: ${property}.` });
  }
  enqueuePhrases(phrases);
}

/**
 * Announce end-of-shift summary:
 * "Shift summary. 8 calls handled. 6 serves completed. 2 pending. Average response: 14 minutes. Total miles: 42.3."
 */
export async function announceShiftSummary(stats: { calls: number; serves: number; pending: number; avgResponse: number; totalMiles: number }): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `shiftsummary:${Date.now()}`;
  markAnnounced(dedupKey);

  await playToneAsync('info');
  await delay(TONE_GAP_MS);

  const phrases: VoicePhrase[] = [
    { text: `Shift summary. ${stats.calls} calls handled. ${stats.serves} serves completed. ${stats.pending} pending.` },
    { text: `Average response: ${stats.avgResponse} minutes. Total miles: ${stats.totalMiles.toFixed(1)}.` },
  ];
  enqueuePhrases(phrases);
}

/**
 * Announce a directed note with @mention:
 * "Attention Unit S19. Note from Dispatch on call 26-CFS00110: Please check rear entrance."
 */
export async function announceDirectedNote(targetUnit: string, callNumber: string, noteText: string, author?: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `directednote:${targetUnit}:${callNumber}:${noteText.slice(0, 30)}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('info');
  await delay(200);

  const truncated = noteText.length > 80 ? noteText.slice(0, 80) + '...' : noteText;
  const phrases: VoicePhrase[] = [
    { text: `Attention ${targetUnit === '@all' ? 'all units' : `Unit ${targetUnit.replace('@', '')}`}. Note${author ? ` from ${author}` : ''} on call ${callNumber}: ${truncated}.` },
  ];
  enqueuePhrases(phrases);
}

/**
 * Announce audible feedback for local dispatcher actions.
 * Uses a brief chirp tone and short confirmation phrase.
 * These fire only for the local user's own actions (not from WebSocket).
 */
export async function announceLocalAction(actionType: 'call_created' | 'unit_dispatched' | 'call_closed' | 'note_added', detail: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  // No dedup for local actions — they are always intentional
  if (actionType === 'call_created') {
    await playToneAsync('info');
    await delay(150);
  } else if (actionType === 'unit_dispatched') {
    await playToneAsync('info');
    await delay(150);
  } else if (actionType === 'call_closed') {
    // No tone for close — descending implied by speech
  } else if (actionType === 'note_added') {
    // Brief click implied by tone
    await playToneAsync('info');
    await delay(100);
  }

  enqueuePhrases([{ text: detail }]);
}

// ─── Situational Awareness Alerts (66–75) ────────────────────

/**
 * Announce priority escalation:
 * "Call 26-CFS00110 escalated from Priority 3 to Priority 1. 123 Main St."
 */
export async function announcePriorityEscalation(call: any, oldPriority: string, newPriority: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const callNum = call?.call_number || 'unknown';
  const loc = call?.location_address || call?.location || '';
  const dedupKey = `escalation:${callNum}:${oldPriority}:${newPriority}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  const tone = newPriority === 'P1' ? 'alarm' : 'warning';
  await playToneAsync(tone);
  await delay(TONE_GAP_MS);

  enqueuePhrases([
    { text: `Call ${callNum} escalated from ${oldPriority} to ${newPriority}. ${loc}.` },
  ]);
}

/**
 * Announce shift change:
 * "Shift change. Day shift off duty, Swing shift coming on."
 */
export async function announceShiftChange(incomingShift: string, outgoingShift: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `shiftchange:${outgoingShift}:${incomingShift}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('shift_change');
  await delay(TONE_GAP_MS);

  enqueuePhrases([
    { text: `Shift change. ${outgoingShift} off duty, ${incomingShift} coming on.` },
  ]);
}

/**
 * Announce weather alert:
 * "Weather advisory: Winter Storm Warning. Heavy snow expected, 6 to 10 inches. All units exercise caution."
 */
export async function announceWeatherAlert(alertType: string, description: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `weather:${alertType}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('weather_alert');
  await delay(TONE_GAP_MS);

  enqueuePhrases([
    { text: `Weather advisory: ${alertType}. ${description}. All units exercise caution.` },
  ]);
}

/**
 * Announce geofence breach:
 * "Unit S19 has left beat 7A."
 */
export async function announceGeofenceBreach(unit: string, beat: string, direction?: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `geofence:${unit}:${beat}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('caution');
  await delay(200);

  const dirText = direction ? ` ${direction}` : '';
  enqueuePhrases([
    { text: `${unit} has left beat ${beat}${dirText}.` },
  ]);
}

/**
 * Announce supervisor review:
 * "Call 26-CFS00110 reviewed by Sergeant Williams."
 */
export async function announceSupervisorReview(callNumber: string, supervisor: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `review:${callNumber}:${supervisor}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('info');
  await delay(200);

  enqueuePhrases([
    { text: `Call ${callNumber} reviewed by ${supervisor}.` },
  ]);
}

/**
 * Announce recurring location:
 * "Recurring location: 456 State St, 12 calls in 30 days."
 */
export async function announceRecurringLocation(address: string, count: number, period: number): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `recurring:${address}:${count}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('caution');
  await delay(200);

  enqueuePhrases([
    { text: `Recurring location: ${address}, ${count} calls in ${period} days.` },
  ]);
}

/**
 * Announce unit fatigue:
 * "Unit S19, 10 hours on duty, 14 calls. Consider relief."
 */
export async function announceUnitFatigue(callSign: string, hours: number, callCount: number): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `fatigue:${callSign}:${Math.floor(hours)}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('caution');
  await delay(200);

  enqueuePhrases([
    { text: `Unit ${callSign}, ${Math.round(hours)} hours on duty, ${callCount} calls. Consider relief.` },
  ]);
}

/**
 * Announce hot spot entry:
 * "Unit S19 entering hot spot: 789 West Temple, 8 recent calls."
 */
export async function announceHotSpotEntry(unit: string, address: string, callCount: number): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `hotspot:${unit}:${address}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('hot_spot_entry');
  await delay(200);

  enqueuePhrases([
    { text: `${unit} entering hot spot: ${address}, ${callCount} recent calls.` },
  ]);
}

/**
 * Announce mutual aid request:
 * "Mutual aid from Salt Lake City PD for call 26-CFS00110, Active Shooter."
 */
export async function announceMutualAidRequest(agency: string, callNumber: string, callType: string): Promise<void> {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;

  const dedupKey = `mutualaid:${agency}:${callNumber}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  await playToneAsync('mutual_aid');
  await delay(TONE_GAP_MS);

  enqueuePhrases([
    { text: `Mutual aid from ${agency} for call ${callNumber}, ${callType}.` },
  ]);
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
    await playToneAsync(group.tone);
    await delay(TONE_GAP_MS);

    for (const text of group.phrases) {
      await speakPhrase({ text: naturalPhrase(text) });
      await delay(PHRASE_GAP_MS);
    }

    // Pause between groups
    await delay(800);
  }

}

// ─── Helpers ────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Upgrade: Shift Handoff Alert ──
export function announceShiftHandoff(
  outgoingName: string,
  incomingName: string,
  activeCalls: number
): void {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;
  const phrases = [
    `Shift handoff initiated. ${outgoingName} transferring to ${incomingName}. ${activeCalls} active calls in queue.`,
    `Attention all units, shift change in progress. ${activeCalls} calls remain active.`,
  ];
  const phrase = phrases[Math.floor(Math.random() * phrases.length)];
  enqueuePhrases([{ text: phrase }]);
}

// ── Upgrade: Mutual Aid Alert ──
export function announceMutualAid(
  agency: string,
  type: 'requested' | 'approved' | 'denied',
  unitsCount?: number
): void {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;
  const messages: Record<string, string> = {
    requested: `Mutual aid requested from ${agency}. ${unitsCount || 1} units requested. Standing by for response.`,
    approved: `Mutual aid approved. ${agency} providing ${unitsCount || 1} units. Coordinate on tactical channel.`,
    denied: `Mutual aid request to ${agency} has been denied. Evaluate alternate resources.`,
  };
  enqueuePhrases([{ text: messages[type] || `Mutual aid update from ${agency}.` }]);
}

// ── Upgrade: Narrative Update Alert ──
export function announceNarrativeUpdate(
  callNumber: string,
  editorName: string,
  version: number
): void {
  if (!isVoiceEnabled() || !isSpeechAvailable()) return;
  if (version > 1) {
    enqueuePhrases([{ text: `Narrative updated for call ${callNumber} by ${editorName}. Version ${version}.` }]);
  }
}

