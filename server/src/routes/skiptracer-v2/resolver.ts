// ============================================================
// Skip Tracer v2 — Identity Resolver
// ============================================================
// Cross-references results from multiple data sources and merges
// them into unified DossierProfile objects. Pure logic — no DB,
// no API calls, no Express imports.

import { randomUUID } from 'crypto';
import type {
  SourceResult,
  DossierProfile,
  AddressRecord,
  PhoneRecord,
} from './types';
import { localNow } from '../../utils/timeUtils';

// ============================================================
// String Helpers
// ============================================================

/** Lowercase, trim, strip non-alphanumeric (keep spaces) */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ');
}

/** Strip everything except digits */
function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

/** Levenshtein edit distance between two strings */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Use single-row optimisation to keep memory O(n)
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// ============================================================
// Extracted Identity — lightweight struct for matching
// ============================================================

interface ExtractedIdentity {
  /** Index into the original SourceResult[] */
  idx: number;
  firstName: string;
  lastName: string;
  dob: string | null;
  city: string | null;
  state: string | null;
  phones: string[];   // digits-only
  emails: string[];   // lowercase
}

/** Pull the best identity fields out of a SourceResult */
function extractIdentity(r: SourceResult, idx: number): ExtractedIdentity {
  const nameRec = r.names?.[0];
  const firstName = normalizeName(nameRec?.first ?? nameRec?.full?.split(' ')[0] ?? '');
  const lastName = normalizeName(nameRec?.last ?? nameRec?.full?.split(' ').slice(-1)[0] ?? '');
  const dob = r.dobs?.[0]?.dob ?? null;

  // Best address for city/state
  const addr = r.addresses?.[0];
  const city = addr?.city ? normalizeName(addr.city) : null;
  const state = addr?.state ? addr.state.toUpperCase().trim() : null;

  const phones = (r.phones ?? []).map(p => digitsOnly(p.number)).filter(Boolean);
  const emails = (r.emails ?? []).map(e => e.address.toLowerCase().trim()).filter(Boolean);

  return { idx, firstName, lastName, dob, city, state, phones, emails };
}

// ============================================================
// Identity Matching
// ============================================================

/** Score how likely two identities refer to the same person. Returns 0 if no match. */
function matchScore(a: ExtractedIdentity, b: ExtractedIdentity): number {
  // Must have at least a last name to compare
  if (!a.lastName || !b.lastName) return 0;

  const lastExact = a.lastName === b.lastName;
  const firstExact = a.firstName === b.firstName && a.firstName !== '';
  const dobMatch = a.dob !== null && b.dob !== null && a.dob === b.dob;

  const cityStateOverlap =
    a.city !== null && b.city !== null &&
    a.state !== null && b.state !== null &&
    a.city === b.city && a.state === b.state;

  const phonesOverlap = a.phones.some(p => b.phones.includes(p));
  const emailsOverlap = a.emails.some(e => b.emails.includes(e));

  // Rule 1: exact last+first+DOB → 0.95
  if (lastExact && firstExact && dobMatch) return 0.95;

  // Rule 4 (checked before rule 2 since it requires DOB): fuzzy name + DOB → 0.80
  if (dobMatch) {
    const lastDist = levenshtein(a.lastName, b.lastName);
    const firstDist = levenshtein(a.firstName, b.firstName);
    if (lastDist <= 2 && firstDist <= 2) return 0.80;
  }

  // Rule 2: exact last+first + overlapping city/state → 0.75
  if (lastExact && firstExact && cityStateOverlap) return 0.75;

  // Rule 3: phone or email match + same last name → 0.65
  if (lastExact && (phonesOverlap || emailsOverlap)) return 0.65;

  return 0;
}

// ============================================================
// Union-Find for grouping matched results
// ============================================================

class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) { this.parent[ra] = rb; }
    else if (this.rank[ra] > this.rank[rb]) { this.parent[rb] = ra; }
    else { this.parent[rb] = ra; this.rank[ra]++; }
  }

  groups(): Map<number, number[]> {
    const m = new Map<number, number[]>();
    for (let i = 0; i < this.parent.length; i++) {
      const root = this.find(i);
      if (!m.has(root)) m.set(root, []);
      m.get(root)!.push(i);
    }
    return m;
  }
}

// ============================================================
// Deduplication Helpers
// ============================================================

/** Unique addresses by normalised (street + city + state + zip) */
export function dedupeAddresses(addresses: AddressRecord[]): AddressRecord[] {
  const seen = new Map<string, AddressRecord>();
  for (const a of addresses) {
    const key = [
      normalizeName(a.street),
      normalizeName(a.city),
      a.state.toUpperCase().trim(),
      digitsOnly(a.zip).slice(0, 5),
    ].join('|');
    if (!seen.has(key)) seen.set(key, a);
  }
  return Array.from(seen.values());
}

/** Unique phones by digits-only number */
export function dedupePhones(phones: PhoneRecord[]): PhoneRecord[] {
  const seen = new Map<string, PhoneRecord>();
  for (const p of phones) {
    const key = digitsOnly(p.number);
    if (key && !seen.has(key)) seen.set(key, p);
  }
  return Array.from(seen.values());
}

/** Unique emails by lowercase address */
export function dedupeEmails(
  emails: Array<{ source: string; address: string; type?: string; verified?: boolean }>
): Array<{ source: string; address: string; type?: string; verified?: boolean }> {
  const seen = new Map<string, typeof emails[number]>();
  for (const e of emails) {
    const key = e.address.toLowerCase().trim();
    if (key && !seen.has(key)) seen.set(key, e);
  }
  return Array.from(seen.values());
}

// ============================================================
// Profile Merging
// ============================================================

