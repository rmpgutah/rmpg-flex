# Advanced Voice Dispatch System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the voice dispatch system from reactive alerts to proactive AI-powered dispatch intelligence with officer safety intelligence, conversational AI, tactical automation, and full data integration.

**Architecture:** Server-side utilities (threatContext, voiceNLU, proximityAlerts, officerWelfare, pursuitTracker, shiftBriefing) feed data into the voice command route and WebSocket broadcasts. Client-side modules (stressAnalyzer, conversationMemory, statementRecorder) extend the voice channel state machine. Groq LLM provides real-time NLU and tactical analysis.

**Tech Stack:** Groq (Llama 3.3 70B) for NLU, Edge-TTS for speech, Web Speech API + Whisper for STT, WebSocket for real-time events, better-sqlite3 for queries, Haversine for GPS distance.

---

### Task 1: Threat Context Builder

**Files:**
- Create: `server/src/utils/threatContext.ts`

**Step 1: Create the threat context module**

This module queries multiple database tables to build a comprehensive threat/safety context for any call location or subject. It returns structured data that gets woven into voice narratives.

```typescript
// server/src/utils/threatContext.ts
import { getDb } from '../models/database';

export interface ThreatContext {
  premiseHistory: PremiseAlert[];
  subjectAlerts: SubjectAlert[];
  activeWarrants: WarrantInfo[];
  trespassOrders: TrespassInfo[];
  fieldInterviews: FieldInterviewInfo[];
  nearbyIncidents: NearbyIncident[];
  threatLevel: 'low' | 'elevated' | 'high' | 'critical';
  briefingSummary: string;
}

export interface PremiseAlert {
  type: string; // 'armed_history', 'dv_history', 'drug_history', 'shooting_history'
  count: number;
  lastDate: string;
  details?: string;
}

export interface SubjectAlert {
  personId: number;
  name: string;
  warrantCount: number;
  gangAffiliation?: string;
  isSexOffender: boolean;
  hasCriminalHistory: boolean;
  cautionFlags?: string;
}

export interface WarrantInfo {
  warrantId: string;
  subjectName: string;
  chargeDescription: string;
  warrantType: string; // 'felony', 'misdemeanor'
  bailAmount?: number;
  issuingAgency?: string;
}

export interface TrespassInfo {
  propertyName: string;
  subjectName: string;
  expiresAt: string;
  arrestAuthority: boolean;
}

export interface FieldInterviewInfo {
  subjectName: string;
  contactCount: number;
  lastContact: string;
  reason?: string;
  location?: string;
}

export interface NearbyIncident {
  callNumber: string;
  incidentType: string;
  date: string;
  distance?: string;
  hadWeapons: boolean;
  hadInjuries: boolean;
}

/**
 * Build threat context for a call location and any linked subjects.
 * Queries: calls_for_service (premise history), persons + warrants,
 * trespass_orders, field_interviews, sex offender registry.
 */
export function buildThreatContext(params: {
  locationAddress?: string;
  latitude?: number;
  longitude?: number;
  personIds?: number[];
  callId?: number;
}): ThreatContext {
  const db = getDb();
  const ctx: ThreatContext = {
    premiseHistory: [],
    subjectAlerts: [],
    activeWarrants: [],
    trespassOrders: [],
    fieldInterviews: [],
    nearbyIncidents: [],
    threatLevel: 'low',
    briefingSummary: '',
  };

  // ── 1. Premise history: prior calls at this address ──
  if (params.locationAddress) {
    const addr = params.locationAddress.trim().toUpperCase();
    const priorCalls = db.prepare(`
      SELECT incident_type, weapons_involved, domestic_violence, drugs_involved,
             injuries_reported, created_at
      FROM calls_for_service
      WHERE UPPER(location_address) LIKE ?
        AND id != ?
        AND created_at > datetime('now', '-1 year')
      ORDER BY created_at DESC
      LIMIT 20
    `).all(`%${addr.slice(0, 30)}%`, params.callId || 0) as any[];

    const armedCount = priorCalls.filter(c => c.weapons_involved && c.weapons_involved !== 'None').length;
    const dvCount = priorCalls.filter(c => c.domestic_violence).length;
    const drugCount = priorCalls.filter(c => c.drugs_involved).length;
    const shootingCount = priorCalls.filter(c =>
      (c.incident_type || '').toLowerCase().includes('shooting') ||
      (c.incident_type || '').toLowerCase().includes('shots_fired')
    ).length;

    if (armedCount > 0) ctx.premiseHistory.push({
      type: 'armed_history', count: armedCount,
      lastDate: priorCalls.find(c => c.weapons_involved && c.weapons_involved !== 'None')?.created_at || '',
    });
    if (dvCount > 0) ctx.premiseHistory.push({
      type: 'dv_history', count: dvCount,
      lastDate: priorCalls.find(c => c.domestic_violence)?.created_at || '',
    });
    if (drugCount > 0) ctx.premiseHistory.push({
      type: 'drug_history', count: drugCount,
      lastDate: priorCalls.find(c => c.drugs_involved)?.created_at || '',
    });
    if (shootingCount > 0) ctx.premiseHistory.push({
      type: 'shooting_history', count: shootingCount,
      lastDate: priorCalls.find(c => (c.incident_type || '').toLowerCase().includes('shoot'))?.created_at || '',
    });
  }

  // ── 2. Subject alerts: persons linked to the call ──
  if (params.personIds && params.personIds.length > 0) {
    for (const pid of params.personIds) {
      const person = db.prepare(`
        SELECT id, first_name, last_name, caution_flags, gang_affiliation,
               is_sex_offender, has_criminal_history
        FROM persons WHERE id = ?
      `).get(pid) as any;
      if (!person) continue;

      const warrants = db.prepare(`
        SELECT id FROM warrants WHERE person_id = ? AND status = 'active'
      `).all(pid) as any[];

      ctx.subjectAlerts.push({
        personId: person.id,
        name: `${person.first_name} ${person.last_name}`,
        warrantCount: warrants.length,
        gangAffiliation: person.gang_affiliation || undefined,
        isSexOffender: !!person.is_sex_offender,
        hasCriminalHistory: !!person.has_criminal_history,
        cautionFlags: person.caution_flags || undefined,
      });
    }
  }

  // ── 3. Active warrants for linked subjects ──
  if (params.personIds && params.personIds.length > 0) {
    const placeholders = params.personIds.map(() => '?').join(',');
    const warrants = db.prepare(`
      SELECT w.id, w.charge_description, w.warrant_type, w.bail_amount, w.issuing_agency,
             p.first_name, p.last_name
      FROM warrants w
      JOIN persons p ON w.person_id = p.id
      WHERE w.person_id IN (${placeholders}) AND w.status = 'active'
      LIMIT 10
    `).all(...params.personIds) as any[];

    for (const w of warrants) {
      ctx.activeWarrants.push({
        warrantId: String(w.id),
        subjectName: `${w.first_name} ${w.last_name}`,
        chargeDescription: w.charge_description || 'Unknown charge',
        warrantType: w.warrant_type || 'unknown',
        bailAmount: w.bail_amount || undefined,
        issuingAgency: w.issuing_agency || undefined,
      });
    }
  }

  // ── 4. Trespass orders at this location ──
  if (params.locationAddress) {
    try {
      const orders = db.prepare(`
        SELECT property_name, subject_name, expires_at, arrest_authority
        FROM trespass_orders
        WHERE UPPER(property_address) LIKE ?
          AND (expires_at IS NULL OR expires_at > datetime('now'))
          AND status = 'active'
        LIMIT 5
      `).all(`%${params.locationAddress.trim().toUpperCase().slice(0, 30)}%`) as any[];

      for (const o of orders) {
        ctx.trespassOrders.push({
          propertyName: o.property_name || 'Unknown property',
          subjectName: o.subject_name || 'Unknown subject',
          expiresAt: o.expires_at || 'No expiry',
          arrestAuthority: !!o.arrest_authority,
        });
      }
    } catch { /* table may not exist in dev */ }
  }

  // ── 5. Field interviews for linked subjects ──
  if (params.personIds && params.personIds.length > 0) {
    try {
      for (const pid of params.personIds) {
        const fis = db.prepare(`
          SELECT COUNT(*) as cnt, MAX(interview_date) as last_date
          FROM field_interviews
          WHERE person_id = ?
        `).get(pid) as any;

        if (fis && fis.cnt > 0) {
          const person = db.prepare(`SELECT first_name, last_name FROM persons WHERE id = ?`).get(pid) as any;
          ctx.fieldInterviews.push({
            subjectName: person ? `${person.first_name} ${person.last_name}` : 'Unknown',
            contactCount: fis.cnt,
            lastContact: fis.last_date || 'Unknown',
          });
        }
      }
    } catch { /* table may not exist in dev */ }
  }

  // ── 6. Nearby incidents (last 30 days, same beat/zone) ──
  if (params.latitude && params.longitude) {
    try {
      // Simple proximity check: same general area (within ~0.01 degrees ≈ 1km)
      const nearby = db.prepare(`
        SELECT call_number, incident_type, created_at, weapons_involved, injuries_reported,
               latitude, longitude
        FROM calls_for_service
        WHERE latitude IS NOT NULL
          AND ABS(latitude - ?) < 0.01
          AND ABS(longitude - ?) < 0.01
          AND id != ?
          AND created_at > datetime('now', '-30 days')
          AND (weapons_involved IS NOT NULL AND weapons_involved != 'None'
               OR injuries_reported = 1
               OR incident_type IN ('shooting', 'shots_fired', 'armed_robbery', 'assault'))
        ORDER BY created_at DESC
        LIMIT 5
      `).all(params.latitude, params.longitude, params.callId || 0) as any[];

      for (const n of nearby) {
        ctx.nearbyIncidents.push({
          callNumber: n.call_number,
          incidentType: n.incident_type || 'Unknown',
          date: n.created_at,
          hadWeapons: !!n.weapons_involved && n.weapons_involved !== 'None',
          hadInjuries: !!n.injuries_reported,
        });
      }
    } catch { /* lat/lng columns may not exist in dev */ }
  }

  // ── 7. Calculate threat level ──
  let score = 0;
  if (ctx.premiseHistory.some(p => p.type === 'shooting_history')) score += 30;
  if (ctx.premiseHistory.some(p => p.type === 'armed_history')) score += 20;
  if (ctx.premiseHistory.some(p => p.type === 'dv_history')) score += 10;
  if (ctx.activeWarrants.some(w => w.warrantType === 'felony')) score += 25;
  if (ctx.activeWarrants.length > 0) score += 10;
  if (ctx.subjectAlerts.some(s => s.gangAffiliation)) score += 15;
  if (ctx.subjectAlerts.some(s => s.isSexOffender)) score += 10;
  if (ctx.nearbyIncidents.length > 2) score += 15;
  if (ctx.trespassOrders.length > 0) score += 5;

  if (score >= 50) ctx.threatLevel = 'critical';
  else if (score >= 30) ctx.threatLevel = 'high';
  else if (score >= 15) ctx.threatLevel = 'elevated';
  else ctx.threatLevel = 'low';

  // ── 8. Build briefing summary for voice ──
  const parts: string[] = [];

  for (const p of ctx.premiseHistory) {
    if (p.type === 'shooting_history') parts.push(`CAUTION: ${p.count} prior shooting incident${p.count > 1 ? 's' : ''} at this location.`);
    else if (p.type === 'armed_history') parts.push(`Prior armed calls at this location, ${p.count} in the last year.`);
    else if (p.type === 'dv_history') parts.push(`Prior domestic violence at this location, ${p.count} in the last year.`);
    else if (p.type === 'drug_history') parts.push(`Prior drug activity at this location.`);
  }

  for (const w of ctx.activeWarrants) {
    const bail = w.bailAmount ? `, bail $${w.bailAmount.toLocaleString()}` : '';
    parts.push(`Active ${w.warrantType} warrant on ${w.subjectName}: ${w.chargeDescription}${bail}.`);
  }

  for (const s of ctx.subjectAlerts) {
    if (s.gangAffiliation) parts.push(`Subject ${s.name}: gang affiliation ${s.gangAffiliation}.`);
    if (s.isSexOffender) parts.push(`Subject ${s.name}: registered sex offender.`);
    if (s.cautionFlags) parts.push(`Subject ${s.name}: caution flags — ${s.cautionFlags}.`);
  }

  for (const t of ctx.trespassOrders) {
    parts.push(`Active trespass order at ${t.propertyName}. Subject ${t.subjectName}${t.arrestAuthority ? ', arrest authority granted' : ''}.`);
  }

  for (const fi of ctx.fieldInterviews) {
    if (fi.contactCount >= 3) parts.push(`${fi.subjectName}: ${fi.contactCount} field contacts in area, last on ${fi.lastContact}.`);
  }

  if (ctx.nearbyIncidents.length > 0) {
    const weaponIncidents = ctx.nearbyIncidents.filter(n => n.hadWeapons);
    if (weaponIncidents.length > 0) {
      parts.push(`${weaponIncidents.length} armed incident${weaponIncidents.length > 1 ? 's' : ''} within 1 kilometer in the last 30 days.`);
    }
  }

  ctx.briefingSummary = parts.join(' ');
  return ctx;
}

/**
 * Compose the threat context as a voice-ready narrative segment.
 * Returns empty string if no threats detected.
 */
export function composeThreatBriefing(ctx: ThreatContext): string {
  if (!ctx.briefingSummary) return '';
  const prefix = ctx.threatLevel === 'critical' ? 'CRITICAL THREAT ADVISORY.'
    : ctx.threatLevel === 'high' ? 'HIGH THREAT ADVISORY.'
    : ctx.threatLevel === 'elevated' ? 'ELEVATED CAUTION.'
    : '';
  return prefix ? `${prefix} ${ctx.briefingSummary}` : ctx.briefingSummary;
}
```

