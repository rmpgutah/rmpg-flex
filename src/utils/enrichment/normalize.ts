import type { EnrichmentSeed } from './types';

function seedString(seed: EnrichmentSeed): string {
  const first = (seed.first_name ?? '').trim().toLowerCase();
  const last  = (seed.last_name  ?? '').trim().toLowerCase();
  const dob   = (seed.dob        ?? '').trim();
  return `${first}|${last}|${dob}`;
}

export async function computeCacheKey(seed: EnrichmentSeed): Promise<string> {
  const raw = new TextEncoder().encode(seedString(seed));
  const buf = await crypto.subtle.digest('SHA-256', raw);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
