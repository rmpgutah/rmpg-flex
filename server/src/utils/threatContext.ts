/**
 * Threat Context Builder — Officer Safety Intelligence
 *
 * Queries multiple DB tables to assemble a threat/safety context for any
 * call location or subject.  Returns structured data suitable for voice
 * narratives and the TTS safety-briefing pipeline.
 */

import { getDb } from '../models/database';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThreatLevel = 'low' | 'elevated' | 'high' | 'critical';

export interface PremiseHistory {
  totalCalls: number;
  armedIncidents: number;
  dvIncidents: number;
  drugIncidents: number;
  shootingIncidents: number;
}

export interface SubjectAlert {
  personId: number;
  name: string;
  gangAffiliation: string | null;
  isSexOffender: boolean;
  hasCriminalHistory: boolean;
  cautionFlags: string | null;
}

export interface ActiveWarrant {
  warrantId: number;
  personId: number;
  personName: string;
  warrantType: string;
  severity: string;
  description: string | null;
}

export interface TrespassOrder {
  id: number;
  locationAddress: string;
  subjectName: string | null;
  expiresAt: string | null;
  isActive: boolean;
}

export interface FieldInterviewSummary {
  personId: number;
  count: number;
  lastDate: string | null;
}

export interface NearbyIncident {
  callId: number;
  callType: string;
  address: string;
  createdAt: string;
  hadWeapon: boolean;
  hadInjury: boolean;
}

export interface ThreatContext {
  premiseHistory: PremiseHistory;
  subjectAlerts: SubjectAlert[];
  activeWarrants: ActiveWarrant[];
  trespassOrders: TrespassOrder[];
  fieldInterviews: FieldInterviewSummary[];
  nearbyIncidents: NearbyIncident[];
  threatLevel: ThreatLevel;
  briefingSummary: string;
}

