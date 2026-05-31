// ============================================================
// RMPG Flex — Call Phase Tracker (Spillman Flex Standard)
// 10 search & intelligence features: call phase segmentation,
// timeline reconstruction, officer activity log, response
// pattern analysis, shift handoff notes, call overlap detection,
// frequency pattern recognition, multi-unit coordination tracking,
// call lifecycle metrics, and hot-spot temporal analysis.
// ============================================================

import { parseTimestamp } from './dateUtils';

/* ── FEATURE 31: Call Phase Segmentation ────────────────────
   Spillman Flex breaks every call into distinct phases:
   received, queued, dispatched, enroute, arrived, onscene,
   cleared, closed. Each phase has timestamps and duration. */
export interface CallPhase {
  name: string;
  startTime: Date | null;
  endTime: Date | null;
  durationSeconds: number;
  officerId: string | null;
  notes: string;
}

export const CALL_PHASES = ['received', 'queued', 'dispatched', 'enroute', 'arrived', 'onscene', 'cleared', 'closed'] as const;
export type CallPhaseName = (typeof CALL_PHASES)[number];

export function segmentCallPhases(
  createdAt: string,
  dispatchedAt: string | null,
  enrouteAt: string | null,
  onsceneAt: string | null,
  clearedAt: string | null,
  closedAt: string | null,
  assignedUnits: Array<{ id: string; callSign: string; dispatchedAt: string | null; enrouteAt: string | null; onsceneAt: string | null }>
): CallPhase[] {
  const phases: CallPhase[] = [];
  const now = new Date();

  const addPhase = (name: string, start: string | null, end: string | null, officerId: string | null = null) => {
    const startDate = start ? parseTimestamp(start) : null;
    const endDate = end ? parseTimestamp(end) : (name === 'closed' || name === 'cleared' ? null : now);
    const duration = startDate && endDate ? Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / 1000)) : 0;
    phases.push({ name, startTime: startDate, endTime: endDate || null, durationSeconds: duration, officerId, notes: '' });
  };

  addPhase('received', createdAt, dispatchedAt);
  addPhase('dispatched', dispatchedAt, enrouteAt);

  if (enrouteAt) addPhase('enroute', enrouteAt, onsceneAt);
  if (onsceneAt) addPhase('onscene', onsceneAt, clearedAt);
  if (clearedAt) addPhase('cleared', clearedAt, closedAt);
  if (closedAt) addPhase('closed', closedAt, null);

  if (phases.length === 0) {
    addPhase('received', createdAt, null);
  }

  return phases;
}

/* ── FEATURE 32: Call Timeline Reconstruction ──────────────────
   Spillman Flex reconstructs the complete timeline of a call
   including all unit activities, notes, and status changes. */
export interface TimelineEvent {
  timestamp: Date;
  type: 'status_change' | 'unit_assigned' | 'unit_arrived' | 'unit_cleared' | 'note_added' | 'narrative_updated' | 'priority_changed' | 'disposition_set';
  description: string;
  actor: string | null;
  details: Record<string, any>;
}

