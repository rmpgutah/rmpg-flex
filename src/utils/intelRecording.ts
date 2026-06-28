// Pure helpers for interaction audio recording (Intel Wave 3b).
// R2 key layout + sequence parsing — unit-tested in
// tests/intelRecording.test.ts. No D1/R2 imports here.

export function chunkKey(recordingId: number, seq: number): string {
  return `interactions/${recordingId}/${seq}.webm`;
}

// Parse a ?seq= query value to a non-negative integer, or null if invalid.
export function parseSeq(raw: string | undefined | null): number | null {
  if (raw == null || raw === '') return null;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