/** Merge a group of SourceResults (known to be the same person) into one DossierProfile */
export function mergeProfiles(results: SourceResult[], groupConfidence: number): DossierProfile {
  // Pick the most complete name (longest full_name across all results)
  let bestFirst = '';
  let bestMiddle = '';
  let bestLast = '';
  let bestSuffix = '';
  let bestFullLen = 0;
  const aliasSet = new Set<string>();

  for (const r of results) {
    for (const n of r.names ?? []) {
      const fullLen = (n.full ?? '').length;
      if (fullLen > bestFullLen) {
        bestFullLen = fullLen;
        bestFirst = n.first ?? n.full?.split(' ')[0] ?? '';
        bestMiddle = n.middle ?? '';
        bestLast = n.last ?? n.full?.split(' ').slice(-1)[0] ?? '';
        bestSuffix = n.suffix ?? '';
      }
      if (n.full) aliasSet.add(n.full);
    }
  }

  // Take first non-null DOB
  let dob: string | undefined;
  let age: number | undefined;
  for (const r of results) {
    if (r.dobs?.[0]) {
      dob = r.dobs[0].dob;
      age = r.dobs[0].age;
      break;
    }
  }

  // First non-null SSN last4
  let ssn_last4: string | undefined;
  for (const r of results) {
    if (r.ssns?.[0]) { ssn_last4 = r.ssns[0].last4; break; }
  }

  // First photo
  let photoUrl: string | undefined;
  for (const r of results) {
    if (r.photos?.[0]) { photoUrl = r.photos[0].url; break; }
  }

  // Remove the "best" name from aliases
  const bestFull = [bestFirst, bestMiddle, bestLast, bestSuffix].filter(Boolean).join(' ');
  aliasSet.delete(bestFull);
  // Also remove very similar strings
  for (const a of aliasSet) {
    if (normalizeName(a) === normalizeName(bestFull)) aliasSet.delete(a);
  }

  // Collect unique sources
  const sources = [...new Set(results.map(r => r.source))];

  // Concatenate + deduplicate sub-records
  const addresses = dedupeAddresses(results.flatMap(r => r.addresses ?? []));
  const phones = dedupePhones(results.flatMap(r => r.phones ?? []));
  const emails = dedupeEmails(results.flatMap(r => r.emails ?? []));

  // For record types without a custom deduper, just concat (they have unique IDs/case numbers)
  const socialProfiles = results.flatMap(r => r.socialProfiles ?? []);
  const associates = results.flatMap(r => r.associates ?? []);
  const courtRecords = results.flatMap(r => r.courtRecords ?? []);
  const propertyRecords = results.flatMap(r => r.propertyRecords ?? []);
  const licenses = results.flatMap(r => r.licenses ?? []);
  const vehicles = results.flatMap(r => r.vehicles ?? []);
  const businesses = results.flatMap(r => r.businesses ?? []);
  const watchlistFlags = results.flatMap(r => r.watchlistFlags ?? []);
  const sexOffenderRecords = results.flatMap(r => r.sexOffenderRecords ?? []);
  const custodyRecords = results.flatMap(r => r.custodyRecords ?? []);
  const photos = results.flatMap(r => r.photos ?? []);

  // Confidence = max of the group match score and individual source confidences
  const maxSourceConf = Math.max(...results.map(r => r.confidence), 0);
  const confidenceScore = Math.max(groupConfidence, maxSourceConf);

  return {
    id: randomUUID(),
    firstName: bestFirst || undefined,
    middleName: bestMiddle || undefined,
    lastName: bestLast || undefined,
    suffix: bestSuffix || undefined,
    aliases: aliasSet.size > 0 ? [...aliasSet] : undefined,
    dob,
    age,
    ssn_last4,
    photoUrl,
    addresses,
    phones,
    emails,
    socialProfiles,
    associates,
    courtRecords,
    propertyRecords,
    licenses,
    vehicles,
    businesses,
    watchlistFlags,
    sexOffenderRecords,
    custodyRecords,
    photos,
    sources,
    confidenceScore: Math.round(confidenceScore * 100) / 100,
  };
}

// ============================================================
// Main Entry Point
// ============================================================

/**
 * Resolve a flat array of SourceResults into deduplicated DossierProfiles.
 *
 * 1. Extract lightweight identity from each result
 * 2. Pairwise score all identities, union those that match
 * 3. Merge each group into a DossierProfile
 * 4. Return sorted by confidence (highest first)
 */
export function resolveResults(results: SourceResult[]): DossierProfile[] {
  if (results.length === 0) return [];

  // Extract identities
  const ids = results.map((r, i) => extractIdentity(r, i));

  // Pairwise matching with Union-Find
  const uf = new UnionFind(results.length);
  const pairScores = new Map<string, number>(); // track best score per pair

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const score = matchScore(ids[i], ids[j]);
      if (score > 0) {
        uf.union(i, j);
        const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
        pairScores.set(key, Math.max(pairScores.get(key) ?? 0, score));
      }
    }
  }

  // Build profiles from groups
  const groups = uf.groups();
  const profiles: DossierProfile[] = [];

  for (const [, members] of groups) {
    const groupResults = members.map(i => results[i]);

    // Group confidence = max pairwise match score within this group
    let groupConf = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const key = `${Math.min(members[i], members[j])}-${Math.max(members[i], members[j])}`;
        groupConf = Math.max(groupConf, pairScores.get(key) ?? 0);
      }
    }

    profiles.push(mergeProfiles(groupResults, groupConf));
  }

  // Sort by confidence descending
  profiles.sort((a, b) => b.confidenceScore - a.confidenceScore);

  return profiles;
}
