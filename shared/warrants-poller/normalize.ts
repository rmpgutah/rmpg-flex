// Name/DOB normalization + dedup key generation.
// Pure functions, no I/O. Easy to unit-test.

export function normalizeName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^\w,\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// "John Q. Public" -> "PUBLIC, JOHN Q"
// "PUBLIC, JOHN Q" -> "PUBLIC, JOHN Q" (idempotent)
export function toCanonicalName(raw: string): string {
  const n = normalizeName(raw);
  if (n.includes(',')) return n;
  const parts = n.split(' ').filter(Boolean);
  if (parts.length < 2) return n;
  const last = parts[parts.length - 1];
  const rest = parts.slice(0, -1).join(' ');
  return `${last}, ${rest}`;
}

// Normalize DOB inputs (MM/DD/YYYY, M/D/YY, YYYY-MM-DD) -> YYYY-MM-DD.
// Returns undefined if unparseable. No timezone math — DOBs are dates, not instants.
export function normalizeDob(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return undefined;
  const [, mo, d, y] = m;
  const year = y.length === 2 ? (parseInt(y, 10) > 30 ? `19${y}` : `20${y}`) : y;
  return `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// Stable dedup key when a source doesn't expose a real warrant ID.
// Same person + same issuance + same charge set -> same hash.
export function syntheticWarrantId(parts: {
  name: string;
  dob?: string;
  issuedDate?: string;
  charges: string[];
}): string {
  const norm = [
    toCanonicalName(parts.name),
    parts.dob ?? '',
    parts.issuedDate ?? '',
    [...parts.charges].sort().join('|'),
  ].join('::');
  return 'syn_' + simpleHash(norm);
}

// FNV-1a 32-bit. Not cryptographic — only used as a content-addressed
// dedup key within a single source. Don't replace with SHA-256 without
// a reason; that's overkill for a 30-char-ish hash key.
function simpleHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
