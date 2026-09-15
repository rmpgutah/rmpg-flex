// ============================================================
// RMPG Flex — SafeWatch inbound alert parser
// ------------------------------------------------------------
// Trust boundary for the team3-safewatch integration. Everything
// SafeWatch sends is untrusted public input (resident-submitted
// reports and third-party feed items), so this module validates or
// drops every field before it reaches D1.
//
// Two rules drive the shape of this file:
//   1. Never coerce an unknown enum into a valid one. Laundering a
//      'feed' item into a 'community' report (or inventing a
//      severity) destroys the provenance triage depends on, so an
//      unrecognized value is a 400, not a default.
//   2. Triage state is OURS. status / reviewed_by / promoted_tip_id
//      are deliberately absent from the parsed payload so a caller
//      cannot land a row pre-marked 'promoted' or attribute a review
//      to a real user id.
// ============================================================

export const MAX_HEADLINE = 200;
export const MAX_BODY = 4000;
export const MAX_SHORT_TEXT = 200;

export const SOURCE_KINDS = ['community', 'feed'] as const;
export const SEVERITIES = ['info', 'advisory', 'urgent'] as const;

export type SafewatchSourceKind = (typeof SOURCE_KINDS)[number];
export type SafewatchSeverity = (typeof SEVERITIES)[number];

export interface SafewatchAlertPayload {
  externalId: string;
  sourceKind: SafewatchSourceKind;
  source: string;
  alertType: string | null;
  severity: SafewatchSeverity;
  headline: string;
  body: string | null;
  locationText: string | null;
  latitude: number | null;
  longitude: number | null;
  reporterContact: string | null;
  occurredAt: string | null;
}

export type ParseResult =
  | { ok: true; payload: SafewatchAlertPayload }
  | { ok: false; error: string };

/** Trimmed non-empty string, truncated to `max`, else null. */
function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

/** Finite number within [min, max], else null. Rejects NaN and numeric
 *  strings — a coordinate arriving as text means the caller's own
 *  serialization is wrong and we'd rather drop it than guess. */
function bounded(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v >= min && v <= max ? v : null;
}

export function parseSafewatchAlert(input: unknown): ParseResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const b = input as Record<string, unknown>;

  const externalId = text(b.external_id, MAX_SHORT_TEXT);
  if (!externalId) return { ok: false, error: 'external_id is required' };

  const headline = text(b.headline, MAX_HEADLINE);
  if (!headline) return { ok: false, error: 'headline is required' };

  // Absent -> documented default. Present but unrecognized -> reject.
  let sourceKind: SafewatchSourceKind = 'community';
  if (b.source_kind !== undefined && b.source_kind !== null) {
    const k = text(b.source_kind, 32);
    if (!k || !(SOURCE_KINDS as readonly string[]).includes(k)) {
      return { ok: false, error: `source_kind must be one of: ${SOURCE_KINDS.join(', ')}` };
    }
    sourceKind = k as SafewatchSourceKind;
  }

  let severity: SafewatchSeverity = 'info';
  if (b.severity !== undefined && b.severity !== null) {
    const s = text(b.severity, 32);
    if (!s || !(SEVERITIES as readonly string[]).includes(s)) {
      return { ok: false, error: `severity must be one of: ${SEVERITIES.join(', ')}` };
    }
    severity = s as SafewatchSeverity;
  }

  // A lone latitude or longitude is not a location — keep the pair
  // atomic so a partial write can never plot on the map.
  const lat = bounded(b.latitude, -90, 90);
  const lon = bounded(b.longitude, -180, 180);
  const hasPair = lat !== null && lon !== null;

  let occurredAt: string | null = null;
  const rawOccurred = text(b.occurred_at, 64);
  if (rawOccurred) {
    const ms = Date.parse(rawOccurred);
    if (Number.isFinite(ms)) occurredAt = new Date(ms).toISOString();
  }

  return {
    ok: true,
    payload: {
      externalId,
      sourceKind,
      source: text(b.source, 64) ?? 'safewatch',
      alertType: text(b.alert_type, 64),
      severity,
      headline,
      body: text(b.body, MAX_BODY),
      locationText: text(b.location_text, MAX_SHORT_TEXT),
      latitude: hasPair ? lat : null,
      longitude: hasPair ? lon : null,
      reporterContact: text(b.reporter_contact, MAX_SHORT_TEXT),
      occurredAt,
    },
  };
}
