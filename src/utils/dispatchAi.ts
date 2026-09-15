// ============================================================
// RMPG Flex — Dispatch AI (Workers AI)
//
// Real GPS-aware dispatch intelligence on the rewrite Worker, using the
// account's Workers AI binding (env.AI). Two capabilities:
//   - suggestUnits: rank available units by LIVE, FRESH GPS distance, then
//     have the LLM pick + justify the best responders for the call context.
//   - analyzeCall: produce a safety briefing, suggested flags, severity.
//
// Design: the GPS math is deterministic (the model never invents distances);
// the LLM only reasons over pre-computed, freshness-filtered candidates. Every
// call degrades gracefully — if the model errors or returns junk, we fall back
// to the deterministic ranking so dispatch is never left without an answer.
//
// `Ai` is a global type from @cloudflare/workers-types (no import needed).
// ============================================================

import { log } from './logger';
const LLM_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Default "fresh GPS" window (seconds) — mirrors dispatch/extensions.ts. */
export const GPS_FRESH_WINDOW_S = 180;

const EARTH_RADIUS_M = 6371000;
const AVG_URBAN_SPEED_MPH = 25;
const toRad = (d: number) => (d * Math.PI) / 180;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseUtcMs(ts: string): number {
  let s = ts.trim();
  if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += 'Z';
  return Date.parse(s);
}

export function gpsAgeSeconds(ts: string | null | undefined, nowMs: number): number | null {
  if (!ts) return null;
  const ms = parseUtcMs(ts);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((nowMs - ms) / 1000));
}

// ─── Types ──────────────────────────────────────────────────

export interface CallContext {
  id?: number;
  call_number?: string | null;
  incident_type?: string | null;
  priority?: string | null;
  location_address?: string | null;
  latitude: number;
  longitude: number;
  flags?: string[];
}

export interface RawUnit {
  id: number;
  call_sign: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  gps_updated_at: string | null;
  officer_name?: string | null;
}

export interface UnitCandidate {
  unit_id: number;
  callSign: string;
  status: string;
  officerName?: string | null;
  distanceMiles: number;
  etaMinutes: number;
  gpsAgeSeconds: number | null;
  gpsStale: boolean;
}

export interface UnitSuggestion {
  call_sign: string;
  reason: string;
}

// ─── Deterministic ranking (fresh GPS first) ────────────────

export function rankUnitsForCall(
  call: CallContext,
  units: RawUnit[],
  freshWindow = GPS_FRESH_WINDOW_S,
  limit = 8,
): UnitCandidate[] {
  const now = Date.now();
  return units
    .filter((u) => u.latitude != null && u.longitude != null)
    .map((u) => {
      const distMi = haversineMeters(call.latitude, call.longitude, u.latitude!, u.longitude!) / 1609.34;
      const ageS = gpsAgeSeconds(u.gps_updated_at, now);
      return {
        unit_id: u.id,
        callSign: u.call_sign,
        status: u.status,
        officerName: u.officer_name ?? null,
        distanceMiles: Math.round(distMi * 10) / 10,
        etaMinutes: Math.round((distMi / AVG_URBAN_SPEED_MPH) * 60 * 10) / 10,
        gpsAgeSeconds: ageS,
        gpsStale: ageS == null || ageS > freshWindow,
      };
    })
    .sort((a, b) => (a.gpsStale === b.gpsStale)
      ? a.distanceMiles - b.distanceMiles
      : (a.gpsStale ? 1 : -1))
    .slice(0, limit);
}

// ─── JSON coaxing ───────────────────────────────────────────

function extractJson(raw: string): any | null {
  if (!raw) return null;
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    // Reject if the parsed result is not an object or array — guards against
    // the LLM returning a bare string/number that happens to be inside {}.
    if (parsed !== null && typeof parsed === 'object') return parsed;
    return null;
  } catch {
    return null;
  }
}

// ─── suggestUnits ───────────────────────────────────────────

const SUGGEST_SYSTEM =
  'You are a veteran police dispatch supervisor. Given a call and a list of ' +
  'candidate units already ranked by live GPS distance, choose up to 3 best ' +
  'units to dispatch and give a one-line reason each. Prefer units with FRESH ' +
  'GPS and short ETA; never recommend a unit flagged gpsStale as the top pick ' +
  'unless no fresh unit exists. Respond with ONLY JSON: ' +
  '{"suggestions":[{"call_sign":"X","reason":"..."}]}';