export function buildCallTimeline(
  callData: {
    createdAt: string;
    dispatchedAt: string | null;
    enrouteAt: string | null;
    onsceneAt: string | null;
    clearedAt: string | null;
    closedAt: string | null;
    priority: string;
    statusChanges: Array<{ timestamp: string; oldStatus: string; newStatus: string; changedBy: string }>;
    notes: Array<{ timestamp: string; content: string; author: string }>;
    unitAssignments: Array<{ unitId: string; callSign: string; assignedAt: string; clearedAt: string | null }>;
  }
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const ts = (s: string | null) => s ? parseTimestamp(s) : null;

  events.push({ timestamp: ts(callData.createdAt)!, type: 'status_change', description: 'Call received', actor: null, details: { priority: callData.priority } });

  if (callData.dispatchedAt) events.push({ timestamp: ts(callData.dispatchedAt)!, type: 'status_change', description: 'Call dispatched', actor: null, details: {} });
  if (callData.enrouteAt) events.push({ timestamp: ts(callData.enrouteAt)!, type: 'status_change', description: 'Unit en route', actor: null, details: {} });
  if (callData.onsceneAt) events.push({ timestamp: ts(callData.onsceneAt)!, type: 'status_change', description: 'Unit on scene', actor: null, details: {} });

  for (const sc of callData.statusChanges) {
    events.push({ timestamp: ts(sc.timestamp)!, type: 'status_change', description: `${sc.oldStatus} → ${sc.newStatus}`, actor: sc.changedBy, details: { oldStatus: sc.oldStatus, newStatus: sc.newStatus } });
  }

  for (const note of callData.notes) {
    events.push({ timestamp: ts(note.timestamp)!, type: 'note_added', description: note.content.slice(0, 80) + (note.content.length > 80 ? '...' : ''), actor: note.author, details: { fullContent: note.content } });
  }

  for (const ua of callData.unitAssignments) {
    events.push({ timestamp: ts(ua.assignedAt)!, type: 'unit_assigned', description: `${ua.callSign} assigned`, actor: null, details: { unitId: ua.unitId, callSign: ua.callSign } });
  }

  if (callData.clearedAt) events.push({ timestamp: ts(callData.clearedAt)!, type: 'status_change', description: 'Call cleared', actor: null, details: {} });
  if (callData.closedAt) events.push({ timestamp: ts(callData.closedAt)!, type: 'status_change', description: 'Call closed', actor: null, details: {} });

  return events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

/* ── FEATURE 33: Officer Activity Log ────────────────────────
   Spillman Flex generates a per-officer activity log from
   call data showing all actions during a shift. */
export interface OfficerActivity {
  timestamp: Date;
  callId: string;
  callNumber: string;
  action: 'assigned' | 'enroute' | 'onscene' | 'cleared' | 'note' | 'status_change';
  durationMinutes: number;
  location: string | null;
}

export function buildOfficerActivityLog(
  officerId: string,
  calls: Array<{
    id: string;
    callNumber: string;
    location: string | null;
    assignedAt: string | null;
    enrouteAt: string | null;
    onsceneAt: string | null;
    clearedAt: string | null;
    notes: Array<{ timestamp: string; author: string }>;
  }>
): OfficerActivity[] {
  const activities: OfficerActivity[] = [];

  for (const call of calls) {
    if (call.assignedAt) activities.push({ timestamp: parseTimestamp(call.assignedAt), callId: call.id, callNumber: call.callNumber, action: 'assigned', durationMinutes: 0, location: call.location });
    if (call.enrouteAt) activities.push({ timestamp: parseTimestamp(call.enrouteAt), callId: call.id, callNumber: call.callNumber, action: 'enroute', durationMinutes: 0, location: call.location });
    if (call.onsceneAt) activities.push({ timestamp: parseTimestamp(call.onsceneAt), callId: call.id, callNumber: call.callNumber, action: 'onscene', durationMinutes: 0, location: call.location });
    if (call.clearedAt) activities.push({ timestamp: parseTimestamp(call.clearedAt), callId: call.id, callNumber: call.callNumber, action: 'cleared', durationMinutes: 0, location: call.location });

    for (const note of call.notes) {
      if (note.author === officerId) {
        activities.push({ timestamp: parseTimestamp(note.timestamp), callId: call.id, callNumber: call.callNumber, action: 'note', durationMinutes: 0, location: call.location });
      }
    }
  }

  return activities.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

/* ── FEATURE 34: Response Pattern Analysis ──────────────────
   Spillman Flex analyzes historical response times by zone,
   time of day, and call type to identify patterns. */
export interface ResponsePattern {
  zone: string;
  hourOfDay: number;
  avgResponseMinutes: number;
  sampleSize: number;
  trend: 'improving' | 'stable' | 'worsening';
}

export function analyzeResponsePatterns(
  calls: Array<{ zone: string; createdAt: string; onsceneAt: string | null }>
): ResponsePattern[] {
  const byZoneHour = new Map<string, { totalMinutes: number; count: number }>();

  for (const call of calls) {
    if (!call.onsceneAt) continue;
    const created = parseTimestamp(call.createdAt);
    const onscene = parseTimestamp(call.onsceneAt);
    const minutes = (onscene.getTime() - created.getTime()) / 60000;
    const hour = created.getHours();
    const key = `${call.zone}::${hour}`;

    const existing = byZoneHour.get(key) || { totalMinutes: 0, count: 0 };
    existing.totalMinutes += minutes;
    existing.count++;
    byZoneHour.set(key, existing);
  }

  return Array.from(byZoneHour.entries()).map(([key, val]) => {
    const [zone, hourStr] = key.split('::');
    return {
      zone,
      hourOfDay: parseInt(hourStr),
      avgResponseMinutes: Math.round((val.totalMinutes / val.count) * 10) / 10,
      sampleSize: val.count,
      trend: 'stable',
    };
  });
}

/* ── FEATURE 35: Shift Handoff Notes Generator ──────────────
   Spillman Flex generates a shift handoff briefing that
   summarizes all active calls, pending tasks, and officer
   status at shift change. */
export interface ShiftHandoff {
  shiftName: string;
  outgoingSupervisor: string;
  incomingSupervisor: string;
  timestamp: Date;
  activeCalls: Array<{ callNumber: string; priority: string; status: string; location: string; summary: string }>;
  pendingTasks: string[];
  officerStatuses: Array<{ callSign: string; status: string; currentCall: string | null }>;
  criticalInfo: string[];
  equipmentIssues: string[];
}

export function generateShiftHandoff(
  activeCalls: Array<{ call_number?: string; callNumber?: string; priority: string; status: string; location?: string; address?: string; narrative?: string; description?: string }>,
  officers: Array<{ call_sign?: string; callSign?: string; status: string; current_call_id?: string; currentCallId?: string }>,
  pendingTasks: string[],
  criticalInfo: string[],
  equipmentIssues: string[],
  shiftName: string,
  outgoingSupervisor: string,
  incomingSupervisor: string
): ShiftHandoff {
  return {
    shiftName,
    outgoingSupervisor,
    incomingSupervisor,
    timestamp: new Date(),
    activeCalls: activeCalls.map(c => ({
      callNumber: (c as any).call_number || (c as any).callNumber || 'N/A',
      priority: c.priority,
      status: c.status,
      location: (c as any).location || (c as any).address || 'Unknown',
      summary: ((c as any).narrative || (c as any).description || '').slice(0, 100),
    })),
    pendingTasks,
    officerStatuses: officers.map(o => ({
      callSign: (o as any).call_sign || (o as any).callSign || 'N/A',
      status: o.status,
      currentCall: ((o as any).current_call_id || (o as any).currentCallId) || null,
    })),
    criticalInfo,
    equipmentIssues,
  };
}

/* ── FEATURE 36: Call Overlap Detection ─────────────────────
   Spillman Flex detects when multiple calls may be related
   (same location, same time window, similar description). */
export interface CallOverlap {
  callA: string;
  callB: string;
  overlapType: 'same_location' | 'close_proximity' | 'same_time' | 'similar_description' | 'same_caller';
  confidence: number;  // 0-100
  recommendation: string;
}

export function detectCallOverlaps(
  calls: Array<{ id: string; callNumber: string; latitude: number | null; longitude: number | null; createdAt: string; clearedAt: string | null; description: string; callerPhone: string | null }>
): CallOverlap[] {
  const overlaps: CallOverlap[] = [];

  for (let i = 0; i < calls.length; i++) {
    for (let j = i + 1; j < calls.length; j++) {
      const a = calls[i];
      const b = calls[j];

      // Same location check
      if (a.latitude && b.latitude && a.longitude && b.longitude) {
        const dist = haversineMiles(a.latitude, a.longitude, b.latitude, b.longitude);
        if (dist < 0.1) {
          overlaps.push({ callA: a.callNumber, callB: b.callNumber, overlapType: 'same_location', confidence: 95, recommendation: 'These calls are at the same location — consider merging.' });
        } else if (dist < 0.5) {
          overlaps.push({ callA: a.callNumber, callB: b.callNumber, overlapType: 'close_proximity', confidence: 60, recommendation: 'These calls are within 0.5 miles — check if related.' });
        }
      }

      // Same time window
      const aTime = parseTimestamp(a.createdAt).getTime();
      const bTime = parseTimestamp(b.createdAt).getTime();
      if (Math.abs(aTime - bTime) < 300000) { // 5 minutes
        overlaps.push({ callA: a.callNumber, callB: b.callNumber, overlapType: 'same_time', confidence: 40, recommendation: 'Calls came in within 5 minutes — possible duplicate.' });
      }

      // Same caller
      if (a.callerPhone && b.callerPhone && a.callerPhone === b.callerPhone) {
        overlaps.push({ callA: a.callNumber, callB: b.callNumber, overlapType: 'same_caller', confidence: 85, recommendation: 'Same caller reported both — likely related.' });
      }

      // Similar description
      const aWords = new Set(a.description.toLowerCase().split(/\s+/));
      const bWords = new Set(b.description.toLowerCase().split(/\s+/));
      const intersection = [...aWords].filter(w => bWords.has(w) && w.length > 3);
      if (intersection.length >= 3) {
        overlaps.push({ callA: a.callNumber, callB: b.callNumber, overlapType: 'similar_description', confidence: Math.min(80, intersection.length * 20), recommendation: 'Similar keywords in call descriptions — may be related.' });
      }
    }
  }

  return overlaps;
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── FEATURE 37: Call Frequency Pattern Recognition ─────────
   Spillman Flex identifies temporal patterns in call volume
   to optimize shift scheduling and zone allocation. */
export interface CallFrequencyPattern {
  hourOfDay: number;
  dayOfWeek: number;
  avgCallVolume: number;
  peakPeriod: boolean;
  zone: string;
}

export function analyzeCallFrequency(
  calls: Array<{ createdAt: string; zone: string }>,
  lookbackDays: number = 30
): CallFrequencyPattern[] {
  const byZoneDayHour = new Map<string, { count: number; days: Set<string> }>();
  const cutoff = Date.now() - lookbackDays * 86400000;

  for (const call of calls) {
    const ts = parseTimestamp(call.createdAt);
    if (ts.getTime() < cutoff) continue;
    const hour = ts.getHours();
    const day = ts.getDay();
    const dateKey = ts.toISOString().slice(0, 10);
    const key = `${call.zone}::${day}::${hour}`;

    const existing = byZoneDayHour.get(key) || { count: 0, days: new Set() };
    existing.count++;
    existing.days.add(dateKey);
    byZoneDayHour.set(key, existing);
  }

  return Array.from(byZoneDayHour.entries()).map(([key, val]) => {
    const [zone, dayStr, hourStr] = key.split('::');
    const hour = parseInt(hourStr);
    return {
      hourOfDay: hour,
      dayOfWeek: parseInt(dayStr),
      avgCallVolume: Math.round((val.count / Math.max(1, val.days.size)) * 10) / 10,
      peakPeriod: hour >= 14 && hour <= 22,
      zone,
    };
  });
}

/* ── FEATURE 38: Multi-Unit Coordination Tracker ────────────
   Spillman Flex tracks which units are coordinating on the
   same call and flags potential communication gaps. */
export interface UnitCoordination {
  callId: string;
  callNumber: string;
  units: Array<{ callSign: string; role: 'primary' | 'backup' | 'cover' | 'supervisor'; assignedAt: Date }>;
  totalUnits: number;
  hasSupervisor: boolean;
  communicationPlan: string | null;
}

export function trackUnitCoordination(
  callAssignments: Array<{
    callId: string;
    callNumber: string;
    unitCallSign: string;
    role: string;
    assignedAt: string;
    isSupervisor: boolean;
  }>
): UnitCoordination[] {
  const byCall = new Map<string, UnitCoordination>();

  for (const assignment of callAssignments) {
    if (!byCall.has(assignment.callId)) {
      byCall.set(assignment.callId, {
        callId: assignment.callId,
        callNumber: assignment.callNumber,
        units: [],
        totalUnits: 0,
        hasSupervisor: false,
        communicationPlan: null,
      });
    }

    const coord = byCall.get(assignment.callId)!;
    coord.units.push({
      callSign: assignment.unitCallSign,
      role: assignment.role as any,
      assignedAt: parseTimestamp(assignment.assignedAt),
    });
    if (assignment.isSupervisor) coord.hasSupervisor = true;
    coord.totalUnits = coord.units.length;

    // Auto-generate communication plan based on unit count
    if (coord.totalUnits >= 4 && !coord.hasSupervisor) {
      coord.communicationPlan = 'WARNING: 4+ units on scene without supervisor — designate incident commander';
    } else if (coord.totalUnits >= 3) {
      coord.communicationPlan = 'Designate primary channel. All units use designated tactical frequency.';
    }
  }

  return Array.from(byCall.values());
}

/* ── FEATURE 39: Call Lifecycle Metrics ────────────────────
   Spillman Flex calculates comprehensive lifecycle metrics
   for every call including total handling time, officer time,
   and administrative processing time. */
export interface CallLifecycleMetrics {
  callNumber: string;
  totalLifespanMinutes: number;
  dispatchResponseMinutes: number;
  travelMinutes: number;
  sceneMinutes: number;
  adminMinutes: number;
  officerTotalMinutes: number;
  unitCount: number;
  noteCount: number;
  dispositionCode: string | null;
  score: number; // 0-100 efficiency score
}

export function calculateCallLifecycle(
  call: {
    callNumber: string;
    createdAt: string;
    dispatchedAt: string | null;
    enrouteAt: string | null;
    onsceneAt: string | null;
    clearedAt: string | null;
    closedAt: string | null;
    unitCount: number;
    noteCount: number;
    disposition: string | null;
  }
): CallLifecycleMetrics {
  const created = parseTimestamp(call.createdAt);
  const end = call.closedAt ? parseTimestamp(call.closedAt) : new Date();
  const mins = (a: Date | null, b: Date | null) => a && b ? Math.round((b.getTime() - a.getTime()) / 60000) : 0;

  const lifecycle = {
    callNumber: call.callNumber,
    totalLifespanMinutes: mins(created, end),
    dispatchResponseMinutes: mins(created, call.dispatchedAt ? parseTimestamp(call.dispatchedAt) : null),
    travelMinutes: mins(call.dispatchedAt ? parseTimestamp(call.dispatchedAt) : null, call.onsceneAt ? parseTimestamp(call.onsceneAt) : null),
    sceneMinutes: mins(call.onsceneAt ? parseTimestamp(call.onsceneAt) : null, call.clearedAt ? parseTimestamp(call.clearedAt) : null),
    adminMinutes: mins(call.clearedAt ? parseTimestamp(call.clearedAt) : null, call.closedAt ? parseTimestamp(call.closedAt) : null),
    officerTotalMinutes: mins(call.dispatchedAt ? parseTimestamp(call.dispatchedAt) : null, call.clearedAt ? parseTimestamp(call.clearedAt) : null),
    unitCount: call.unitCount,
    noteCount: call.noteCount,
    dispositionCode: call.disposition,
    score: 0,
  };

  // Efficiency score: lower is better (faster response, fewer units)
  const dispatchScore = Math.max(0, 100 - lifecycle.dispatchResponseMinutes * 5);
  const sceneScore = Math.max(0, 100 - (lifecycle.sceneMinutes / 2));
  const unitEfficiency = Math.max(0, 100 - (lifecycle.unitCount - 1) * 15);
  lifecycle.score = Math.round((dispatchScore + sceneScore + unitEfficiency) / 3);

  return lifecycle;
}

/* ── FEATURE 40: Hot-Spot Temporal Analysis ────────────────
   Spillman Flex identifies temporal hot-spots where calls
   cluster during specific time windows. */
export interface TemporalHotspot {
  zone: string;
  latitude: number;
  longitude: number;
  hourStart: number;
  hourEnd: number;
  daysOfWeek: number[];
  callCount: number;
  intensity: 'low' | 'medium' | 'high' | 'extreme';
  crimeTypes: string[];
}

export function identifyTemporalHotspots(
  calls: Array<{ latitude: number; longitude: number; createdAt: string; zone: string; natureCode: string }>,
  clusterRadiusMiles: number = 0.5
): TemporalHotspot[] {
  const hotspots: TemporalHotspot[] = [];
  const groups: Array<typeof calls> = [];

  // Simple grid-based clustering
  const cellSize = clusterRadiusMiles;
  const grid = new Map<string, typeof calls>();

  for (const call of calls) {
    const latCell = Math.round(call.latitude / cellSize) * cellSize;
    const lngCell = Math.round(call.longitude / cellSize) * cellSize;
    const key = `${latCell.toFixed(4)},${lngCell.toFixed(4)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(call);
  }

  for (const [key, clusterCalls] of grid.entries()) {
    if (clusterCalls.length < 3) continue;

    const hours = clusterCalls.map(c => parseTimestamp(c.createdAt).getHours());
    const hourStart = Math.min(...hours);
    const hourEnd = Math.max(...hours);

    const days = [...new Set(clusterCalls.map(c => parseTimestamp(c.createdAt).getDay()))];
    const crimeTypes = [...new Set(clusterCalls.map(c => c.natureCode))];
    const avgLat = clusterCalls.reduce((s, c) => s + c.latitude, 0) / clusterCalls.length;
    const avgLng = clusterCalls.reduce((s, c) => s + c.longitude, 0) / clusterCalls.length;

    let intensity: TemporalHotspot['intensity'] = 'low';
    if (clusterCalls.length >= 12) intensity = 'extreme';
    else if (clusterCalls.length >= 8) intensity = 'high';
    else if (clusterCalls.length >= 5) intensity = 'medium';

    hotspots.push({
      zone: clusterCalls[0].zone,
      latitude: avgLat,
      longitude: avgLng,
      hourStart,
      hourEnd,
      daysOfWeek: days.sort(),
      callCount: clusterCalls.length,
      intensity,
      crimeTypes,
    });
  }

  return hotspots.sort((a, b) => b.callCount - a.callCount);
}
