// Pure helpers for the secure-evidence chain-of-custody endpoint. Kept
// dependency-free so they unit-test under vitest without a D1 binding.

export const EVIDENCE_CLASSIFICATIONS = [
  'LAW ENFORCEMENT SENSITIVE',
  'EVIDENCE',
  'CONFIDENTIAL',
  'UNRESTRICTED',
] as const;
export type EvidenceClassification = (typeof EVIDENCE_CLASSIFICATIONS)[number];

/** Map any input to a known classification (default EVIDENCE). */
export function normalizeClassification(s: unknown): EvidenceClassification {
  const v = String(s ?? '').toUpperCase().trim();
  return (EVIDENCE_CLASSIFICATIONS as readonly string[]).includes(v)
    ? (v as EvidenceClassification)
    : 'EVIDENCE';
}

export interface ManifestInput {
  sha256?: unknown;
  classification?: unknown;
  captured_at?: unknown;
  sequence?: unknown;
}

/** A manifest must carry a real hex digest; everything else is best-effort. */
export function validateManifest(b: ManifestInput): { ok: boolean; error?: string } {
  const sha = String(b?.sha256 ?? '').trim();
  if (!/^[0-9a-fA-F]{16,128}$/.test(sha)) {
    return { ok: false, error: 'sha256 must be a hex digest (16–128 chars)' };
  }
  return { ok: true };
}

/** Human evidence number, e.g. evidenceNumber(2026, 42) → "26-EVD-00042". */
export function evidenceNumber(year: number, seq: number): string {
  return `${String(year).slice(-2)}-EVD-${String(Math.max(0, seq)).padStart(5, '0')}`;
}

/** Short fingerprint shown in lists / burned into the pixels. */
export function shortHash(hex: unknown): string {
  return String(hex ?? '').toUpperCase().slice(0, 16);
}