**Step 2: Commit**

```bash
git add server/src/utils/threatContext.ts
git commit -m "feat: add threat context builder for officer safety intelligence"
```

---

### Task 2: Voice NLU Engine (AI-Powered Command Understanding)

**Files:**
- Create: `server/src/utils/voiceNLU.ts`

**Step 1: Create the NLU module**

Uses Groq via aiManager to parse free-form voice commands into structured dispatch actions when regex fails.

```typescript
// server/src/utils/voiceNLU.ts
import aiManager from './aiManager';

export interface NLUResult {
  action: string;
  params: Record<string, any>;
  confidence: number;
  explanation?: string;
}

const SYSTEM_PROMPT = `You are a police dispatch voice command parser for RMPG Flex CAD system.
Parse the officer's spoken command into a structured JSON action.

Available actions:
- status_update: { status: "en_route"|"on_scene"|"available"|"out_of_service"|"on_break"|"busy" }
- acknowledge: {}
- request_backup: { situation?: string, priority?: "P1"|"P2"|"P3" }
- request_ems: { reason?: string }
- request_k9: { reason?: string }
- run_plate: { plate: string }
- next_call: {}
- start_pursuit: { direction?: string, vehicle_description?: string, speed?: string }
- mark_evidence: { description?: string }
- create_call: { incident_type: string, location?: string, priority?: string, description?: string, suspect_description?: string, vehicle_description?: string }
- case_status: { case_number: string }
- link_case: { case_number: string }
- start_statement: { call_number?: string }
- end_statement: {}
- code_4: {} (officer is safe / all clear)

Respond with JSON only:
{ "action": "...", "params": { ... }, "confidence": 0.0-1.0 }

