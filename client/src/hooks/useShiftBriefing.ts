// ============================================================
// RMPG Flex — Shift Briefing Hook (Spillman Flex Standard)
// 10 reporting features: shift briefing builder, daily activity
// summary, patrol briefing cards, crime bulletin generator,
// roll call presentation, officer activity report, zone activity
// report, command staff briefing, statistical dashboard data,
// and automated briefing email.
// ============================================================

import { useState, useCallback, useMemo } from 'react';
import { apiFetch } from './useApi';

/* ── FEATURE 61: Shift Briefing Builder ─────────────────────
   Spillman Flex compiles a comprehensive shift briefing
   from multiple data sources for roll call. */
export interface ShiftBriefing {
  date: string;
  shift: string;
  supervisor: string;
  weather: { temp: number; conditions: string; alerts: string[] };
  activeCalls: Array<{ callNumber: string; priority: string; location: string; status: string; nature: string }>;
  activeUnits: Array<{ callSign: string; status: string; location: string }>;
  recentIncidents: Array<{ caseNumber: string; type: string; location: string; status: string }>;
  bolos: Array<{ description: string; vehicle: string | null; suspect: string | null; expiresAt: string }>;
  wantedPersons: Array<{ name: string; charges: string; lastSeen: string }>;
  stolenVehicles: Array<{ plate: string; make: string; model: string; color: string; reportedAt: string }>;
  specialAssignments: Array<{ assignment: string; assignedTo: string; location: string; time: string }>;
  officerSafety: Array<{ type: string; description: string; severity: string }>;
  trainingReminders: string[];
  announcements: string[];
}

