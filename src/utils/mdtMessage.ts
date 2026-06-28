// Pure validation + helpers for the MDT message channel (phone ↔ in-vehicle
// desktop MDT). Kept dependency-free so it unit-tests under vitest. The route
// (src/routes/mdt.ts) wires these to D1.

export const MDT_DIRECTIONS = new Set(['to_mdt', 'to_phone']);
export const MDT_TYPES = new Set([
  'scan', 'person', 'plate', 'location', 'nav', 'draft', 'text', 'call',
]);

export type MdtDirection = 'to_mdt' | 'to_phone';
export type MdtEndpoint = 'mdt' | 'phone';
export interface MdtSend {
  direction: MdtDirection;
  type: string;
  payload: Record<string, unknown>;
}

/** Validate a /send body. Accepts `{direction}` or the friendlier `{to:'mdt'|'phone'}`. */
export function validateMdtSend(
  body: unknown,
): { ok: true; value: MdtSend } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body required' };
  const b = body as Record<string, unknown>;

  let direction = typeof b.direction === 'string' ? b.direction : undefined;
  if (!direction && typeof b.to === 'string') {
    direction = b.to === 'mdt' ? 'to_mdt' : b.to === 'phone' ? 'to_phone' : undefined;
  }
  if (!direction || !MDT_DIRECTIONS.has(direction)) {
    return { ok: false, error: 'direction must be to_mdt or to_phone' };
  }
  const type = typeof b.type === 'string' ? b.type : '';
  if (!MDT_TYPES.has(type)) {
    return { ok: false, error: `type must be one of ${[...MDT_TYPES].join(', ')}` };
  }
  const payload = b.payload && typeof b.payload === 'object' && !Array.isArray(b.payload)
    ? (b.payload as Record<string, unknown>)
    : {};
  return { ok: true, value: { direction: direction as MdtDirection, type, payload } };
}

/** The endpoint at the other end of the link. */
export function counterpartEndpoint(endpoint: string): MdtEndpoint {
  return endpoint === 'mdt' ? 'phone' : 'mdt';
}

/** Which message direction an endpoint reads from its inbox (mdt reads to_mdt). */
export function inboxDirectionFor(endpoint: string): MdtDirection {
  return endpoint === 'mdt' ? 'to_mdt' : 'to_phone';
}

/** Normalize an arbitrary `?endpoint=` query value to a known endpoint. */
export function normalizeEndpoint(raw: unknown): MdtEndpoint {
  return raw === 'mdt' ? 'mdt' : 'phone';
}

/** A counterpart is "online" if its last poll was within this many seconds. */
export const MDT_ONLINE_WINDOW_SECONDS = 45;