If you cannot determine the action, respond:
{ "action": "unknown", "params": {}, "confidence": 0.0 }`;

/**
 * Parse a voice transcript using AI when regex matching fails.
 * Returns structured command or null if AI unavailable.
 */
export async function parseWithNLU(transcript: string): Promise<NLUResult | null> {
  const status = aiManager.getStatus();
  if (!status.available) return null;

  try {
    const response = await aiManager.chat(
      SYSTEM_PROMPT,
      `Officer said: "${transcript}"`,
      { temperature: 0.1, maxTokens: 200, jsonMode: true }
    );

    if (!response) return null;

    const parsed = JSON.parse(response);
    return {
      action: parsed.action || 'unknown',
      params: parsed.params || {},
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    };
  } catch (err: any) {
    console.error('[VoiceNLU] Parse error:', err?.message);
    return null;
  }
}

/**
 * Generate a conversational follow-up question when more info is needed.
 */
export async function generateFollowUp(
  action: string,
  missingFields: string[],
  conversationHistory: Array<{ role: string; text: string }>,
): Promise<string | null> {
  const status = aiManager.getStatus();
  if (!status.available) return null;

  try {
    const historyText = conversationHistory.map(h => `${h.role}: ${h.text}`).join('\n');
    const response = await aiManager.chat(
      `You are a police dispatcher AI. Generate a brief spoken follow-up question to get missing information. Keep it under 20 words. Sound professional and urgent.`,
      `Action: ${action}\nMissing: ${missingFields.join(', ')}\nConversation:\n${historyText}`,
      { temperature: 0.3, maxTokens: 50 }
    );
    return response;
  } catch {
    return null;
  }
}

/**
 * Generate a tactical assessment for major severity calls.
 */
export async function generateTacticalAssessment(callData: {
  incident_type: string;
  description?: string;
  weapons_involved?: string;
  threatLevel?: string;
  location?: string;
}): Promise<string | null> {
  const status = aiManager.getStatus();
  if (!status.available) return null;

  try {
    const response = await aiManager.chat(
      `You are a tactical advisor for police dispatch. Given a call's details, provide a 1-2 sentence tactical recommendation. Be direct, actionable, and mention specific unit types if applicable (SWAT, K-9, air support, etc). No preamble.`,
      `Incident: ${callData.incident_type}\nWeapons: ${callData.weapons_involved || 'Unknown'}\nThreat level: ${callData.threatLevel || 'Unknown'}\nLocation: ${callData.location || 'Unknown'}\nDescription: ${callData.description || 'None'}`,
      { temperature: 0.2, maxTokens: 100 }
    );
    return response;
  } catch {
    return null;
  }
}
```

**Step 2: Commit**

```bash
git add server/src/utils/voiceNLU.ts
git commit -m "feat: add AI-powered voice NLU engine with Groq for natural language commands"
```

---

### Task 3: Proximity Alerts Module

**Files:**
- Create: `server/src/utils/proximityAlerts.ts`

**Step 1: Create the proximity alerts module**

Checks GPS positions against known hazard locations (sex offender residences, prior shootings, gang territory).

```typescript
// server/src/utils/proximityAlerts.ts
import { getDb } from '../models/database';

export interface ProximityAlert {
  type: 'sex_offender' | 'shooting_history' | 'high_crime' | 'trespass_property';
  description: string;
  distance: number; // meters
  latitude: number;
  longitude: number;
}

const ALERT_RADIUS_METERS = 200;
const EARTH_RADIUS_M = 6371000;

/** Haversine distance in meters between two GPS coordinates */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Check for proximity hazards near a GPS position.
 * Returns alerts for hazards within ALERT_RADIUS_METERS (200m).
 */
export function checkProximityHazards(lat: number, lng: number): ProximityAlert[] {
  const db = getDb();
  const alerts: ProximityAlert[] = [];
  const degreeRange = ALERT_RADIUS_METERS / 111000; // ~111km per degree

  // 1. Sex offender residences
  try {
    const offenders = db.prepare(`
      SELECT name, address, latitude, longitude
      FROM offender_registry
      WHERE latitude IS NOT NULL
        AND ABS(latitude - ?) < ?
        AND ABS(longitude - ?) < ?
      LIMIT 10
    `).all(lat, degreeRange, lng, degreeRange) as any[];

    for (const o of offenders) {
      const dist = haversineDistance(lat, lng, o.latitude, o.longitude);
      if (dist <= ALERT_RADIUS_METERS) {
        alerts.push({
          type: 'sex_offender',
          description: `Registered sex offender ${o.name || 'unknown'} resides ${Math.round(dist)} meters from your position.`,
          distance: dist,
          latitude: o.latitude,
          longitude: o.longitude,
        });
      }
    }
  } catch { /* table may not exist */ }

  // 2. Prior shooting locations (last 6 months)
  try {
    const shootings = db.prepare(`
      SELECT call_number, location_address, latitude, longitude, created_at
      FROM calls_for_service
      WHERE latitude IS NOT NULL
        AND ABS(latitude - ?) < ?
        AND ABS(longitude - ?) < ?
        AND incident_type IN ('shooting', 'shots_fired', 'active_shooter')
        AND created_at > datetime('now', '-6 months')
      LIMIT 5
    `).all(lat, degreeRange, lng, degreeRange) as any[];

    for (const s of shootings) {
      const dist = haversineDistance(lat, lng, s.latitude, s.longitude);
      if (dist <= ALERT_RADIUS_METERS) {
        alerts.push({
          type: 'shooting_history',
          description: `Prior shooting at ${s.location_address || 'nearby location'}, ${Math.round(dist)} meters away.`,
          distance: dist,
          latitude: s.latitude,
          longitude: s.longitude,
        });
      }
    }
  } catch { /* columns may not exist */ }

  return alerts.sort((a, b) => a.distance - b.distance);
}

/**
 * Compose proximity alerts as a voice-ready narrative.
 */
export function composeProximityNarrative(alerts: ProximityAlert[]): string {
  if (alerts.length === 0) return '';
  const parts = ['Proximity warning.'];
  for (const a of alerts.slice(0, 3)) { // max 3 alerts to keep narration brief
    parts.push(a.description);
  }
  return parts.join(' ');
}

/**
 * Find nearest available units to a location.
 * Returns units sorted by distance with ETA estimates.
 */