function deterministicReasons(candidates: UnitCandidate[]): UnitSuggestion[] {
  return candidates.slice(0, 3).map((u) => ({
    call_sign: u.callSign,
    reason: u.gpsStale
      ? `Nearest available unit (~${u.distanceMiles} mi) — GPS stale, position uncertain`
      : `Closest live unit, ${u.distanceMiles} mi out, ETA ~${u.etaMinutes} min`,
  }));
}

export async function suggestUnits(
  ai: Ai,
  call: CallContext,
  candidates: UnitCandidate[],
): Promise<{ suggestions: UnitSuggestion[]; provider: string; fallback: boolean }> {
  if (candidates.length === 0) {
    return { suggestions: [], provider: 'none', fallback: true };
  }
  const list = candidates.map((u) =>
    `${u.callSign} | status=${u.status} | ${u.distanceMiles}mi | eta=${u.etaMinutes}min | ` +
    `gpsAge=${u.gpsAgeSeconds == null ? 'never' : u.gpsAgeSeconds + 's'} | gpsStale=${u.gpsStale}`,
  ).join('\n');
  const user =
    `Call: ${call.incident_type ?? 'unknown type'} (priority ${call.priority ?? '?'}) at ` +
    `${call.location_address ?? `${call.latitude},${call.longitude}`}` +
    `${call.flags?.length ? ` | flags: ${call.flags.join(', ')}` : ''}\n\nCandidate units:\n${list}`;

  try {
    const res = (await ai.run(LLM_MODEL, {
      messages: [
        { role: 'system', content: SUGGEST_SYSTEM },
        { role: 'user', content: user },
      ],
      max_tokens: 240,
      temperature: 0.2,
    } as never)) as { response?: unknown };
    const parsed = extractJson(typeof res?.response === 'string' ? res.response : String(res?.response ?? ''));
    const valid = new Set(candidates.map((u) => u.callSign));
    const suggestions: UnitSuggestion[] = Array.isArray(parsed?.suggestions)
      ? parsed.suggestions
          .filter((s: any) => s && typeof s.call_sign === 'string' && valid.has(s.call_sign))
          .slice(0, 3)
          .map((s: any) => ({ call_sign: s.call_sign, reason: String(s.reason ?? '').slice(0, 200) }))
      : [];
    if (suggestions.length > 0) return { suggestions, provider: 'workers-ai', fallback: false };
  } catch (err) {
    log.error('suggestUnits LLM failed', {}, err);
  }
  return { suggestions: deterministicReasons(candidates), provider: 'deterministic', fallback: true };
}

// ─── narrativeAssist ────────────────────────────────────────

type NarrativeContextType = 'incident' | 'serve_attempt' | 'dispatch_narrative';

/** Controls output length. full_report targets ~3 pages (~2000+ words). */
export type NarrativeLengthTarget = 'brief' | 'standard' | 'detailed' | 'full_report';

const LENGTH_TOKEN_MAP: Record<NarrativeLengthTarget, number> = {
  brief: 512,
  standard: 1200,
  detailed: 2048,
  full_report: 3072,
};

const LENGTH_INSTRUCTION_MAP: Record<NarrativeLengthTarget, string> = {
  brief:
    'Write a brief single-paragraph summary (100-200 words). Cover only the essential facts and final disposition.',
  standard:
    'Write a standard professional narrative (300-500 words, 2-3 paragraphs). Cover all material facts in chronological order.',
  detailed:
    'Write a detailed thorough narrative (600-1000 words, 4-6 paragraphs). Full chronological coverage with all contacts, observations, evidence, and actions.',
  full_report:
    'Write a comprehensive multi-page report narrative (1200-2000 words, 7-12 paragraphs). This is a complete official report. ' +
    'Paragraph 1: Opening — date, time, location, nature of call/incident, how you were notified. ' +
    'Paragraph 2: Response and arrival — your route, arrival time, initial scene observations, conditions. ' +
    'Paragraph 3: Initial contact — first persons encountered, physical descriptions, demeanor, statements made. ' +
    'Paragraphs 4+: Chronological account of all actions taken, each person contacted (with description and statements), ' +
    'evidence collected, documents served or obtained, searches conducted, use of force if any. ' +
    'Second-to-last paragraph: Legal notifications — Miranda rights given, consular notification, medical attention offered. ' +
    'Final paragraph: Disposition — arrest/citations/warnings issued, property impounded, case status, required follow-up actions. ' +
    'Every material fact from the notes must appear. Separate each paragraph with a blank line.',
};

