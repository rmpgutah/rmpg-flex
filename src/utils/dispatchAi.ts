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
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
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
    } as never)) as { response?: string };
    const parsed = extractJson(res?.response || '');
    const valid = new Set(candidates.map((u) => u.callSign));
    const suggestions: UnitSuggestion[] = Array.isArray(parsed?.suggestions)
      ? parsed.suggestions
          .filter((s: any) => s && typeof s.call_sign === 'string' && valid.has(s.call_sign))
          .slice(0, 3)
          .map((s: any) => ({ call_sign: s.call_sign, reason: String(s.reason ?? '').slice(0, 200) }))
      : [];
    if (suggestions.length > 0) return { suggestions, provider: 'workers-ai', fallback: false };
  } catch (err) {
    console.error('[dispatchAi] suggestUnits LLM failed:', (err as Error)?.message);
  }
  return { suggestions: deterministicReasons(candidates), provider: 'deterministic', fallback: true };
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
    } as never)) as { response?: string };
    const p = extractJson(res?.response || '');
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
    console.error('[dispatchAi] analyzeCall LLM failed:', (err as Error)?.message);
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