export function findNearestUnits(
  callLat: number,
  callLng: number,
  limit = 5,
): Array<{ callSign: string; distance: number; etaMinutes: number; status: string }> {
  const db = getDb();

  try {
    // Get all available units with recent GPS
    const units = db.prepare(`
      SELECT u.call_sign, u.status, g.latitude, g.longitude
      FROM dispatch_units u
      LEFT JOIN (
        SELECT call_sign, latitude, longitude,
               ROW_NUMBER() OVER (PARTITION BY call_sign ORDER BY timestamp DESC) as rn
        FROM gps_locations
        WHERE timestamp > datetime('now', '-10 minutes')
      ) g ON g.call_sign = u.call_sign AND g.rn = 1
      WHERE u.status IN ('available', 'on_break', 'busy')
        AND g.latitude IS NOT NULL
    `).all() as any[];

    return units
      .map(u => {
        const dist = haversineDistance(callLat, callLng, u.latitude, u.longitude);
        // Rough ETA: assume 40 km/h average urban speed
        const etaMinutes = Math.round((dist / 1000) / 40 * 60);
        return {
          callSign: u.call_sign,
          distance: Math.round(dist),
          etaMinutes: Math.max(1, etaMinutes),
          status: u.status,
        };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Compose nearest unit suggestions as voice narrative.
 */
export function composeNearestUnitsNarrative(
  units: Array<{ callSign: string; distance: number; etaMinutes: number; status: string }>
): string {
  if (units.length === 0) return 'No available units with GPS located.';
  const parts = ['Nearest available units:'];
  for (const u of units.slice(0, 3)) {
    const distStr = u.distance >= 1000
      ? `${(u.distance / 1000).toFixed(1)} kilometers`
      : `${u.distance} meters`;
    parts.push(`${u.callSign}, ${distStr}, estimated ${u.etaMinutes} minute${u.etaMinutes !== 1 ? 's' : ''}.`);
  }
  return parts.join(' ');
}
```

**Step 2: Commit**

```bash
git add server/src/utils/proximityAlerts.ts
git commit -m "feat: add GPS proximity alerts with Haversine distance and nearest unit finder"
```

---

### Task 4: Officer Welfare Monitor

**Files:**
- Create: `server/src/utils/officerWelfare.ts`

**Step 1: Create the welfare monitor module**

Tracks officers on high-priority calls and auto-triggers welfare checks if they go silent.

```typescript
// server/src/utils/officerWelfare.ts
import { broadcastDispatchUpdate, sendToUser } from '../utils/websocket';
import { getDb } from '../models/database';

interface WelfareWatch {
  userId: number;
  callSign: string;
  callId: number;
  callNumber: string;
  startedAt: number;
  lastActivity: number;
  priority: string;
  checksSent: number;
  escalated: boolean;
}

const activeWatches = new Map<number, WelfareWatch>();

// Timings (ms)
const INITIAL_CHECK_MS = 15 * 60 * 1000;    // 15 min — first prompt
const FOLLOWUP_CHECK_MS = 2 * 60 * 1000;     // 2 min after first prompt
const ESCALATION_MS = 5 * 60 * 1000;          // 5 min after first prompt — all units

/**
 * Start monitoring an officer who is on scene at a P1/P2 call.
 */
export function startWelfareWatch(
  userId: number,
  callSign: string,
  callId: number,
  callNumber: string,
  priority: string,
): void {
  // Only monitor P1 and P2 calls
  if (priority !== 'P1' && priority !== 'P2') return;

  activeWatches.set(userId, {
    userId,
    callSign,
    callId,
    callNumber,
    startedAt: Date.now(),
    lastActivity: Date.now(),
    priority,
    checksSent: 0,
    escalated: false,
  });
}

/**
 * Record activity from an officer (voice command, status update, GPS ping).
 * Resets the welfare timer.
 */
export function recordOfficerActivity(userId: number): void {
  const watch = activeWatches.get(userId);
  if (watch) {
    watch.lastActivity = Date.now();
    watch.checksSent = 0; // reset if they were being checked
  }
}

/**
 * Clear welfare watch (officer cleared scene, went available, etc).
 */
export function clearWelfareWatch(userId: number): void {
  activeWatches.delete(userId);
}

/**
 * Check all active welfare watches and trigger alerts as needed.
 * Call this on a timer (every 30 seconds).
 */
export function checkWelfareWatches(): Array<{
  type: 'prompt' | 'supervisor' | 'all_units';
  userId: number;
  callSign: string;
  callNumber: string;
  message: string;
}> {
  const now = Date.now();
  const alerts: Array<{
    type: 'prompt' | 'supervisor' | 'all_units';
    userId: number;
    callSign: string;
    callNumber: string;
    message: string;
  }> = [];

  for (const [userId, watch] of activeWatches) {
    const silentMs = now - watch.lastActivity;

    // Stage 1: 15 min silent — prompt officer
    if (silentMs >= INITIAL_CHECK_MS && watch.checksSent === 0) {
      watch.checksSent = 1;
      alerts.push({
        type: 'prompt',
        userId,
        callSign: watch.callSign,
        callNumber: watch.callNumber,
        message: `${watch.callSign}, status check on call ${watch.callNumber}. Are you code 4?`,
      });

      // Send direct WebSocket to the officer
      sendToUser(userId, 'welfare_check', {
        callSign: watch.callSign,
        callNumber: watch.callNumber,
        message: 'Status check — respond with voice command or status update.',
      });
    }

    // Stage 2: 2 min after prompt — notify supervisor
    if (silentMs >= INITIAL_CHECK_MS + FOLLOWUP_CHECK_MS && watch.checksSent === 1) {
      watch.checksSent = 2;
      alerts.push({
        type: 'supervisor',
        userId,
        callSign: watch.callSign,
        callNumber: watch.callNumber,
        message: `No response from ${watch.callSign} on call ${watch.callNumber}. Supervisor notified.`,
      });

      // Notify supervisors via broadcast
      broadcastDispatchUpdate({
        action: 'welfare_alert',
        severity: 'high',
        call_sign: watch.callSign,
        call_number: watch.callNumber,
        message: `No response from ${watch.callSign} after ${Math.round(silentMs / 60000)} minutes on scene.`,
      });
    }

    // Stage 3: 5 min after prompt — all units broadcast
    if (silentMs >= INITIAL_CHECK_MS + ESCALATION_MS && !watch.escalated) {
      watch.escalated = true;
      alerts.push({
        type: 'all_units',
        userId,
        callSign: watch.callSign,
        callNumber: watch.callNumber,
        message: `All units, welfare check. ${watch.callSign} unresponsive on call ${watch.callNumber}. All available units respond to ${watch.callSign}'s last known location.`,
      });

      broadcastDispatchUpdate({
        action: 'welfare_emergency',
        severity: 'major',
        call_sign: watch.callSign,
        call_number: watch.callNumber,
        message: `WELFARE EMERGENCY: ${watch.callSign} unresponsive.`,
      });
    }
  }

  return alerts;
}

/**
 * Get count of active welfare watches.
 */
export function getActiveWatchCount(): number {
  return activeWatches.size;
}

/**
 * Respond to welfare check (officer said "code 4" or "all clear").
 */
export function acknowledgeWelfareCheck(userId: number): string | null {
  const watch = activeWatches.get(userId);
  if (!watch || watch.checksSent === 0) return null;

  const msg = `${watch.callSign} acknowledged, code 4 on call ${watch.callNumber}.`;
  watch.lastActivity = Date.now();
  watch.checksSent = 0;
  watch.escalated = false;

  return msg;
}
```

**Step 2: Commit**

```bash
git add server/src/utils/officerWelfare.ts
git commit -m "feat: add officer welfare monitor with 3-stage escalation protocol"
```

---

### Task 5: Pursuit Tracker

**Files:**
- Create: `server/src/utils/pursuitTracker.ts`

**Step 1: Create the pursuit tracker**

Tracks active pursuits and generates periodic GPS-based voice updates.

```typescript
// server/src/utils/pursuitTracker.ts
import { getDb } from '../models/database';
import { broadcastDispatchUpdate } from '../utils/websocket';
import { haversineDistance, findNearestUnits } from './proximityAlerts';

interface ActivePursuit {
  id: string;
  callSign: string;
  callId?: number;
  startedAt: number;
  lastUpdate: number;
  lastLat: number;
  lastLng: number;
  lastAddress: string;
  lastSpeed?: number;
  lastHeading?: string;
  updateCount: number;
}

const activePursuits = new Map<string, ActivePursuit>();
const UPDATE_INTERVAL_MS = 30_000; // 30 seconds

/**
 * Start tracking a pursuit for a unit.
 */
export function startPursuit(callSign: string, callId?: number): void {
  const db = getDb();
  const gps = db.prepare(`
    SELECT latitude, longitude, address, speed, heading
    FROM gps_locations WHERE call_sign = ? ORDER BY timestamp DESC LIMIT 1
  `).get(callSign) as any;

  activePursuits.set(callSign, {
    id: `pursuit-${Date.now()}`,
    callSign,
    callId,
    startedAt: Date.now(),
    lastUpdate: Date.now(),
    lastLat: gps?.latitude || 0,
    lastLng: gps?.longitude || 0,
    lastAddress: gps?.address || 'unknown location',
    lastSpeed: gps?.speed,
    lastHeading: gps?.heading,
    updateCount: 0,
  });
}

/**
 * End a pursuit.
 */
export function endPursuit(callSign: string): string {
  const pursuit = activePursuits.get(callSign);
  if (!pursuit) return `No active pursuit for ${callSign}.`;

  const durationMin = Math.round((Date.now() - pursuit.startedAt) / 60000);
  activePursuits.delete(callSign);

  broadcastDispatchUpdate({
    action: 'pursuit_ended',
    call_sign: callSign,
    duration_minutes: durationMin,
  });

  return `Pursuit ended for ${callSign}. Duration: ${durationMin} minutes.`;
}

/**
 * Generate pursuit updates for all active pursuits.
 * Call on a 30-second timer.
 */
export function generatePursuitUpdates(): Array<{
  callSign: string;
  narrative: string;
}> {
  const db = getDb();
  const updates: Array<{ callSign: string; narrative: string }> = [];
  const now = Date.now();

  for (const [callSign, pursuit] of activePursuits) {
    if (now - pursuit.lastUpdate < UPDATE_INTERVAL_MS) continue;

    // Get latest GPS
    const gps = db.prepare(`
      SELECT latitude, longitude, address, speed, heading
      FROM gps_locations WHERE call_sign = ? ORDER BY timestamp DESC LIMIT 1
    `).get(callSign) as any;

    if (!gps?.latitude) continue;

    pursuit.lastLat = gps.latitude;
    pursuit.lastLng = gps.longitude;
    pursuit.lastAddress = gps.address || pursuit.lastAddress;
    pursuit.lastSpeed = gps.speed;
    pursuit.lastHeading = gps.heading;
    pursuit.lastUpdate = now;
    pursuit.updateCount++;

    // Find nearest intercept unit
    const nearestUnits = findNearestUnits(gps.latitude, gps.longitude, 3)
      .filter(u => u.callSign !== callSign); // exclude pursuing unit

    const parts = [`Pursuit update, ${callSign}.`];
    if (gps.address) parts.push(`Location: ${gps.address}.`);
    if (gps.heading) parts.push(`Heading ${gps.heading}.`);
    if (gps.speed) parts.push(`Speed: ${Math.round(gps.speed)} miles per hour.`);

    if (nearestUnits.length > 0) {
      const nearest = nearestUnits[0];
      const distStr = nearest.distance >= 1000
        ? `${(nearest.distance / 1000).toFixed(1)} kilometers`
        : `${nearest.distance} meters`;
      parts.push(`Nearest intercept: ${nearest.callSign}, ${distStr} away.`);
    }

    updates.push({ callSign, narrative: parts.join(' ') });

    // Broadcast via WebSocket too
    broadcastDispatchUpdate({
      action: 'pursuit_update',
      call_sign: callSign,
      location: gps.address,
      latitude: gps.latitude,
      longitude: gps.longitude,
      speed: gps.speed,
      heading: gps.heading,
      nearest_unit: nearestUnits[0]?.callSign,
    });
  }

  return updates;
}

/**
 * Get count of active pursuits.
 */
export function getActivePursuitCount(): number {
  return activePursuits.size;
}

export function isInPursuit(callSign: string): boolean {
  return activePursuits.has(callSign);
}
```

**Step 2: Commit**

```bash
git add server/src/utils/pursuitTracker.ts
git commit -m "feat: add pursuit tracker with 30s GPS updates and intercept unit suggestions"
```

---

### Task 6: Shift Briefing Generator

**Files:**
- Create: `server/src/utils/shiftBriefing.ts`

**Step 1: Create the shift briefing module**

```typescript
// server/src/utils/shiftBriefing.ts
import { getDb } from '../models/database';

export interface ShiftSummary {
  shiftDate: string;
  totalCalls: number;
  callsByPriority: Record<string, number>;
  callsByType: Array<{ type: string; count: number }>;
  arrests: number;
  pursuits: number;
  panicAlerts: number;
  openCalls: number;
  openCallDetails: Array<{ callNumber: string; type: string; location: string; priority: string }>;
  unitsOnDuty: number;
  narrative: string;
}

/**
 * Generate a shift summary for the current or specified date range.
 */
export function generateShiftSummary(
  startTime?: string,
  endTime?: string,
): ShiftSummary {
  const db = getDb();
  const start = startTime || new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const end = endTime || new Date().toISOString();

  // Total calls in shift
  const totalCalls = (db.prepare(`
    SELECT COUNT(*) as cnt FROM calls_for_service
    WHERE created_at BETWEEN ? AND ?
  `).get(start, end) as any)?.cnt || 0;

  // Calls by priority
  const byPriority: Record<string, number> = {};
  const priorities = db.prepare(`
    SELECT priority, COUNT(*) as cnt FROM calls_for_service
    WHERE created_at BETWEEN ? AND ?
    GROUP BY priority
  `).all(start, end) as any[];
  for (const p of priorities) byPriority[p.priority || 'Unknown'] = p.cnt;

  // Top call types
  const callsByType = db.prepare(`
    SELECT incident_type as type, COUNT(*) as count FROM calls_for_service
    WHERE created_at BETWEEN ? AND ? AND incident_type IS NOT NULL
    GROUP BY incident_type ORDER BY count DESC LIMIT 5
  `).all(start, end) as any[];

  // Open calls still active
  const openCallRows = db.prepare(`
    SELECT call_number, incident_type, location_address, priority
    FROM calls_for_service
    WHERE status NOT IN ('closed', 'cleared', 'cancelled') AND archived = 0
    ORDER BY CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END
    LIMIT 10
  `).all() as any[];

  // Units currently on duty
  const unitsOnDuty = (db.prepare(`
    SELECT COUNT(*) as cnt FROM dispatch_units WHERE status != 'off_duty'
  `).get() as any)?.cnt || 0;

  // Build narrative
  const parts: string[] = [];
  parts.push(`Shift summary.`);
  parts.push(`${totalCalls} calls handled.`);

  if (byPriority['P1']) parts.push(`${byPriority['P1']} priority one calls.`);
  if (byPriority['P2']) parts.push(`${byPriority['P2']} priority two calls.`);

  if (openCallRows.length > 0) {
    parts.push(`${openCallRows.length} open calls carrying over:`);
    for (const c of openCallRows.slice(0, 3)) {
      const type = (c.incident_type || 'Unknown').replace(/_/g, ' ');
      parts.push(`${type} at ${c.location_address || 'unknown location'}, ${c.priority || ''}.`);
    }
    if (openCallRows.length > 3) parts.push(`Plus ${openCallRows.length - 3} additional open calls.`);
  } else {
    parts.push('No open calls carrying over.');
  }

  parts.push(`${unitsOnDuty} units currently on duty.`);

  return {
    shiftDate: new Date().toISOString().split('T')[0],
    totalCalls,
    callsByPriority: byPriority,
    callsByType,
    arrests: 0, // TODO: count from arrests table if exists
    pursuits: 0,
    panicAlerts: 0,
    openCalls: openCallRows.length,
    openCallDetails: openCallRows.map(c => ({
      callNumber: c.call_number,
      type: c.incident_type || 'Unknown',
      location: c.location_address || 'Unknown',
      priority: c.priority || 'Unknown',
    })),
    unitsOnDuty,
    narrative: parts.join(' '),
  };
}
```

**Step 2: Commit**

```bash
git add server/src/utils/shiftBriefing.ts
git commit -m "feat: add shift briefing generator with voice narrative summaries"
```

---

### Task 7: Client-Side Stress Analyzer

**Files:**
- Create: `client/src/utils/stressAnalyzer.ts`

**Step 1: Create the stress analyzer**

Analyzes mic audio for stress indicators: pitch, speech rate, volume spikes.

```typescript
// client/src/utils/stressAnalyzer.ts
// ============================================================
// RMPG Flex — Voice Stress Analyzer
// Analyzes audio from officer voice commands for stress indicators:
//   - Pitch elevation (>20% above baseline)
//   - Speech rate acceleration (>30% faster)
//   - Volume spikes
// When stress detected, signals the voice channel to auto-escalate.
// ============================================================

export interface StressResult {
  isStressed: boolean;
  confidence: number;     // 0-1
  pitchDeviation: number; // % above baseline
  volumeSpike: boolean;
  rateDeviation: number;  // % above baseline
}

// Baseline values (calibrated for average adult male/female)
const BASELINE_PITCH_HZ = 180;     // average speaking pitch
const BASELINE_VOLUME_RMS = 0.15;   // average RMS
const PITCH_STRESS_THRESHOLD = 1.20; // 20% above baseline
const VOLUME_SPIKE_THRESHOLD = 2.0;  // 2x baseline
const MIN_ANALYSIS_SAMPLES = 10;

/**
 * Analyze an audio buffer for stress indicators.
 * Uses Web Audio API's AnalyserNode for frequency and volume data.
 */
export function createStressAnalyzer(audioContext: AudioContext): {
  connectSource: (source: MediaStreamAudioSourceNode) => void;
  getResult: () => StressResult;
  disconnect: () => void;
} {
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;

  const freqData = new Float32Array(analyser.frequencyBinCount);
  const timeData = new Float32Array(analyser.fftSize);

  let pitchSamples: number[] = [];
  let volumeSamples: number[] = [];
  let samplingInterval: ReturnType<typeof setInterval> | null = null;

  function sample(): void {
    analyser.getFloatFrequencyData(freqData);
    analyser.getFloatTimeDomainData(timeData);

    // Estimate pitch from dominant frequency
    let maxMag = -Infinity;
    let maxIdx = 0;
    for (let i = 5; i < freqData.length; i++) { // skip DC and very low freqs
      if (freqData[i] > maxMag) {
        maxMag = freqData[i];
        maxIdx = i;
      }
    }
    const dominantFreq = (maxIdx * audioContext.sampleRate) / analyser.fftSize;
    if (dominantFreq > 50 && dominantFreq < 500 && maxMag > -60) {
      pitchSamples.push(dominantFreq);
    }

    // Calculate RMS volume
    let sum = 0;
    for (let i = 0; i < timeData.length; i++) {
      sum += timeData[i] * timeData[i];
    }
    const rms = Math.sqrt(sum / timeData.length);
    if (rms > 0.01) { // ignore silence
      volumeSamples.push(rms);
    }
  }

  return {
    connectSource(source: MediaStreamAudioSourceNode): void {
      source.connect(analyser);
      pitchSamples = [];
      volumeSamples = [];
      samplingInterval = setInterval(sample, 100); // sample every 100ms
    },

    getResult(): StressResult {
      if (pitchSamples.length < MIN_ANALYSIS_SAMPLES) {
        return { isStressed: false, confidence: 0, pitchDeviation: 0, volumeSpike: false, rateDeviation: 0 };
      }

      // Average pitch
      const avgPitch = pitchSamples.reduce((a, b) => a + b, 0) / pitchSamples.length;
      const pitchRatio = avgPitch / BASELINE_PITCH_HZ;
      const pitchDeviation = (pitchRatio - 1) * 100; // % above baseline

      // Volume analysis
      const avgVolume = volumeSamples.reduce((a, b) => a + b, 0) / (volumeSamples.length || 1);
      const maxVolume = Math.max(...volumeSamples, 0);
      const volumeSpike = maxVolume > BASELINE_VOLUME_RMS * VOLUME_SPIKE_THRESHOLD;

      // Stress scoring
      let stressScore = 0;
      if (pitchRatio > PITCH_STRESS_THRESHOLD) stressScore += 0.4;
      if (pitchRatio > 1.3) stressScore += 0.2; // >30% is high stress
      if (volumeSpike) stressScore += 0.2;
      if (avgVolume > BASELINE_VOLUME_RMS * 1.5) stressScore += 0.1;

      // Rate estimation: more voice activity samples = faster speech
      const voiceActivityRatio = volumeSamples.length / (pitchSamples.length + volumeSamples.length || 1);
      const rateDeviation = (voiceActivityRatio - 0.5) * 200; // normalize to %
      if (rateDeviation > 30) stressScore += 0.1;

      return {
        isStressed: stressScore >= 0.5,
        confidence: Math.min(1, stressScore),
        pitchDeviation: Math.round(pitchDeviation),
        volumeSpike,
        rateDeviation: Math.round(rateDeviation),
      };
    },

    disconnect(): void {
      if (samplingInterval) clearInterval(samplingInterval);
      try { analyser.disconnect(); } catch { /* ignore */ }
      pitchSamples = [];
      volumeSamples = [];
    },
  };
}
```

**Step 2: Commit**

```bash
git add client/src/utils/stressAnalyzer.ts
git commit -m "feat: add voice stress analyzer for officer distress detection"
```

---

### Task 8: Conversation Memory Module

**Files:**
- Create: `client/src/utils/conversationMemory.ts`

**Step 1: Create the conversation memory**

Stores last N exchanges for multi-turn voice dialogs and confirmation flows.

```typescript
// client/src/utils/conversationMemory.ts
// ============================================================
// RMPG Flex — Voice Conversation Memory
// Stores recent exchanges for multi-turn voice interactions.
// Enables confirmation prompts, follow-up questions, and
// context-aware command disambiguation.
// ============================================================

export interface ConversationEntry {
  role: 'officer' | 'system';
  text: string;
  timestamp: number;
  action?: string;
  awaitingConfirmation?: boolean;
  confirmationAction?: string;
  confirmationParams?: Record<string, any>;
}

const MAX_ENTRIES = 6; // 3 exchanges (officer + system each)
const MEMORY_TTL_MS = 5 * 60 * 1000; // 5 minutes — memory expires

let entries: ConversationEntry[] = [];
let lastInteraction = 0;

/**
 * Add an entry to conversation memory.
 */
export function addEntry(entry: Omit<ConversationEntry, 'timestamp'>): void {
  lastInteraction = Date.now();
  entries.push({ ...entry, timestamp: Date.now() });
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(-MAX_ENTRIES);
  }
}

/**
 * Get recent conversation history.
 * Returns empty if memory has expired.
 */
export function getHistory(): ConversationEntry[] {
  if (Date.now() - lastInteraction > MEMORY_TTL_MS) {
    entries = [];
    return [];
  }
  return [...entries];
}

/**
 * Check if the system is awaiting a confirmation response.
 */
export function getPendingConfirmation(): ConversationEntry | null {
  const history = getHistory();
  const last = history[history.length - 1];
  if (last?.role === 'system' && last.awaitingConfirmation) {
    return last;
  }
  return null;
}

/**
 * Set a pending confirmation that the system is waiting for.
 */
export function setPendingConfirmation(
  message: string,
  action: string,
  params: Record<string, any>,
): void {
  addEntry({
    role: 'system',
    text: message,
    awaitingConfirmation: true,
    confirmationAction: action,
    confirmationParams: params,
  });
}

/**
 * Check if a transcript is a confirmation response.
 */
export function isConfirmation(transcript: string): boolean {
  const t = transcript.toLowerCase().trim();
  return /\b(confirm|affirm|10-?4|copy|yes|roger|go ahead|proceed)\b/.test(t);
}

/**
 * Check if a transcript is a denial/cancellation.
 */
export function isDenial(transcript: string): boolean {
  const t = transcript.toLowerCase().trim();
  return /\b(cancel|negative|no|deny|stop|abort|disregard)\b/.test(t);
}

/**
 * Clear all conversation memory.
 */
export function clearMemory(): void {
  entries = [];
  lastInteraction = 0;
}

/**
 * Get the last officer transcript for context.
 */
export function getLastOfficerText(): string | null {
  const history = getHistory();
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'officer') return history[i].text;
  }
  return null;
}
```

**Step 2: Commit**

```bash
git add client/src/utils/conversationMemory.ts
git commit -m "feat: add conversation memory for multi-turn voice dialogs"
```

---

### Task 9: Statement Recorder Module

**Files:**
- Create: `client/src/utils/statementRecorder.ts`

**Step 1: Create the statement recorder**

Provides continuous speech-to-text transcription that appends to a call's narrative.

```typescript
// client/src/utils/statementRecorder.ts
// ============================================================
// RMPG Flex — Witness Statement Recorder
// Continuous speech-to-text that appends to a call's narrative.
// Activated by "start statement" voice command, stopped by "end statement".
// ============================================================

export interface StatementState {
  active: boolean;
  callNumber: string | null;
  callId: number | null;
  startedAt: number | null;
  transcript: string;
  wordCount: number;
}

let state: StatementState = {
  active: false,
  callNumber: null,
  callId: null,
  startedAt: null,
  transcript: '',
  wordCount: 0,
};

let recognition: any = null;
let onTranscriptCallback: ((text: string, isFinal: boolean) => void) | null = null;
let onErrorCallback: ((error: string) => void) | null = null;

/**
 * Start recording a witness statement.
 */
export function startStatement(
  callNumber: string,
  callId: number,
  callbacks: {
    onTranscript: (text: string, isFinal: boolean) => void;
    onError: (error: string) => void;
  },
): boolean {
  if (state.active) return false;

  const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) {
    callbacks.onError('Speech recognition not available');
    return false;
  }

  state = {
    active: true,
    callNumber,
    callId,
    startedAt: Date.now(),
    transcript: '',
    wordCount: 0,
  };

  onTranscriptCallback = callbacks.onTranscript;
  onErrorCallback = callbacks.onError;

  recognition = new SpeechRecognitionCtor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event: any) => {
    let finalText = '';
    let interimText = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalText += event.results[i][0].transcript;
      } else {
        interimText += event.results[i][0].transcript;
      }
    }

    if (finalText) {
      state.transcript += (state.transcript ? ' ' : '') + finalText.trim();
      state.wordCount = state.transcript.split(/\s+/).length;
      onTranscriptCallback?.(state.transcript, true);

      // Save to server periodically (every final result)
      saveToServer(state.callId!, state.transcript);
    }

    if (interimText) {
      onTranscriptCallback?.(state.transcript + ' ' + interimText, false);
    }
  };

  recognition.onerror = (event: any) => {
    if (event.error === 'no-speech') return;
    if (event.error === 'aborted') return;
    onErrorCallback?.(`Statement recording error: ${event.error}`);
  };

  recognition.onend = () => {
    // Auto-restart if still active
    if (state.active) {
      try { recognition.start(); } catch { /* ignore */ }
    }
  };

  try {
    recognition.start();
    return true;
  } catch {
    state.active = false;
    return false;
  }
}