export function useShiftBriefing() {
  const [briefing, setBriefing] = useState<ShiftBriefing | null>(null);
  const [loading, setLoading] = useState(false);

  const loadBriefing = useCallback(async (date?: string, shift?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (shift) params.set('shift', shift);
      const result = await apiFetch<ShiftBriefing>(`/dispatch/stats/shift-briefing?${params}`);
      if (result) setBriefing(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const activeCallCount = useMemo(() => briefing?.activeCalls.length || 0, [briefing]);
  const activeUnitCount = useMemo(() => briefing?.activeUnits.length || 0, [briefing]);
  const boloCount = useMemo(() => briefing?.bolos.length || 0, [briefing]);
  const wantedCount = useMemo(() => briefing?.wantedPersons.length || 0, [briefing]);
  const safetyAlertCount = useMemo(() => briefing?.officerSafety.length || 0, [briefing]);

  return { briefing, loading, loadBriefing, activeCallCount, activeUnitCount, boloCount, wantedCount, safetyAlertCount };
}

/* ── FEATURE 62: Daily Activity Summary ─────────────────────
   Spillman Flex generates an end-of-shift activity summary
   for each officer showing their calls, contacts, and stats. */
export interface DailyActivitySummary {
  officerName: string;
  badgeNumber: string;
  date: string;
  shift: string;
  callsHandled: number;
  reportsWritten: number;
  citationsIssued: number;
  arrestsMade: number;
  warningsGiven: number;
  milesDriven: number;
  hoursOnDuty: number;
  callDetails: Array<{ callNumber: string; nature: string; disposition: string; timeOnScene: number }>;
}

export function useDailyActivitySummary(officerId: string, date?: string) {
  const [summary, setSummary] = useState<DailyActivitySummary | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      const result = await apiFetch<DailyActivitySummary>(`/personnel/${officerId}/daily-summary?${params}`);
      if (result) setSummary(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, [officerId, date]);

  return { summary, loading, load };
}

/* ── FEATURE 63: Patrol Briefing Cards ──────────────────────
   Spillman Flex generates quick-reference cards for patrol
   officers with key information for their assigned zone. */
export interface PatrolBriefingCard {
  zone: string;
  beat: string;
  officerCallSign: string;
  activePremiseAlerts: Array<{ address: string; alert: string; severity: string }>;
  recentCalls: Array<{ callNumber: string; nature: string; time: string }>;
  knownOffenders: Array<{ name: string; address: string; reason: string }>;
  specialInstructions: string;
}

export function usePatrolBriefingCard(zone: string) {
  const [card, setCard] = useState<PatrolBriefingCard | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiFetch<PatrolBriefingCard>(`/dispatch/geography/zone/${zone}/briefing-card`);
      if (result) setCard(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, [zone]);

  return { card, loading, load };
}

/* ── FEATURE 64: Crime Bulletin Generator ───────────────────
   Spillman Flex creates crime bulletins for distribution to
   patrol units, neighboring agencies, and the public. */
export interface CrimeBulletin {
  id: string;
  date: string;
  title: string;
  crimeType: string;
  location: string;
  suspectDescription: string;
  vehicleDescription: string | null;
  moDescription: string;
  caseNumber: string;
  contactInfo: string;
  distribution: 'internal' | 'regional' | 'public' | 'all';
}

export function generateCrimeBulletin(
  caseData: {
    caseNumber: string;
    crimeType: string;
    location: string;
    suspectDescription: string;
    vehicleDescription: string | null;
    moDescription: string;
    investigatingOfficer: string;
    officerPhone: string;
  },
  distribution: CrimeBulletin['distribution']
): CrimeBulletin {
  return {
    id: `bulletin-${Date.now()}`,
    date: new Date().toISOString().slice(0, 10),
    title: `${caseData.crimeType.toUpperCase()} — ${caseData.location}`,
    crimeType: caseData.crimeType,
    location: caseData.location,
    suspectDescription: caseData.suspectDescription,
    vehicleDescription: caseData.vehicleDescription,
    moDescription: caseData.moDescription,
    caseNumber: caseData.caseNumber,
    contactInfo: `${caseData.investigatingOfficer} / ${caseData.officerPhone}`,
    distribution,
  };
}

/* ── FEATURE 65: Roll Call Presentation Format ──────────────
   Spillman Flex formats briefing data for projection during
   roll call with section headers and priority highlights. */
export interface RollCallSlide {
  section: string;
  title: string;
  items: string[];
  priorityFlag: boolean;
}

export function formatRollCallPresentation(briefing: ShiftBriefing): RollCallSlide[] {
  const slides: RollCallSlide[] = [];

  slides.push({ section: 'header', title: `ROLL CALL BRIEFING — ${briefing.shift} Shift — ${briefing.date}`, items: [`Supervisor: ${briefing.supervisor}`, `Weather: ${briefing.weather.temp}°F, ${briefing.weather.conditions}`], priorityFlag: false });

  if (briefing.officerSafety.length > 0) {
    slides.push({
      section: 'safety',
      title: 'OFFICER SAFETY ALERTS',
      items: briefing.officerSafety.map(a => `[${a.severity.toUpperCase()}] ${a.type}: ${a.description}`),
      priorityFlag: true,
    });
  }

  if (briefing.activeCalls.length > 0) {
    slides.push({
      section: 'calls',
      title: 'ACTIVE CALLS',
      items: briefing.activeCalls.map(c => `[${c.priority}] ${c.callNumber} — ${c.nature} — ${c.location} (${c.status})`),
      priorityFlag: briefing.activeCalls.some(c => c.priority === 'P1' || c.priority === 'P2'),
    });
  }

  if (briefing.bolos.length > 0) {
    slides.push({ section: 'bolos', title: 'ACTIVE BOLOS', items: briefing.bolos.map(b => `${b.description}${b.vehicle ? ` — Vehicle: ${b.vehicle}` : ''}${b.suspect ? ` — Suspect: ${b.suspect}` : ''}`), priorityFlag: true });
  }

  if (briefing.wantedPersons.length > 0) {
    slides.push({ section: 'wanted', title: 'WANTED PERSONS', items: briefing.wantedPersons.map(w => `${w.name} — ${w.charges} (Last seen: ${w.lastSeen})`), priorityFlag: true });
  }

  if (briefing.stolenVehicles.length > 0) {
    slides.push({ section: 'stolen', title: 'STOLEN VEHICLES', items: briefing.stolenVehicles.map(v => `${v.plate} — ${v.color} ${v.make} ${v.model} (Reported: ${v.reportedAt})`), priorityFlag: false });
  }

  if (briefing.specialAssignments.length > 0) {
    slides.push({ section: 'assignments', title: 'SPECIAL ASSIGNMENTS', items: briefing.specialAssignments.map(a => `${a.assignment} — ${a.assignedTo} at ${a.location} (${a.time})`), priorityFlag: false });
  }

  if (briefing.announcements.length > 0) {
    slides.push({ section: 'announcements', title: 'ANNOUNCEMENTS', items: briefing.announcements, priorityFlag: false });
  }

  return slides;
}

/* ── FEATURE 66: Officer Activity Report ────────────────────
   Spillman Flex generates officer activity reports showing
   all actions, response times, and productivity metrics. */
export interface OfficerActivityReport {
  officerId: string;
  officerName: string;
  dateRange: { start: string; end: string };
  totalCalls: number;
  totalReports: number;
  totalArrests: number;
  totalCitations: number;
  avgResponseMinutes: number;
  totalMilesDriven: number;
  totalHoursOnScene: number;
  activityByHour: Array<{ hour: number; calls: number; activities: number }>;
  topCallTypes: Array<{ type: string; count: number }>;
  comparisonToAverage: { callsPct: number; arrestsPct: number; reportsPct: number };
}

export function useOfficerActivityReport(officerId: string, startDate: string, endDate: string) {
  const [report, setReport] = useState<OfficerActivityReport | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ start: startDate, end: endDate });
      const result = await apiFetch<OfficerActivityReport>(`/personnel/${officerId}/activity-report?${params}`);
      if (result) setReport(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, [officerId, startDate, endDate]);

  return { report, loading, load };
}

/* ── FEATURE 67: Zone Activity Report ──────────────────────
   Spillman Flex generates zone-level activity reports showing
   call volume, crime patterns, and resource utilization. */
export interface ZoneActivityReport {
  zone: string;
  dateRange: { start: string; end: string };
  totalCalls: number;
  callsByType: Array<{ type: string; count: number }>;
  callsByHour: Array<{ hour: number; count: number }>;
  avgResponseMinutes: number;
  officerHours: number;
  topLocations: Array<{ address: string; count: number }>;
  crimeTrend: 'increasing' | 'stable' | 'decreasing';
}

export function useZoneActivityReport(zone: string, startDate: string, endDate: string) {
  const [report, setReport] = useState<ZoneActivityReport | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ start: startDate, end: endDate });
      const result = await apiFetch<ZoneActivityReport>(`/dispatch/geography/zone/${zone}/activity?${params}`);
      if (result) setReport(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, [zone, startDate, endDate]);

  return { report, loading, load };
}

