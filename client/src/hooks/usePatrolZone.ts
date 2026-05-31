// ============================================================
// RMPG Flex — Patrol Zone Management Hook (Spillman Flex Standard)
// 10 tools & utilities features: patrol zone allocation, beat
// rotation scheduling, checkpoint randomization, patrol coverage
// gap analysis, directed patrol assignment, special event zone
// planning, crime pattern zone overlay, proactive patrol
// recommendations, zone coverage scoring, and relief factor
// calculation.
// ============================================================

import { useState, useCallback, useMemo } from 'react';
import { apiFetch } from './useApi';

/* ── FEATURE 81: Patrol Zone Allocation ─────────────────────
   Spillman Flex intelligently allocates officers to patrol
   zones based on call volume, officer availability, and
   historical crime patterns. */
export interface ZoneAllocation {
  zone: string;
  beat: string;
  requiredOfficers: number;
  assignedOfficers: number;
  deficit: number;
  callVolume: number;
  riskLevel: 'low' | 'moderate' | 'high' | 'critical';
  recommendedUnits: Array<{ callSign: string; status: string; proximityScore: number }>;
}

export function usePatrolZoneAllocation() {
  const [allocations, setAllocations] = useState<ZoneAllocation[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiFetch<ZoneAllocation[]>('/dispatch/geography/zone-allocation');
      if (result) setAllocations(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const criticalZones = useMemo(() => allocations.filter(z => z.riskLevel === 'critical' || z.riskLevel === 'high'), [allocations]);
  const totalDeficit = useMemo(() => allocations.reduce((sum, z) => sum + Math.max(0, z.deficit), 0), [allocations]);

  return { allocations, loading, load, criticalZones, totalDeficit };
}

/* ── FEATURE 82: Beat Rotation Scheduling ───────────────────
   Spillman Flex schedules beat rotations to prevent officer
   fatigue and ensure fresh coverage of high-crime areas. */
export interface BeatRotation {
  officerId: string;
  officerCallSign: string;
  currentBeat: string;
  suggestedBeat: string;
  reason: string;
  hoursOnCurrentBeat: number;
  rotationDue: boolean;
}

export function suggestBeatRotations(
  officerAssignments: Array<{ officerId: string; callSign: string; currentBeat: string; hoursOnBeat: number }>,
  beatDemand: Record<string, number>,
  maxHoursPerBeat: number = 4
): BeatRotation[] {
  return officerAssignments
    .filter(o => o.hoursOnBeat >= maxHoursPerBeat)
    .map(o => {
      const alternatives = Object.entries(beatDemand)
        .filter(([beat]) => beat !== o.currentBeat)
        .sort(([, a], [, b]) => b - a);

      const suggestedBeat = alternatives.length > 0 ? alternatives[0][0] : o.currentBeat;

      return {
        officerId: o.officerId,
        officerCallSign: o.callSign,
        currentBeat: o.currentBeat,
        suggestedBeat,
        reason: `Exceeded ${maxHoursPerBeat}h beat maximum. ${alternatives.length > 0 ? `Suggested rotation to ${suggestedBeat}.` : 'No alternative beats available.'}`,
        hoursOnCurrentBeat: o.hoursOnBeat,
        rotationDue: true,
      };
    });
}

/* ── FEATURE 83: Checkpoint Randomization ───────────────────
   Spillman Flex generates randomized checkpoint locations
   within a patrol zone to avoid predictable patterns. */
export interface CheckpointPlan {
  zone: string;
  shiftDate: string;
  locations: Array<{ name: string; latitude: number; longitude: number; timeWindow: string; duration: number; reason: string }>;
  totalCheckpoints: number;
  totalDuration: number;
}

export function generateCheckpointPlan(
  zone: string,
  shiftDate: string,
  possibleLocations: Array<{ name: string; latitude: number; longitude: number }>,
  count: number,
  shiftHours: number
): CheckpointPlan {
  const shuffled = [...possibleLocations].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(count, shuffled.length));
  const durationPerCheckpoint = Math.floor((shiftHours * 60) / selected.length);

  const reasons = ['High-traffic area', 'Recent incidents', 'Community engagement', 'DUI enforcement', 'Speed enforcement', 'Visibility patrol', 'Directed patrol'];

  return {
    zone,
    shiftDate,
    locations: selected.map((loc, i) => ({
      ...loc,
      timeWindow: `${String(i * durationPerCheckpoint).padStart(2, '0')}:00 - ${String((i + 1) * durationPerCheckpoint).padStart(2, '0')}:00`,
      duration: durationPerCheckpoint,
      reason: reasons[i % reasons.length],
    })),
    totalCheckpoints: selected.length,
    totalDuration: selected.length * durationPerCheckpoint,
  };
}

/* ── FEATURE 84: Patrol Coverage Gap Analysis ──────────────
   Spillman Flex identifies gaps in patrol coverage where
   response times exceed standards or no units are available. */
export interface CoverageGap {
  zone: string;
  timeWindow: string;
  gapType: 'no_coverage' | 'delayed_response' | 'understaffed';
  avgResponseTime: number;
  targetResponseTime: number;
  severity: 'warning' | 'critical';
  recommendation: string;
}

export function analyzeCoverageGaps(
  zones: Array<{ name: string; avgResponseTime: number; unitsAvailable: number; minUnitsRequired: number }>,
  targetResponseP1: number = 8,
  targetResponseP2: number = 15
): CoverageGap[] {
  const gaps: CoverageGap[] = [];

  for (const zone of zones) {
    if (zone.unitsAvailable === 0) {
      gaps.push({
        zone: zone.name,
        timeWindow: 'Current',
        gapType: 'no_coverage',
        avgResponseTime: zone.avgResponseTime,
        targetResponseTime: targetResponseP1,
        severity: 'critical',
        recommendation: `NO UNITS in ${zone.name}. Reallocate officers immediately or request mutual aid.`,
      });
    } else if (zone.unitsAvailable < zone.minUnitsRequired) {
      gaps.push({
        zone: zone.name,
        timeWindow: 'Current',
        gapType: 'understaffed',
        avgResponseTime: zone.avgResponseTime,
        targetResponseTime: targetResponseP1,
        severity: zone.unitsAvailable < zone.minUnitsRequired / 2 ? 'critical' : 'warning',
        recommendation: `${zone.name} has ${zone.unitsAvailable}/${zone.minUnitsRequired} required units. Consider reassigning from lower-demand zones.`,
      });
    } else if (zone.avgResponseTime > targetResponseP2) {
      gaps.push({
        zone: zone.name,
        timeWindow: 'Current',
        gapType: 'delayed_response',
        avgResponseTime: zone.avgResponseTime,
        targetResponseTime: targetResponseP1,
        severity: 'warning',
        recommendation: `Response time in ${zone.name} (${zone.avgResponseTime.toFixed(1)} min) exceeds ${targetResponseP2} min target. Add patrol saturation.`,
      });
    }
  }

  return gaps.sort((a, b) => (a.severity === 'critical' ? -1 : 1) - (b.severity === 'critical' ? -1 : 1));
}

/* ── FEATURE 85: Directed Patrol Assignment ────────────────
   Spillman Flex generates directed patrol assignments based
   on crime analysis hot spots and command priorities. */
export interface DirectedPatrol {
  id: string;
  zone: string;
  location: string;
  latitude: number;
  longitude: number;
  radius: number;
  reason: string;
  priority: string;
  assignedTo: string | null;
  startTime: string;
  endTime: string;
  instructions: string;
  completedAt: string | null;
}

export function useDirectedPatrol() {
  const [patrols, setPatrols] = useState<DirectedPatrol[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (zone?: string) => {
    setLoading(true);
    try {
      const params = zone ? `?zone=${zone}` : '';
      const result = await apiFetch<DirectedPatrol[]>(`/dispatch/geography/directed-patrols${params}`);
      if (result) setPatrols(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const assign = useCallback(async (patrolId: string, officerId: string) => {
    const result = await apiFetch<DirectedPatrol>(`/dispatch/geography/directed-patrols/${patrolId}/assign`, {
      method: 'POST', body: { officerId },
    });
    if (result) setPatrols(prev => prev.map(p => p.id === patrolId ? result : p));
    return result;
  }, []);

  const complete = useCallback(async (patrolId: string) => {
    const result = await apiFetch<DirectedPatrol>(`/dispatch/geography/directed-patrols/${patrolId}/complete`, { method: 'POST' });
    if (result) setPatrols(prev => prev.map(p => p.id === patrolId ? result : p));
    return result;
  }, []);

  const activePatrols = useMemo(() => patrols.filter(p => !p.completedAt), [patrols]);
  const unassignedPatrols = useMemo(() => patrols.filter(p => !p.assignedTo), [patrols]);

  return { patrols, loading, load, assign, complete, activePatrols, unassignedPatrols };
}

/* ── FEATURE 86: Special Event Zone Planning ────────────────
   Spillman Flex plans patrol coverage for special events
   with traffic control, crowd management, and security zones. */
export interface EventZonePlan {
  eventName: string;
  eventDate: string;
  zones: Array<{ name: string; type: 'perimeter' | 'crowd' | 'traffic' | 'parking' | 'command' | 'staging'; requiredUnits: number; assignedUnits: string[]; notes: string }>;
  totalUnitsRequired: number;
  totalUnitsAssigned: number;
  trafficControlPoints: Array<{ location: string; officers: number; direction: string }>;
  stagingAreas: Array<{ location: string; capacity: number; assignedUnits: string[] }>;
  commandPost: { location: string; commander: string; radioChannel: string };
  contingencyPlan: string;
}

export function generateEventPlan(
  eventName: string,
  eventDate: string,
  expectedAttendees: number,
  venueType: 'stadium' | 'park' | 'street_festival' | 'parade' | 'indoor' | 'other'
): EventZonePlan {
  const venueFactors = {
    stadium: { perimeter: 12, crowd: 20, traffic: 10, parking: 6, command: 3, staging: 4 },
    park: { perimeter: 8, crowd: 15, traffic: 6, parking: 4, command: 2, staging: 3 },
    street_festival: { perimeter: 15, crowd: 25, traffic: 12, parking: 8, command: 4, staging: 5 },
    parade: { perimeter: 20, crowd: 30, traffic: 15, parking: 6, command: 4, staging: 5 },
    indoor: { perimeter: 4, crowd: 10, traffic: 3, parking: 2, command: 2, staging: 2 },
    other: { perimeter: 6, crowd: 10, traffic: 5, parking: 3, command: 2, staging: 2 },
  };

  const factors = venueFactors[venueType];
  const attendeeMultiplier = Math.max(0.5, Math.min(3, expectedAttendees / 5000));

  const zones = [
    { name: 'Perimeter', type: 'perimeter' as const, requiredUnits: Math.round(factors.perimeter * attendeeMultiplier), assignedUnits: [], notes: 'Secure all entry/exit points' },
    { name: 'Crowd Control', type: 'crowd' as const, requiredUnits: Math.round(factors.crowd * attendeeMultiplier), assignedUnits: [], notes: 'Position inside venue for crowd management' },
    { name: 'Traffic', type: 'traffic' as const, requiredUnits: Math.round(factors.traffic * attendeeMultiplier), assignedUnits: [], notes: 'Direct traffic flow around venue' },
    { name: 'Parking', type: 'parking' as const, requiredUnits: Math.round(factors.parking * attendeeMultiplier), assignedUnits: [], notes: 'Manage parking areas' },
    { name: 'Command Post', type: 'command' as const, requiredUnits: Math.round(factors.command * attendeeMultiplier), assignedUnits: [], notes: 'Overall event command' },
    { name: 'Staging', type: 'staging' as const, requiredUnits: Math.round(factors.staging * attendeeMultiplier), assignedUnits: [], notes: 'Reserve units for contingencies' },
  ];

  return {
    eventName,
    eventDate,
    zones,
    totalUnitsRequired: zones.reduce((s, z) => s + z.requiredUnits, 0),
    totalUnitsAssigned: 0,
    trafficControlPoints: [],
    stagingAreas: [],
    commandPost: { location: 'TBD', commander: 'TBD', radioChannel: 'TAC-1' },
    contingencyPlan: 'Activate mutual aid if incident exceeds planned resources. Designate fallback command post. Coordinate with EMS and Fire on standby locations.',
  };
}

/* ── FEATURE 87: Crime Pattern Zone Overlay ────────────────
   Spillman Flex overlays crime pattern data onto patrol zones
   for visual hot-spot identification and resource allocation. */
export interface CrimePatternOverlay {
  zone: string;
  patternType: string;
  confidence: number;
  activePeriod: { startHour: number; endHour: number; days: number[] };
  geographicBounds: { north: number; south: number; east: number; west: number };
  affectedBeats: string[];
  recommendedResponse: string;
  casesLinked: number;
  lastIncident: string;
}

export function useCrimePatternOverlay(zone: string | null) {
  const [patterns, setPatterns] = useState<CrimePatternOverlay[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = zone ? `?zone=${zone}` : '';
      const result = await apiFetch<CrimePatternOverlay[]>(`/dispatch/geography/crime-patterns${params}`);
      if (result) setPatterns(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, [zone]);

  const activePatterns = useMemo(() => patterns.filter(p => new Date(p.lastIncident).getTime() > Date.now() - 7 * 86400000), [patterns]);

  return { patterns, loading, load, activePatterns };
}

/* ── FEATURE 88: Proactive Patrol Recommendation ───────────
   Spillman Flex recommends proactive patrol activities based
   on gap analysis, crime trends, and command directives. */
export interface ProactivePatrolRecommendation {
  id: string;
  zone: string;
  activity: 'traffic_enforcement' | 'business_checks' | 'park_walk' | 'community_engagement' | 'directed_patrol' | 'school_zone' | 'warrant_sweep' | 'vacation_watch';
  location: string;
  timeWindow: string;
  priority: string;
  reason: string;
  duration: number;
}

export function generateProactiveRecommendations(
  zoneActivity: { zone: string; recentCalls: number; topCrimeTypes: string[]; coverageGaps: number },
  timeOfDay: number
): ProactivePatrolRecommendation[] {
  const recommendations: ProactivePatrolRecommendation[] = [];
  let id = 1;

  if (timeOfDay >= 7 && timeOfDay <= 9) {
    recommendations.push({ id: `pr-${id++}`, zone: zoneActivity.zone, activity: 'school_zone', location: 'School zones', timeWindow: '07:00-09:00', priority: 'high', reason: 'Morning school zone enforcement', duration: 120 });
  }

  if (timeOfDay >= 14 && timeOfDay <= 18) {
    recommendations.push({ id: `pr-${id++}`, zone: zoneActivity.zone, activity: 'traffic_enforcement', location: 'High-traffic corridors', timeWindow: '14:00-18:00', priority: 'medium', reason: 'Afternoon traffic enforcement', duration: 240 });
  }

  if (zoneActivity.topCrimeTypes.includes('THEFT') || zoneActivity.topCrimeTypes.includes('BURGLARY')) {
    recommendations.push({ id: `pr-${id++}`, zone: zoneActivity.zone, activity: 'business_checks', location: 'Commercial areas', timeWindow: '23:00-05:00', priority: 'high', reason: 'Increased property crime — business security checks', duration: 360 });
  }

  if (zoneActivity.coverageGaps > 0) {
    recommendations.push({ id: `pr-${id++}`, zone: zoneActivity.zone, activity: 'directed_patrol', location: 'Gap areas', timeWindow: 'Flexible', priority: 'critical', reason: 'Coverage gap — directed patrol needed', duration: 120 });
  }

  recommendations.push({ id: `pr-${id++}`, zone: zoneActivity.zone, activity: 'community_engagement', location: 'Community centers', timeWindow: '10:00-16:00', priority: 'low', reason: 'Routine community engagement', duration: 60 });

  return recommendations;
}

/* ── FEATURE 89: Zone Coverage Scoring ──────────────────────
   Spillman Flex calculates a coverage score (0-100) for each
   zone based on response time, unit availability, and call load. */
export function scoreZoneCoverage(
  zone: {
    name: string;
    unitsAvailable: number;
    targetUnits: number;
    avgResponseTime: number;
    targetResponseTime: number;
    activeCalls: number;
    maxCallCapacity: number;
  }
): { score: number; grade: string; color: string; issues: string[] } {
  const issues: string[] = [];
  const unitScore = Math.min(100, (zone.unitsAvailable / zone.targetUnits) * 100);
  const responseScore = Math.min(100, (zone.targetResponseTime / Math.max(1, zone.avgResponseTime)) * 100);
  const loadScore = Math.max(0, 100 - (zone.activeCalls / Math.max(1, zone.maxCallCapacity)) * 100);

  if (zone.unitsAvailable < zone.targetUnits) issues.push(`Understaffed: ${zone.unitsAvailable}/${zone.targetUnits} units`);
  if (zone.avgResponseTime > zone.targetResponseTime) issues.push(`Slow response: ${zone.avgResponseTime.toFixed(1)} min vs ${zone.targetResponseTime} min target`);
  if (zone.activeCalls > zone.maxCallCapacity * 0.8) issues.push(`High call load: ${zone.activeCalls} active calls`);

  const score = Math.round((unitScore * 0.4 + responseScore * 0.4 + loadScore * 0.2));

  let grade: string;
  let color: string;
  if (score >= 80) { grade = 'A'; color = '#22c55e'; }
  else if (score >= 65) { grade = 'B'; color = '#84cc16'; }
  else if (score >= 50) { grade = 'C'; color = '#f59e0b'; }
  else if (score >= 35) { grade = 'D'; color = '#f97316'; }
  else { grade = 'F'; color = '#ef4444'; }

  return { score, grade, color, issues };
}

/* ── FEATURE 90: Relief Factor Calculation ──────────────────
   Spillman Flex calculates relief factors to ensure adequate
   break coverage without compromising zone response. */
export function calculateReliefFactor(
  onDutyOfficers: number,
  breakDurationMinutes: number,
  breakFrequencyHours: number,
  shiftLengthHours: number
): { reliefOfficersNeeded: number; coverageGapMinutes: number; staggeredBreakSchedule: Array<{ startMinute: number; officersOnBreak: number }> } {
  const totalBreakMinutes = (shiftLengthHours / breakFrequencyHours) * breakDurationMinutes;
  const breakPercentage = totalBreakMinutes / (shiftLengthHours * 60);
  const reliefOfficersNeeded = Math.ceil(onDutyOfficers * breakPercentage);

  const coverageGapMinutes = Math.max(0, totalBreakMinutes - (reliefOfficersNeeded * breakDurationMinutes));

  const schedule: Array<{ startMinute: number; officersOnBreak: number }> = [];
  const breaksPerShift = Math.floor(shiftLengthHours / breakFrequencyHours);
  const interval = (shiftLengthHours * 60) / (breaksPerShift * 2);
  const perBreak = Math.floor(onDutyOfficers / 2);

  for (let i = 0; i < breaksPerShift * 2; i++) {
    schedule.push({ startMinute: i * interval, officersOnBreak: perBreak });
  }

  return { reliefOfficersNeeded, coverageGapMinutes, staggeredBreakSchedule: schedule };
}