/**
 * Stop recording and finalize the statement.
 */
export function endStatement(): StatementState {
  const result = { ...state };

  if (recognition) {
    try { recognition.abort(); } catch { /* ignore */ }
    recognition = null;
  }

  // Final save
  if (state.callId && state.transcript) {
    saveToServer(state.callId, state.transcript, true);
  }

  state = { active: false, callNumber: null, callId: null, startedAt: null, transcript: '', wordCount: 0 };
  onTranscriptCallback = null;
  onErrorCallback = null;

  return result;
}

/**
 * Get current statement state.
 */
export function getStatementState(): StatementState {
  return { ...state };
}

/**
 * Check if currently recording a statement.
 */
export function isRecording(): boolean {
  return state.active;
}

// ── Server sync ──

async function saveToServer(callId: number, transcript: string, isFinal = false): Promise<void> {
  try {
    const token = localStorage.getItem('rmpg-token');
    await fetch('/api/voice/statement', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ callId, transcript, isFinal }),
    });
  } catch { /* non-critical, don't block recording */ }
}
```

**Step 2: Commit**

```bash
git add client/src/utils/statementRecorder.ts
git commit -m "feat: add witness statement recorder with continuous speech-to-text"
```

---

### Task 10: Integrate All Modules into Voice Command Route

**Files:**
- Modify: `server/src/routes/voice.ts`

**Step 1: Major expansion of the voice command route**

Add the following to the existing voice.ts:

1. Import new modules at top:
```typescript
import { buildThreatContext, composeThreatBriefing } from '../utils/threatContext';
import { parseWithNLU, generateFollowUp, generateTacticalAssessment } from '../utils/voiceNLU';
import { checkProximityHazards, composeProximityNarrative, findNearestUnits, composeNearestUnitsNarrative } from '../utils/proximityAlerts';
import { acknowledgeWelfareCheck, recordOfficerActivity } from '../utils/officerWelfare';
import { startPursuit, endPursuit, isInPursuit } from '../utils/pursuitTracker';
import { generateShiftSummary } from '../utils/shiftBriefing';
```

2. Add new command patterns to `parseCommand()`:
```typescript
// Case queries
if (/\bstatus\s*(?:of\s*)?case\s*(\S+)/i.test(t)) return { action: 'case_status', params: { case_number: RegExp.$1 }, raw: transcript };
if (/\blink\s*(?:to\s*)?case\s*(\S+)/i.test(t)) return { action: 'link_case', params: { case_number: RegExp.$1 }, raw: transcript };
// Statement mode
if (/\bstart\s*statement/i.test(t)) return { action: 'start_statement', params: {}, raw: transcript };
if (/\bend\s*statement/i.test(t)) return { action: 'end_statement', params: {}, raw: transcript };
// Welfare response
if (/\b(code\s*4|all\s*clear)\b/i.test(t)) return { action: 'code_4', params: {}, raw: transcript };
// End pursuit
if (/\bend\s*pursuit/i.test(t)) return { action: 'end_pursuit', params: {}, raw: transcript };
// Shift briefing
if (/\bshift\s*(summary|briefing|handoff)/i.test(t)) return { action: 'shift_briefing', params: {}, raw: transcript };
// Nearest units
if (/\bnearest\s*units?\b/i.test(t)) return { action: 'nearest_units', params: {}, raw: transcript };
// Threat check
if (/\bthreat\s*(check|assessment|briefing)/i.test(t)) return { action: 'threat_check', params: {}, raw: transcript };
```

3. Add new executors in `executeCommand()`:
```typescript
case 'code_4': {
  const msg = acknowledgeWelfareCheck(userId);
  recordOfficerActivity(userId);
  return { success: true, response: msg || 'Copy, code 4.' };
}

