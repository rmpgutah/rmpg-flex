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

/** Priority-based speech parameters — adjusts rate/pitch/volume for urgency level */
interface PrioritySpeechParams {
  rate: number;
  pitch: number;
  volume: number;
}

const PRIORITY_PARAMS: Record<string, PrioritySpeechParams> = {
  P1: { rate: 1.1, pitch: 1.15, volume: 1.0 },
  P2: { rate: 1.0, pitch: 1.05, volume: 0.95 },
  P3: { rate: 0.95, pitch: 1.0, volume: 0.9 },
  P4: { rate: 0.9, pitch: 0.98, volume: 0.85 },
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

/** Active priority for the current phrase batch — affects speech rate/pitch/volume */
let activePriority: string | undefined;
let phraseQueue: VoicePhrase[] = [];
let isSpeaking = false;

function speakPhrase(phrase: VoicePhrase): Promise<void> {
  return new Promise((resolve) => {
    if (!isSpeechAvailable()) { resolve(); return; }

    const utterance = new SpeechSynthesisUtterance(phrase.text);
    const voice = selectFemaleVoice();
    if (voice) utterance.voice = voice;

    // Apply priority-based speech parameters if set
    const params = activePriority ? PRIORITY_PARAMS[activePriority] : undefined;
    utterance.rate = params?.rate ?? SPEECH_RATE;
    utterance.pitch = params?.pitch ?? SPEECH_PITCH;
    utterance.volume = params?.volume ?? SPEECH_VOLUME;

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

  activePriority = undefined;
  isSpeaking = false;
}

function enqueuePhrases(phrases: VoicePhrase[], priority?: string): void {
  if (phrases.length === 0) return;
  // Set priority for this batch (first batch wins if queue is already running)
  if (!isSpeaking && priority) activePriority = priority;
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
    { text: naturalPhrase('PANIC ALERT') },
    { text: naturalPhrase('OFFICER NEEDS ASSISTANCE') },
  ];
  if (officerName) {
    phrases.push({ text: `Officer ${officerName}.` });
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

  const phrases: VoicePhrase[] = [{ text: naturalPhrase('DISPATCH') }];
  if (call.call_number) phrases.push({ text: `Call ${call.call_number}.` });
  if (call.incident_type) {
    // Convert snake_case incident types to natural spoken form
    const type = call.incident_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    phrases.push({ text: `${type}.` });
  }
  if (call.priority === 'P1') phrases.push({ text: naturalPhrase('PRIORITY ONE') });
  else if (call.priority === 'P2') phrases.push({ text: naturalPhrase('PRIORITY TWO') });
  if (call.location) phrases.push({ text: `At ${call.location}.` });

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

  // Priority-based tone selection: P1 gets alarm, P2 gets warning, P3/P4 get caution
  const tone = call.priority === 'P1' ? 'alarm' : call.priority === 'P2' ? 'warning' : 'caution';
  await playToneAsync(tone);
  await delay(TONE_GAP_MS);

  const phrases: VoicePhrase[] = [{ text: naturalPhrase('NEW CALL') }];
  if (call.call_number) phrases.push({ text: `Call ${call.call_number}.` });
  if (call.incident_type) {
    const type = call.incident_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    phrases.push({ text: `${type}.` });
  }
  if (call.priority === 'P1') phrases.push({ text: naturalPhrase('PRIORITY ONE') });
  else if (call.priority === 'P2') phrases.push({ text: naturalPhrase('PRIORITY TWO') });

  // Append safety flags
  const safetyPhrases = buildCallPhrases(call);
  if (safetyPhrases.length > 0) phrases.push(...safetyPhrases);

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
    dispatched: 'DISPATCHED',
    enroute: 'UNIT ENROUTE',
    onscene: 'UNIT ON SCENE',
    cleared: 'CALL CLEARED',
    closed: 'CALL CLOSED',
    pending: 'CALL PENDING',
  };
  const label = statusLabels[newStatus] || newStatus.toUpperCase();

  await playToneAsync('info');
  await delay(TONE_GAP_MS);
  enqueuePhrases([{ text: `${label}. Call ${callNum}.` }]);
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

  const description = data.title || data.description || 'Be on the lookout.';
  enqueuePhrases([
    { text: 'Attention. New BOLO alert.' },
    { text: description },
  ]);
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
  const phrases: VoicePhrase[] = [
    { text: `Warning. Active warrant. ${personName}.` },
  ];
  if (count > 0) {
    phrases.push({ text: `${count} active warrant${count > 1 ? 's' : ''}.` });
  }
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