const NARRATIVE_SYSTEM_MAP: Record<NarrativeContextType, string> = {
  incident:
    'You are a veteran police report writer. Given incident notes, incident type, and location, ' +
    'produce an objective, plain-language incident narrative suitable for an official police report. ' +
    'Use professional tone, avoid speculation, include all relevant details, omit subjective judgments. ' +
    'Write in first-person past tense (I observed, I contacted, I attempted). ' +
    'Separate paragraphs with a blank line. ' +
    'Output ONLY plain-text narrative paragraphs. No JSON, no section headers, no preamble.',

  serve_attempt:
    'You are a professional process server writing an official service-attempt narrative ' +
    'for a court-admissible affidavit of service or non-service. Given structured context ' +
    '(subject name, address, document type, attempt type, and officer field notes), ' +
    'produce a thorough, chronological, first-person past-tense narrative (I arrived, ' +
    'I observed, I contacted, I was met by). Include: time of arrival, property observations, ' +
    'contact or non-contact details, description of any person encountered (name if given, ' +
    'demeanor, physical description), exact disposition of the documents, and any safety or ' +
    'access concerns. Separate each phase into its own paragraph with a blank line between them. ' +
    'Language must be precise, objective, and suitable for filing with the court. ' +
    'Output ONLY plain-text narrative paragraphs. No JSON, no section headers, no preamble.',

  dispatch_narrative:
    'You are a veteran police report writer drafting an official Call for Service narrative ' +
    'and Action Taken summary. Given call context and notes, produce a detailed, chronological, ' +
    'first-person past-tense narrative (I responded, I made contact, I observed). ' +
    'Each major phase (response, arrival, contact, actions taken, legal notifications, disposition) ' +
    'must be its own paragraph, separated by a blank line. Include: initial response and arrival ' +
    'observations, all persons contacted with physical descriptions and statements, actions taken, ' +
    'evidence or documents collected, legal notifications given, final disposition, and any ' +
    'follow-up required. Use professional law enforcement language. ' +
    'Output ONLY plain-text narrative paragraphs. No JSON, no section headers, no preamble.',
};

export async function narrativeAssist(
  ai: Ai,
  notes: string,
  incidentType?: string,
  locationAddress?: string,
  contextType: NarrativeContextType = 'incident',
  lengthTarget: NarrativeLengthTarget = 'standard',
  paragraphGuidance?: string,
): Promise<{ narrative: string; provider: string; fallback: boolean }> {
  const systemPrompt = NARRATIVE_SYSTEM_MAP[contextType] ?? NARRATIVE_SYSTEM_MAP.incident;
  const lengthInstruction = LENGTH_INSTRUCTION_MAP[lengthTarget];
  const maxTokens = LENGTH_TOKEN_MAP[lengthTarget];

  const user =
    `Incident type: ${incidentType ?? 'N/A'}\n` +
    `Location: ${locationAddress ?? 'N/A'}\n` +
    `Length and structure requirement: ${lengthInstruction}\n` +
    (paragraphGuidance ? `Additional paragraph guidance: ${paragraphGuidance}\n` : '') +
    `Notes:\n${notes.slice(0, 8000)}`;

  try {
    const res = (await ai.run(LLM_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
    } as never)) as { response?: string };
    // No hard char cap — officer prose can be as long as the report requires.
    const narrative = (res?.response || '').trim();
    if (narrative.length >= 20) {
      return { narrative, provider: 'workers-ai', fallback: false };
    }
  } catch (err) {
    log.error('narrativeAssist LLM failed', { contextType, lengthTarget }, err);
  }

  return {
    narrative: `Officer notes: ${notes.slice(0, 1000)}`,
    provider: 'deterministic',
    fallback: true,
  };
}

// ─── smartSearch ────────────────────────────────────────────