case 'end_pursuit': {
  const unit = getUserUnit(userId);
  if (!unit) return { success: false, response: 'No active unit found.' };
  const msg = endPursuit(unit.call_sign);
  return { success: true, response: msg };
}

case 'shift_briefing': {
  const summary = generateShiftSummary();
  return { success: true, response: summary.narrative };
}

case 'nearest_units': {
  const unit = getUserUnit(userId);
  const gps = unit ? getLatestGps(unit.call_sign) : null;
  if (!gps) return { success: false, response: 'GPS location not available.' };
  const nearest = findNearestUnits(gps.lat, gps.lng, 5);
  return { success: true, response: composeNearestUnitsNarrative(nearest) };
}

case 'threat_check': {
  const unit = getUserUnit(userId);
  if (!unit) return { success: false, response: 'No active unit found.' };
  // Get the unit's current call
  const currentCall = db.prepare(
    `SELECT c.id, c.location_address, c.latitude, c.longitude
     FROM calls_for_service c
     JOIN dispatch_units u ON u.current_call_id = c.id
     WHERE u.id = ?`
  ).get(unit.id) as any;

  if (!currentCall) return { success: true, response: 'No active call to assess.' };
  const ctx = buildThreatContext({
    locationAddress: currentCall.location_address,
    latitude: currentCall.latitude,
    longitude: currentCall.longitude,
    callId: currentCall.id,
  });
  const briefing = composeThreatBriefing(ctx);
  return { success: true, response: briefing || 'No threat indicators detected at this location.' };
}
```

4. Add NLU fallback when `parseCommand()` returns null:

In both `/command` and `/parse` routes, after `parseCommand` returns null:
```typescript
// Regex failed — try AI NLU
const nluResult = await parseWithNLU(transcript);
if (nluResult && nluResult.action !== 'unknown' && nluResult.confidence >= 0.6) {
  const command: ParsedCommand = {
    action: nluResult.action,
    params: nluResult.params as Record<string, string>,
    raw: transcript,
  };
  const result = await executeCommand(command, req);
  auditLog(req, 'VOICE_COMMAND_NLU' as any, 'voice' as any, '',
    JSON.stringify({ transcript, nlu: nluResult, result: result.response }));
  res.json({ success: result.success, transcript, action: nluResult.action, response: result.response, nlu: true });
  return;
}
```

5. Add new endpoint for statement saving:
```typescript
// POST /api/voice/statement — save witness statement transcript
router.post('/statement', async (req: Request, res: Response) => {
  try {
    const { callId, transcript, isFinal } = req.body;
    if (!callId || !transcript) {
      res.status(400).json({ error: 'callId and transcript required' });
      return;
    }

    const db = getDb();
    const timestamp = new Date().toISOString();
    const prefix = isFinal ? '\n\n[WITNESS STATEMENT - FINAL]' : '\n\n[WITNESS STATEMENT - IN PROGRESS]';

    // Append to call narrative
    db.prepare(`
      UPDATE calls_for_service
      SET description = COALESCE(description, '') || ?
      WHERE id = ?
    `).run(`${prefix} (${timestamp})\n${transcript}`, callId);

    auditLog(req, 'VOICE_STATEMENT' as any, 'call' as any, String(callId),
      `Statement ${isFinal ? 'finalized' : 'updated'}: ${transcript.slice(0, 100)}...`);

    res.json({ success: true });
  } catch (err: any) {
    console.error('[VOICE] Statement save error:', err?.message);
    res.status(500).json({ error: 'Failed to save statement' });
  }
});
```

6. Record activity on every command for welfare monitoring:
Add at the top of both route handlers, after rate limit check:
```typescript
recordOfficerActivity(userId);
```

**Step 2: Commit**

```bash
git add server/src/routes/voice.ts
git commit -m "feat: integrate NLU, threat context, welfare, pursuit, and shift briefing into voice commands"
```

---

### Task 11: Integrate Threat Context into Call Broadcasts

**Files:**
- Modify: `server/src/routes/dispatch/calls.ts` (or `aggregates.ts` where calls are created)

**Step 1: Add threat context to call creation broadcasts**

When `broadcastDispatchUpdate({ action: 'call_created', call: ... })` fires, include threat context:

```typescript
import { buildThreatContext } from '../../utils/threatContext';

