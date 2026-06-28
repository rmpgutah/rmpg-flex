import { execute } from '../db';

/** Human footage-evidence number, e.g. footageEvidenceNumber(2026, 42) → "26-FEV-00042". */
export function footageEvidenceNumber(year: number, seq: number): string {
  return `${String(year).slice(-2)}-FEV-${String(Math.max(0, seq)).padStart(5, '0')}`;
}

/** View-dedupe key: one 'viewed' custody row per user per hour. isoTime = an ISO-8601 string. */
export function viewSessionKey(userId: number | null, isoTime: string): string {
  return `${userId ?? 0}|${isoTime.slice(0, 13)}`; // YYYY-MM-DDTHH
}

/** Unlock requires a non-empty reason. */
export function isUnlockable(reason: unknown): boolean {
  return typeof reason === 'string' && reason.trim().length > 0;
}

export interface CourtChunk { seq: number; from_ts: number; to_ts: number; bytes: number; sha256: string | null; }
export interface CourtManifest {
  evidence_number: string | null;
  request_id: number;
  classification: string;
  preserved_reason: string | null;
  window: { from_ts: number; to_ts: number };
  chunks: CourtChunk[];
  gaps: number[];
  case_refs: Array<{ entity_type: string; entity_id: number }>;
  custody: Array<{ action: string; actor_name: string | null; reason: string | null; created_at: string }>;
  // Additive enrichment: present only when the lazy MP4 remux has produced a
  // single-file artifact. Older callers that ignore these stay correct.
  merged_sha256?: string | null;
  merged_url?: string;
}

interface BuildArgs {
  request: {
    id: number; evidence_number: string | null; classification: string;
    preserved_reason: string | null; from_ts: number; to_ts: number;
    // Optional merged-remux state (added in Task 17); absent on legacy callers.
    merged_status?: string | null;
    merged_r2_key?: string | null;
    merged_sha256?: string | null;
  };
  chunks: Array<{ seq: number; from_ts: number; to_ts: number; bytes: number; sha256: string | null; status: string }>;
  links: Array<{ entity_type: string; entity_id: number }>;
  custody: Array<{ action: string; actor_name: string | null; reason: string | null; created_at: string }>;
}

/** Build the canonical court manifest (stable field order → deterministic hash). */
export function buildCourtManifest(a: BuildArgs): CourtManifest {
  const sorted = [...a.chunks].sort((x, y) => x.seq - y.seq);
  const manifest: CourtManifest = {
    evidence_number: a.request.evidence_number,
    request_id: a.request.id,
    classification: a.request.classification,
    preserved_reason: a.request.preserved_reason,
    window: { from_ts: a.request.from_ts, to_ts: a.request.to_ts },
    chunks: sorted.map((c) => ({ seq: c.seq, from_ts: c.from_ts, to_ts: c.to_ts, bytes: c.bytes, sha256: c.sha256 })),
    gaps: sorted.filter((c) => c.status === 'missing').map((c) => c.seq),
    case_refs: a.links.map((l) => ({ entity_type: l.entity_type, entity_id: l.entity_id })),
    custody: a.custody.map((e) => ({ action: e.action, actor_name: e.actor_name, reason: e.reason, created_at: e.created_at })),
  };
  // Additive enrichment: when the lazy MP4→fMP4 remux has produced a
  // single-file artifact, attach its hash + retrieval URL to the manifest.
  // Skipped when not ready — manifests stay backward-compatible.
  if (a.request.merged_status === 'ready' && a.request.merged_r2_key) {
    manifest.merged_sha256 = a.request.merged_sha256 ?? null;
    manifest.merged_url = `/api/flexcam/footage/${a.request.id}/continuous`;
  }
  return manifest;
}

/** SHA-256 hex of the canonical manifest JSON (lowercase, 64 chars). */
export async function manifestPayloadHash(manifest: CourtManifest): Promise<string> {
  const json = JSON.stringify(manifest);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Append a chain-of-custody entry. INSERT OR IGNORE so the partial-unique 'viewed'
 *  index makes a repeat view in the same session a no-op. Best-effort (never throws). */
export async function logCustody(
  db: D1Database,
  e: { requestId: number; action: string; actorUserId?: number | null; actorName?: string | null; reason?: string | null; detail?: unknown; sessionKey?: string | null },
): Promise<void> {
  try {
    await execute(db,
      `INSERT OR IGNORE INTO footage_custody_log
        (footage_request_id, action, actor_user_id, actor_name, reason, detail, session_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      e.requestId, e.action, e.actorUserId ?? null, e.actorName ?? null,
      e.reason ?? null, e.detail != null ? JSON.stringify(e.detail) : null, e.sessionKey ?? null);
  } catch { /* best-effort custody — never disrupt the caller */ }
}