export interface BuildThreatContextParams {
  locationAddress?: string;
  latitude?: number;
  longitude?: number;
  personIds?: number[];
  callId?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely run a DB query — returns empty result when the table doesn't exist. */
function safeAll<T = any>(sql: string, params: any[] = []): T[] {
  try {
    const db = getDb();
    return db.prepare(sql).all(...params) as T[];
  } catch {
    return [];
  }
}

function safeGet<T = any>(sql: string, params: any[] = []): T | undefined {
  try {
    const db = getDb();
    return db.prepare(sql).get(...params) as T | undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

function queryPremiseHistory(address: string | undefined): PremiseHistory {
  const empty: PremiseHistory = { totalCalls: 0, armedIncidents: 0, dvIncidents: 0, drugIncidents: 0, shootingIncidents: 0 };
  if (!address) return empty;

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const since = oneYearAgo.toISOString();

  const rows = safeAll<{ call_type: string; nature: string | null }>(
    `SELECT call_type, nature FROM calls_for_service
     WHERE address = ? AND created_at >= ?`,
    [address, since],
  );

  let armed = 0, dv = 0, drug = 0, shooting = 0;
  for (const r of rows) {
    const text = `${r.call_type ?? ''} ${r.nature ?? ''}`.toLowerCase();
    if (text.includes('armed') || text.includes('weapon') || text.includes('gun') || text.includes('firearm')) armed++;
    if (text.includes('domestic') || text.includes('dv')) dv++;
    if (text.includes('drug') || text.includes('narcotic') || text.includes('controlled substance')) drug++;
    if (text.includes('shooting') || text.includes('shots fired') || text.includes('gunshot')) shooting++;
  }

  return { totalCalls: rows.length, armedIncidents: armed, dvIncidents: dv, drugIncidents: drug, shootingIncidents: shooting };
}

function querySubjectAlerts(personIds: number[] | undefined): SubjectAlert[] {
  if (!personIds || personIds.length === 0) return [];

  const placeholders = personIds.map(() => '?').join(',');
  return safeAll<any>(
    `SELECT id, first_name, last_name, gang_affiliation, is_sex_offender,
            has_criminal_history, caution_flags
     FROM persons WHERE id IN (${placeholders})`,
    personIds,
  ).map(r => ({
    personId: r.id,
    name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(),
    gangAffiliation: r.gang_affiliation || null,
    isSexOffender: !!r.is_sex_offender,
    hasCriminalHistory: !!r.has_criminal_history,
    cautionFlags: r.caution_flags || null,
  }));
}

function queryActiveWarrants(personIds: number[] | undefined): ActiveWarrant[] {
  if (!personIds || personIds.length === 0) return [];

  const placeholders = personIds.map(() => '?').join(',');
  return safeAll<any>(
    `SELECT w.id AS warrant_id, w.person_id, w.warrant_type, w.severity, w.description,
            p.first_name, p.last_name
     FROM warrants w
     LEFT JOIN persons p ON p.id = w.person_id
     WHERE w.person_id IN (${placeholders})
       AND (w.status = 'active' OR w.status = 'ACTIVE')`,
    personIds,
  ).map(r => ({
    warrantId: r.warrant_id,
    personId: r.person_id,
    personName: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(),
    warrantType: r.warrant_type ?? 'unknown',
    severity: r.severity ?? 'unknown',
    description: r.description || null,
  }));
}

function queryTrespassOrders(address: string | undefined): TrespassOrder[] {
  if (!address) return [];

  return safeAll<any>(
    `SELECT id, location_address, subject_name, expires_at, status
     FROM trespass_orders
     WHERE location_address = ?`,
    [address],
  ).map(r => ({
    id: r.id,
    locationAddress: r.location_address,
    subjectName: r.subject_name || null,
    expiresAt: r.expires_at || null,
    isActive: (r.status ?? '').toLowerCase() === 'active',
  }));
}

function queryFieldInterviews(personIds: number[] | undefined): FieldInterviewSummary[] {
  if (!personIds || personIds.length === 0) return [];

  const placeholders = personIds.map(() => '?').join(',');
  return safeAll<any>(
    `SELECT person_id, COUNT(*) AS cnt, MAX(interview_date) AS last_date
     FROM field_interviews
     WHERE person_id IN (${placeholders})
     GROUP BY person_id`,
    personIds,
  ).map(r => ({
    personId: r.person_id,
    count: r.cnt,
    lastDate: r.last_date || null,
  }));
}

function queryNearbyIncidents(lat: number | undefined, lng: number | undefined): NearbyIncident[] {
  if (lat == null || lng == null) return [];

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const since = thirtyDaysAgo.toISOString();

  // ~0.01 degrees ≈ 1 km
  const delta = 0.01;

  return safeAll<any>(
    `SELECT id, call_type, address, created_at, had_weapon, had_injury
     FROM calls_for_service
     WHERE latitude BETWEEN ? AND ?
       AND longitude BETWEEN ? AND ?
       AND created_at >= ?
     ORDER BY created_at DESC
     LIMIT 50`,
    [lat - delta, lat + delta, lng - delta, lng + delta, since],
  ).map(r => ({
    callId: r.id,
    callType: r.call_type ?? 'unknown',
    address: r.address ?? '',
    createdAt: r.created_at ?? '',
    hadWeapon: !!r.had_weapon,
    hadInjury: !!r.had_injury,
  }));
}

// ---------------------------------------------------------------------------
// Threat scoring
// ---------------------------------------------------------------------------

function scoreThreatLevel(
  premise: PremiseHistory,
  alerts: SubjectAlert[],
  warrants: ActiveWarrant[],
  trespass: TrespassOrder[],
  nearby: NearbyIncident[],
): ThreatLevel {
  let score = 0;

  // Premise-based scoring
  if (premise.shootingIncidents > 0) score += 30;
  if (premise.armedIncidents > 0) score += 20;
  if (premise.dvIncidents > 0) score += 10;

  // Warrant scoring
  const hasFelonyWarrant = warrants.some(
    w => (w.severity ?? '').toLowerCase() === 'felony' || (w.warrantType ?? '').toLowerCase() === 'felony',
  );
  if (hasFelonyWarrant) score += 25;
  else if (warrants.length > 0) score += 10;

  // Subject scoring
  if (alerts.some(a => a.gangAffiliation)) score += 15;
  if (alerts.some(a => a.isSexOffender)) score += 10;

  // Nearby incidents
  if (nearby.length > 2) score += 15;

  // Trespass orders
  if (trespass.length > 0) score += 5;

  if (score >= 50) return 'critical';
  if (score >= 30) return 'high';
  if (score >= 15) return 'elevated';
  return 'low';
}

// ---------------------------------------------------------------------------
// Briefing summary (voice-ready narrative)
// ---------------------------------------------------------------------------

export function composeThreatBriefing(ctx: ThreatContext): string {
  const parts: string[] = [];

  // Threat advisory header
  if (ctx.threatLevel === 'critical') {
    parts.push('CRITICAL THREAT ADVISORY.');
  } else if (ctx.threatLevel === 'high') {
    parts.push('HIGH THREAT ADVISORY.');
  } else if (ctx.threatLevel === 'elevated') {
    parts.push('ELEVATED THREAT ADVISORY.');
  }

  // Premise history
  const ph = ctx.premiseHistory;
  if (ph.totalCalls > 0) {
    const flags: string[] = [];
    if (ph.shootingIncidents > 0) flags.push(`${ph.shootingIncidents} shooting`);
    if (ph.armedIncidents > 0) flags.push(`${ph.armedIncidents} armed`);
    if (ph.dvIncidents > 0) flags.push(`${ph.dvIncidents} domestic violence`);
    if (ph.drugIncidents > 0) flags.push(`${ph.drugIncidents} drug`);
    const detail = flags.length > 0 ? `, including ${flags.join(', ')} incidents` : '';
    parts.push(`Location has ${ph.totalCalls} prior calls in the last year${detail}.`);
  }

  // Warrants
  if (ctx.activeWarrants.length > 0) {
    const felonies = ctx.activeWarrants.filter(
      w => (w.severity ?? '').toLowerCase() === 'felony' || (w.warrantType ?? '').toLowerCase() === 'felony',
    );
    if (felonies.length > 0) {
      parts.push(`${felonies.length} active felony warrant${felonies.length > 1 ? 's' : ''} on linked subjects.`);
    }
    const other = ctx.activeWarrants.length - felonies.length;
    if (other > 0) {
      parts.push(`${other} additional active warrant${other > 1 ? 's' : ''}.`);
    }
  }

  // Subject alerts
  for (const alert of ctx.subjectAlerts) {
    const flags: string[] = [];
    if (alert.gangAffiliation) flags.push(`gang affiliation: ${alert.gangAffiliation}`);
    if (alert.isSexOffender) flags.push('registered sex offender');
    if (alert.cautionFlags) flags.push(`caution: ${alert.cautionFlags}`);
    if (flags.length > 0) {
      parts.push(`Subject ${alert.name}: ${flags.join('; ')}.`);
    }
  }

  // Trespass orders
  if (ctx.trespassOrders.length > 0) {
    const active = ctx.trespassOrders.filter(t => t.isActive);
    if (active.length > 0) {
      parts.push(`${active.length} active trespass order${active.length > 1 ? 's' : ''} at this location.`);
    }
  }

  // Nearby incidents
  const weaponIncidents = ctx.nearbyIncidents.filter(i => i.hadWeapon);
  if (ctx.nearbyIncidents.length > 0) {
    let msg = `${ctx.nearbyIncidents.length} incidents within 1km in last 30 days`;
    if (weaponIncidents.length > 0) {
      msg += `, ${weaponIncidents.length} involving weapons`;
    }
    parts.push(msg + '.');
  }

  // Field interviews
  const totalFIs = ctx.fieldInterviews.reduce((sum, fi) => sum + fi.count, 0);
  if (totalFIs > 0) {
    parts.push(`${totalFIs} prior field interview${totalFIs > 1 ? 's' : ''} with linked subjects.`);
  }

  if (parts.length === 0) {
    return 'No significant threat indicators for this location or subjects.';
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function buildThreatContext(params: BuildThreatContextParams): Promise<ThreatContext> {
  const { locationAddress, latitude, longitude, personIds } = params;

  const premiseHistory = queryPremiseHistory(locationAddress);
  const subjectAlerts = querySubjectAlerts(personIds);
  const activeWarrants = queryActiveWarrants(personIds);
  const trespassOrders = queryTrespassOrders(locationAddress);
  const fieldInterviews = queryFieldInterviews(personIds);
  const nearbyIncidents = queryNearbyIncidents(latitude, longitude);

  const threatLevel = scoreThreatLevel(premiseHistory, subjectAlerts, activeWarrants, trespassOrders, nearbyIncidents);

  const ctx: ThreatContext = {
    premiseHistory,
    subjectAlerts,
    activeWarrants,
    trespassOrders,
    fieldInterviews,
    nearbyIncidents,
    threatLevel,
    briefingSummary: '',
  };

  ctx.briefingSummary = composeThreatBriefing(ctx);
  return ctx;
}