// After call is created and before broadcast:
const threatCtx = buildThreatContext({
  locationAddress: call.location_address,
  latitude: call.latitude,
  longitude: call.longitude,
  callId: call.id,
});

broadcastDispatchUpdate({
  action: 'call_created',
  call: enrichedCall || call,
  threatContext: {
    threatLevel: threatCtx.threatLevel,
    briefingSummary: threatCtx.briefingSummary,
    premiseHistory: threatCtx.premiseHistory,
    activeWarrants: threatCtx.activeWarrants.length,
  },
});
```

Also add nearest unit suggestions:
```typescript
import { findNearestUnits } from '../../utils/proximityAlerts';

if (call.latitude && call.longitude) {
  const nearestUnits = findNearestUnits(call.latitude, call.longitude, 3);
  // Include in broadcast
}
```

**Step 2: Commit**

```bash
git add server/src/routes/dispatch/aggregates.ts
git commit -m "feat: broadcast threat context and nearest units with new call events"
```

---

### Task 12: Enhance Narrative Composer with Threat Context

**Files:**
- Modify: `client/src/utils/narrativeComposer.ts`

**Step 1: Add threat context to dispatch narratives**

Add a new parameter to `composeDispatchNarrative`:

```typescript
export function composeDispatchNarrative(
  call: CallData,
  detail?: NarrativeDetail,
  threatContext?: {
    threatLevel?: string;
    briefingSummary?: string;
    nearestUnits?: Array<{ callSign: string; distance: number; etaMinutes: number }>;
  },
): string {
```

After safety flags section, add threat briefing:
```typescript
// ── Threat context (if provided) ──
if (threatContext?.briefingSummary) {
  parts.push(threatContext.briefingSummary);
}

// ── Nearest units (full detail only) ──
if (level === 'full' && threatContext?.nearestUnits && threatContext.nearestUnits.length > 0) {
  const unitParts = threatContext.nearestUnits.slice(0, 3).map(u => {
    const dist = u.distance >= 1000
      ? `${(u.distance / 1000).toFixed(1)} kilometers`
      : `${u.distance} meters`;
    return `${u.callSign}, ${dist}, ${u.etaMinutes} minutes`;
  });
  parts.push(`Nearest units: ${unitParts.join('. ')}.`);
}
```

**Step 2: Commit**

```bash
git add client/src/utils/narrativeComposer.ts
git commit -m "feat: add threat context and nearest unit suggestions to dispatch narratives"
```

---

### Task 13: Enhance Voice Channel with Conversation State and Stress Analysis

**Files:**
- Modify: `client/src/utils/voiceChannel.ts`

**Step 1: Import new modules**

```typescript
import { createStressAnalyzer, type StressResult } from './stressAnalyzer';
import * as conversationMemory from './conversationMemory';
import { isRecording as isStatementRecording } from './statementRecorder';
```

**Step 2: Add stress analysis to the listening pipeline**

In the `startListening` method, after getting the MediaStream, create a stress analyzer:
```typescript
// Start stress analysis on the audio stream
if (this.stream) {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(this.stream);
  this.stressAnalyzer = createStressAnalyzer(ctx);
  this.stressAnalyzer.connectSource(source);
}
```

After processing a command (in `processTranscript`), check stress:
```typescript
const stress = this.stressAnalyzer?.getResult();
if (stress?.isStressed) {
  this.callbacks.onStressDetected?.(stress);
}
```

**Step 3: Add conversation memory integration**

Before processing a command, check for pending confirmation:
```typescript
const pending = conversationMemory.getPendingConfirmation();
if (pending) {
  if (conversationMemory.isConfirmation(transcript)) {
    // Execute the pending action
    conversationMemory.addEntry({ role: 'officer', text: transcript });
    // Send pending.confirmationAction + pending.confirmationParams to server
  } else if (conversationMemory.isDenial(transcript)) {
    conversationMemory.addEntry({ role: 'officer', text: transcript });
    conversationMemory.clearMemory();
    speak('Cancelled.');
    return;
  }
}
```

**Step 4: Add onStressDetected callback to VoiceChannelCallbacks**

```typescript
export interface VoiceChannelCallbacks {
  onStateChange: (state: VoiceChannelState) => void;
  onTranscript: (text: string, isFinal: boolean) => void;
  onCommandResult: (result: CommandResult) => void;
  onError: (error: string) => void;
  onStressDetected?: (result: StressResult) => void;
}
```

**Step 5: Commit**

```bash
git add client/src/utils/voiceChannel.ts
git commit -m "feat: add stress analysis and conversation memory to voice channel"
```

---

### Task 14: Enhance Voice Alerts Hook with New Event Types

**Files:**
- Modify: `client/src/hooks/useDispatchVoiceAlerts.ts`

**Step 1: Subscribe to new WebSocket events**

Add handlers for:
- `welfare_check` — voice prompts officer
- `welfare_alert` — supervisor notification
- `welfare_emergency` — all units broadcast
- `proximity_alert` — GPS danger alert
- `pursuit_update` — enhanced with nearest intercept unit
- `integration_health` — system offline warning

```typescript
// Welfare check prompt (direct to this officer)
unsubs.push(subscribe('welfare_check', (msg) => {
  const data = (msg.data || msg.payload || msg) as any;
  const text = data.message || `Status check. Are you code 4?`;
  if (options?.voiceAlert) {
    options.voiceAlert(text, 'moderate');
  } else {
    announceWithSeverity(text, 'moderate');
  }
}));

// Welfare emergency (all units)
unsubs.push(subscribe('welfare_emergency', (msg) => {
  const data = (msg.data || msg.payload || msg) as any;
  const text = data.message || 'Welfare emergency. All units respond.';
  if (options?.voiceAlert) {
    options.voiceAlert(text, 'major');
  } else {
    announceWithSeverity(text, 'major');
  }
}));
```

**Step 2: Update call_created handler to include threat context**

```typescript
if (action === 'call_created' && data.call) {
  const call = normalizeCallForVoice(data.call);
  const { severity } = classifySeverity('call_created', call);

  // Include threat context in narrative
  const threatContext = data.threatContext || null;
  const text = composeDispatchNarrative(call, undefined, threatContext);

  if (options?.voiceAlert) {
    options.voiceAlert(text, severity);
  } else {
    announceWithSeverity(text, severity);
  }
}
```

**Step 3: Commit**

```bash
git add client/src/hooks/useDispatchVoiceAlerts.ts
git commit -m "feat: add welfare, proximity, and threat context event handlers to voice alerts"
```

---

### Task 15: Start Welfare and Pursuit Timers on Server

**Files:**
- Modify: `server/src/index.ts`

**Step 1: Add periodic timers for welfare checks and pursuit updates**

```typescript
import { checkWelfareWatches } from './utils/officerWelfare';
import { generatePursuitUpdates } from './utils/pursuitTracker';

// After server starts listening:

// Welfare check timer — every 30 seconds
setInterval(() => {
  try {
    const alerts = checkWelfareWatches();
    // Alerts are already broadcast by the welfare module
  } catch (err: any) {
    console.error('[WELFARE] Check error:', err?.message);
  }
}, 30_000);

// Pursuit update timer — every 30 seconds
setInterval(() => {
  try {
    const updates = generatePursuitUpdates();
    // Updates are already broadcast by the pursuit module
  } catch (err: any) {
    console.error('[PURSUIT] Update error:', err?.message);
  }
}, 30_000);
```

**Step 2: Hook welfare monitor into dispatch status changes**

In `server/src/routes/dispatch/callActions.ts`, when a unit goes "on_scene" at a P1/P2 call:
```typescript
import { startWelfareWatch, clearWelfareWatch } from '../../utils/officerWelfare';

// When status changes to on_scene:
if (status === 'on_scene' && call.priority) {
  startWelfareWatch(req.user!.userId, unit.call_sign, call.id, call.call_number, call.priority);
}

// When status changes to available/cleared:
if (['available', 'cleared', 'off_duty'].includes(status)) {
  clearWelfareWatch(req.user!.userId);
}
```

**Step 3: Commit**

```bash
git add server/src/index.ts server/src/routes/dispatch/callActions.ts
git commit -m "feat: start welfare monitor and pursuit tracker timers on server startup"
```

---

### Task 16: Enhance VoiceChannelIndicator with New States

**Files:**
- Modify: `client/src/components/VoiceChannelIndicator.tsx`

**Step 1: Add statement recording indicator and stress warning**

- When statement recording is active: show a red recording dot + "RECORDING STATEMENT" badge
- When stress detected: flash orange "STRESS DETECTED" badge briefly
- Show conversation context (pending confirmation prompts)

**Step 2: Commit**

```bash
git add client/src/components/VoiceChannelIndicator.tsx
git commit -m "feat: add statement recording and stress detection indicators to voice channel UI"
```

---

### Task 17: Voice Channel Settings Expansion

**Files:**
- Modify: `client/src/components/MenuBar.tsx`

**Step 1: Add new settings**

Add to the Voice Channel submenu:
- **Stress Detection** toggle (on/off)
- **Welfare Checks** toggle (on/off) — auto-prompt when on scene too long
- **Proximity Alerts** toggle (on/off) — GPS danger warnings
- **Tactical Assessments** toggle (on/off) — AI tactical recommendations for major calls
- **Auto Nearest Units** toggle (on/off) — announce nearest units on new calls

New localStorage keys: `rmpg-voice-stress-detection`, `rmpg-voice-welfare-checks`, `rmpg-voice-proximity-alerts`, `rmpg-voice-tactical-assessments`, `rmpg-voice-nearest-units`

**Step 2: Commit**

```bash
git add client/src/components/MenuBar.tsx
git commit -m "feat: add advanced voice channel settings (stress, welfare, proximity, tactical)"
```

---

### Task 18: Final Build Verification

**Step 1: Build client**

Run: `cd "/Users/rmpgutah/RMPG Flex/client" && npx vite build`
Expected: Build success

**Step 2: Typecheck**

Run: `cd "/Users/rmpgutah/RMPG Flex/client" && npx tsc --noEmit`
Expected: No new errors

**Step 3: Server tests**

Run: `cd "/Users/rmpgutah/RMPG Flex/server" && npx vitest run`
Expected: All tests pass

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "feat: advanced voice dispatch system — complete implementation"
```