/* ── FEATURE 68: Command Staff Briefing ────────────────────
   Spillman Flex compiles a high-level briefing for command
   staff with KPIs, trends, and resource allocation data. */
export interface CommandStaffBriefing {
  date: string;
  period: string;
  totalCalls: number;
  priorityBreakdown: { P1: number; P2: number; P3: number; P4: number };
  avgResponseP1: number;
  avgResponseOverall: number;
  officerCount: number;
  officersOnDuty: number;
  overtimeHours: number;
  useOfForceIncidents: number;
  citizenComplaints: number;
  crimesCleared: number;
  clearanceRate: number;
  topCrimeTypes: Array<{ type: string; count: number }>;
  budgetUtilization: number;
  fleetStatus: { total: number; inService: number; inMaintenance: number };
  notableIncidents: string[];
}

export function useCommandStaffBriefing(period: 'daily' | 'weekly' | 'monthly' = 'daily') {
  const [briefing, setBriefing] = useState<CommandStaffBriefing | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiFetch<CommandStaffBriefing>(`/reports/command-staff?period=${period}`);
      if (result) setBriefing(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, [period]);

  return { briefing, loading, load };
}

/* ── FEATURE 69: Statistical Dashboard Data ────────────────
   Spillman Flex aggregates statistical data for real-time
   dashboards showing department-wide metrics. */
export interface DashboardStats {
  activeCalls: number;
  pendingCalls: number;
  availableUnits: number;
  totalUnits: number;
  callsToday: number;
  callsThisWeek: number;
  callsThisMonth: number;
  avgResponseTime: number;
  officerSafetyScore: number;
  communityEngagementScore: number;
}

export function useDashboardStats() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiFetch<DashboardStats>('/dispatch/stats/dashboard');
      if (result) setStats(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  return { stats, loading, load };
}

/* ── FEATURE 70: Automated Briefing Email Generator ────────
   Spillman Flex formats briefing data for email distribution
   to command staff and patrol supervisors. */
export function generateBriefingEmail(
  briefing: ShiftBriefing,
  recipients: string[]
): { subject: string; body: string; recipients: string[] } {
  const lines: string[] = [];
  lines.push(`RMPG FLEX — SHIFT BRIEFING`);
  lines.push(`========================================`);
  lines.push(`Date: ${briefing.date}`);
  lines.push(`Shift: ${briefing.shift}`);
  lines.push(`Supervisor: ${briefing.supervisor}`);
  lines.push(``);
  lines.push(`WEATHER: ${briefing.weather.temp}°F, ${briefing.weather.conditions}`);
  if (briefing.weather.alerts.length > 0) {
    briefing.weather.alerts.forEach(a => lines.push(`  ALERT: ${a}`));
  }
  lines.push(``);
  lines.push(`ACTIVE CALLS (${briefing.activeCalls.length}):`);
  briefing.activeCalls.forEach(c => lines.push(`  [${c.priority}] ${c.callNumber} — ${c.nature} at ${c.location} (${c.status})`));
  lines.push(``);
  lines.push(`UNITS ON DUTY (${briefing.activeUnits.length}):`);
  briefing.activeUnits.forEach(u => lines.push(`  ${u.callSign} — ${u.status} — ${u.location}`));
  lines.push(``);
  if (briefing.officerSafety.length > 0) {
    lines.push(`OFFICER SAFETY:`);
    briefing.officerSafety.forEach(s => lines.push(`  [${s.severity.toUpperCase()}] ${s.type}: ${s.description}`));
    lines.push(``);
  }
  lines.push(`========================================`);
  lines.push(`This briefing was automatically generated by RMPG Flex.`);

  return {
    subject: `RMPG Shift Briefing — ${briefing.shift} Shift — ${briefing.date}`,
    body: lines.join('\n'),
    recipients,
  };
}