const SEARCH_SYSTEM =
  'You are a police records search assistant. Given a natural language query, ' +
  'extract structured search filters for the given search type. ' +
  'Respond with ONLY JSON: {"filters":{"key":"value",...}}.\n\n' +
  'For persons: first_name, last_name, dob, address, city, state, zip, phone, ' +
  'dl_number, gender, race, height, weight, hair_color, eye_color.\n' +
  'For vehicles: plate_number, state, make, model, year, color, vin.\n' +
  'For incidents: incident_number, incident_type, location_address, priority, status, ' +
  'narrative_keyword, officer_id, date_from, date_to.\n\n' +
  'Only include keys that can be confidently inferred from the query. ' +
  'Leave unknown values as empty strings. Do not make up data.';

export async function smartSearch(
  ai: Ai,
  query: string,
  searchType: string,
): Promise<{ filters: Record<string, string>; provider: string; fallback: boolean }> {
  try {
    const res = (await ai.run(LLM_MODEL, {
      messages: [
        { role: 'system', content: SEARCH_SYSTEM },
        { role: 'user', content: `Search type: ${searchType}\nQuery: ${query.slice(0, 500)}` },
      ],
      max_tokens: 300,
      temperature: 0.1,
    } as never)) as { response?: unknown };
    const p = extractJson(typeof res?.response === 'string' ? res.response : String(res?.response ?? ''));
    if (p && typeof p.filters === 'object' && p.filters !== null) {
      const filters: Record<string, string> = {};
      for (const [k, v] of Object.entries(p.filters)) {
        filters[k] = String(v ?? '');
      }
      return { filters, provider: 'workers-ai', fallback: false };
    }
  } catch (err) {
    log.error('smartSearch LLM failed', {}, err);
  }

  return { filters: {}, provider: 'deterministic', fallback: true };
}

// ─── analyzeCall ────────────────────────────────────────────

const ANALYZE_SYSTEM =
  'You are an experienced police dispatcher/analyst. Given a call, return a ' +
  'short tactical safety briefing for responding officers, any safety flags ' +
  'you infer, a severity (low|medium|high), and a confidence 0-100. Respond ' +
  'with ONLY JSON: {"safetyBriefing":"...","suggestedFlags":["..."],' +
  '"severity":"medium","confidence":80}';

export interface CallAnalysis {
  safetyBriefing: string;
  suggestedFlags: string[];
  severity: 'low' | 'medium' | 'high';
  confidence: number;
  provider: string;
  fallback: boolean;
}

export async function analyzeCall(ai: Ai, call: CallContext): Promise<CallAnalysis> {
  const user =
    `Incident: ${call.incident_type ?? 'unknown'} (priority ${call.priority ?? '?'})\n` +
    `Location: ${call.location_address ?? `${call.latitude},${call.longitude}`}\n` +
    `${call.flags?.length ? `Existing flags: ${call.flags.join(', ')}` : ''}`;
  try {
    const res = (await ai.run(LLM_MODEL, {
      messages: [
        { role: 'system', content: ANALYZE_SYSTEM },
        { role: 'user', content: user },
      ],
      max_tokens: 300,
      temperature: 0.3,
    } as never)) as { response?: unknown };
    const p = extractJson(typeof res?.response === 'string' ? res.response : String(res?.response ?? ''));
    if (p && typeof p.safetyBriefing === 'string') {
      const sev = (['low', 'medium', 'high'] as const).includes(p.severity) ? p.severity : 'medium';
      return {
        safetyBriefing: String(p.safetyBriefing).slice(0, 600),
        suggestedFlags: Array.isArray(p.suggestedFlags) ? p.suggestedFlags.map(String).slice(0, 8) : [],
        severity: sev,
        confidence: Number.isFinite(p.confidence) ? Math.max(0, Math.min(100, Math.round(p.confidence))) : 60,
        provider: 'workers-ai',
        fallback: false,
      };
    }
  } catch (err) {
    log.error('analyzeCall LLM failed', {}, err);
  }
  return {
    safetyBriefing: 'AI briefing unavailable — proceed with standard caution and confirm scene status on arrival.',
    suggestedFlags: [],
    severity: 'medium',
    confidence: 0,
    provider: 'deterministic',
    fallback: true,
  };
}
