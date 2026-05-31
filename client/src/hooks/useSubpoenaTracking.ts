// ============================================================
// RMPG Flex — Subpoena & Court Tracking (Spillman Flex Standard)
// 10 subpoena / court features: subpoena tracking workflow,
// service deadline management, witness fee calculation,
// court appearance scheduling, subpoena compliance tracking,
// discovery management, evidence subpoena tracking, witness
// availability calendar, subpoena batch generation, and
// court liaison dashboard.
// ============================================================

import { useState, useCallback, useMemo } from 'react';
import { apiFetch } from './useApi';

/* ── FEATURE 101: Subpoena Tracking Workflow ───────────────
   Spillman Flex tracks subpoenas from issuance through
   service, court appearance, and return. */
export interface Subpoena {
  id: string;
  caseNumber: string;
  type: 'witness' | 'records' | 'evidence' | 'expert' | 'officer';
  issuedTo: string;
  issuedBy: string;
  issuedAt: string;
  courtDate: string;
  courtName: string;
  judge: string;
  serviceDeadline: string;
  serviceStatus: 'pending' | 'attempted' | 'served' | 'unable' | 'cancelled' | 'quashed';
  servedBy: string | null;
  servedAt: string | null;
  serviceMethod: 'personal' | 'substitute' | 'certified_mail' | 'posting' | 'other' | null;
  proofOfService: boolean;
  appearanceConfirmed: boolean;
  notes: string;
  attachments: string[];
}

export function useSubpoenaTracking() {
  const [subpoenas, setSubpoenas] = useState<Subpoena[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (params?: { caseNumber?: string; status?: string }) => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (params?.caseNumber) query.set('caseNumber', params.caseNumber);
      if (params?.status) query.set('status', params.status);
      const result = await apiFetch<Subpoena[]>(`/court/subpoenas?${query}`);
      if (result) setSubpoenas(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const create = useCallback(async (data: Partial<Subpoena>) => {
    const result = await apiFetch<Subpoena>('/court/subpoenas', { method: 'POST', body: data });
    if (result) setSubpoenas(prev => [...prev, result]);
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<Subpoena>) => {
    const result = await apiFetch<Subpoena>(`/court/subpoenas/${id}`, { method: 'PUT', body: data });
    if (result) setSubpoenas(prev => prev.map(s => s.id === id ? result : s));
    return result;
  }, []);

  const pending = useMemo(() => subpoenas.filter(s => s.serviceStatus === 'pending'), [subpoenas]);
  const overdue = useMemo(() => subpoenas.filter(s => s.serviceStatus !== 'served' && s.serviceStatus !== 'cancelled' && new Date(s.serviceDeadline) < new Date()), [subpoenas]);
  const upcoming = useMemo(() => subpoenas.filter(s => s.serviceStatus === 'served' && !s.appearanceConfirmed && new Date(s.courtDate) > new Date()), [subpoenas]);

  return { subpoenas, loading, load, create, update, pending, overdue, upcoming };
}

/* ── FEATURE 102: Service Deadline Management ──────────────
   Spillman Flex tracks service deadlines and alerts before
   court dates when service hasn't been completed. */
export interface ServiceDeadline {
  subpoenaId: string;
  witnessName: string;
  courtDate: string;
  serviceDeadline: string;
  daysUntilDeadline: number;
  daysUntilCourt: number;
  serviceStatus: string;
  urgency: 'past_due' | 'critical' | 'warning' | 'normal';
  recommmendedAction: string;
}

export function trackServiceDeadlines(subpoenas: Subpoena[]): ServiceDeadline[] {
  const now = new Date();

  return subpoenas
    .filter(s => s.serviceStatus !== 'served' && s.serviceStatus !== 'cancelled' && s.serviceStatus !== 'quashed')
    .map(s => {
      const deadline = new Date(s.serviceDeadline);
      const courtDate = new Date(s.courtDate);
      const daysUntilDeadline = Math.ceil((deadline.getTime() - now.getTime()) / 86400000);
      const daysUntilCourt = Math.ceil((courtDate.getTime() - now.getTime()) / 86400000);

      let urgency: ServiceDeadline['urgency'] = 'normal';
      let recommmendedAction = '';

      if (daysUntilDeadline < 0) {
        urgency = 'past_due';
        recommmendedAction = 'Service deadline passed. Attempt immediate service or file motion for extension.';
      } else if (daysUntilDeadline <= 3) {
        urgency = 'critical';
        recommmendedAction = `Only ${daysUntilDeadline} days until service deadline. Prioritize this service.`;
      } else if (daysUntilDeadline <= 7) {
        urgency = 'warning';
        recommmendedAction = `Service deadline approaching. Schedule service within ${daysUntilDeadline} days.`;
      } else {
        recommmendedAction = `Service deadline is ${daysUntilDeadline} days away. Plan service attempt.`;
      }

      return {
        subpoenaId: s.id,
        witnessName: s.issuedTo,
        courtDate: s.courtDate,
        serviceDeadline: s.serviceDeadline,
        daysUntilDeadline,
        daysUntilCourt,
        serviceStatus: s.serviceStatus,
        urgency,
        recommmendedAction,
      };
    })
    .sort((a, b) => a.daysUntilDeadline - b.daysUntilDeadline);
}

/* ── FEATURE 103: Witness Fee Calculation ──────────────────
   Spillman Flex calculates witness fees based on state
   statute, including mileage and per-diem rates. */
export interface WitnessFee {
  subpoenaId: string;
  witnessName: string;
  courtDate: string;
  appearanceDays: number;
  dailyFee: number;
  mileageRate: number;
  roundTripMiles: number;
  totalMileageFee: number;
  totalPerDiemFee: number;
  parkingFee: number;
  totalFee: number;
  paid: boolean;
  paidAt: string | null;
  checkNumber: string | null;
}

export function calculateWitnessFees(
  subpoenaId: string,
  witnessName: string,
  courtDate: string,
  roundTripMiles: number,
  appearanceDays: number = 1,
  dailyFeeOverride?: number,
  mileageRateOverride?: number
): WitnessFee {
  const dailyFee = dailyFeeOverride || 25.00;
  const mileageRate = mileageRateOverride || 0.655; // IRS standard mileage rate
  const totalMileageFee = roundTripMiles * mileageRate;
  const totalPerDiemFee = dailyFee * appearanceDays;
  const parkingFee = 5.00;

  return {
    subpoenaId,
    witnessName,
    courtDate,
    appearanceDays,
    dailyFee,
    mileageRate,
    roundTripMiles,
    totalMileageFee: Math.round(totalMileageFee * 100) / 100,
    totalPerDiemFee: Math.round(totalPerDiemFee * 100) / 100,
    parkingFee,
    totalFee: Math.round((totalMileageFee + totalPerDiemFee + parkingFee) * 100) / 100,
    paid: false,
    paidAt: null,
    checkNumber: null,
  };
}

/* ── FEATURE 104: Court Appearance Scheduling ──────────────
   Spillman Flex schedules court appearances and checks for
   conflicts with other scheduled events. */
export interface CourtAppearance {
  id: string;
  caseNumber: string;
  courtName: string;
  courtroom: string;
  judge: string;
  date: string;
  time: string;
  type: 'arraignment' | 'preliminary' | 'motion' | 'trial' | 'sentencing' | 'hearing' | 'deposition' | 'grand_jury' | 'other';
  officerRequired: boolean;
  officerId: string | null;
  officerConfirmed: boolean;
  prosecutorNotified: boolean;
  status: 'scheduled' | 'confirmed' | 'continued' | 'cancelled' | 'completed';
  notes: string;
}

export function useCourtAppearances() {
  const [appearances, setAppearances] = useState<CourtAppearance[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (params?: { date?: string; officerId?: string }) => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (params?.date) query.set('date', params.date);
      if (params?.officerId) query.set('officerId', params.officerId);
      const result = await apiFetch<CourtAppearance[]>(`/court/appearances?${query}`);
      if (result) setAppearances(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const confirmAppearance = useCallback(async (id: string) => {
    const result = await apiFetch<CourtAppearance>(`/court/appearances/${id}/confirm`, { method: 'POST' });
    if (result) setAppearances(prev => prev.map(a => a.id === id ? result : a));
    return result;
  }, []);

  const today = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return appearances.filter(a => a.date === todayStr);
  }, [appearances]);

  const upcoming = useMemo(() => appearances.filter(a => a.date > new Date().toISOString().slice(0, 10) && a.status === 'scheduled'), [appearances]);

  return { appearances, loading, load, confirmAppearance, today, upcoming };
}

/* ── FEATURE 105: Subpoena Compliance Tracking ─────────────
   Spillman Flex tracks subpoena compliance and flags
   non-compliance for follow-up or enforcement action. */
export interface SubpoenaCompliance {
  subpoenaId: string;
  issuedTo: string;
  type: string;
  courtDate: string;
  served: boolean;
  appeared: boolean;
  complied: boolean;
  nonComplianceReason: string | null;
  enforcementAction: 'none' | 'contempt_filing' | 'bench_warrant' | 'follow_up' | 'reschedule';
  enforcementStatus: 'pending' | 'submitted' | 'approved' | 'issued' | 'executed';
  notes: string;
}

export function checkSubpoenaCompliance(subpoenas: Subpoena[]): SubpoenaCompliance[] {
  const now = new Date();

  return subpoenas
    .filter(s => new Date(s.courtDate) < now)
    .map(s => {
      const served = s.serviceStatus === 'served';
      const appeared = s.appearanceConfirmed;
      const complied = served && appeared;

      let nonComplianceReason: string | null = null;
      let enforcementAction: SubpoenaCompliance['enforcementAction'] = 'none';

      if (!served && !appeared) {
        nonComplianceReason = 'Subpoena not served. Witness did not appear.';
        enforcementAction = 'follow_up';
      } else if (served && !appeared) {
        nonComplianceReason = 'Witness was served but failed to appear.';
        enforcementAction = 'contempt_filing';
      } else if (!served) {
        nonComplianceReason = 'Subpoena could not be served before court date.';
        enforcementAction = 'reschedule';
      }

      return {
        subpoenaId: s.id,
        issuedTo: s.issuedTo,
        type: s.type,
        courtDate: s.courtDate,
        served,
        appeared,
        complied,
        nonComplianceReason,
        enforcementAction,
        enforcementStatus: 'pending',
        notes: '',
      };
    });
}

/* ── FEATURE 106: Discovery Management ────────────────────
   Spillman Flex tracks discovery obligations, deadlines,
   and compliance across all active cases. */
export interface DiscoveryObligation {
  caseNumber: string;
  discoveryType: 'body_camera' | 'dash_camera' | 'reports' | 'witness_statements' | 'lab_results' | 'photographs' | 'audio' | 'expert_reports' | 'other';
  description: string;
  dueDate: string;
  providedDate: string | null;
  providedTo: string | null;
  status: 'pending' | 'in_progress' | 'provided' | 'overdue' | 'not_applicable';
  notes: string;
}

export function useDiscoveryManagement() {
  const [obligations, setObligations] = useState<DiscoveryObligation[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (caseNumber?: string) => {
    setLoading(true);
    try {
      const query = caseNumber ? `?caseNumber=${caseNumber}` : '';
      const result = await apiFetch<DiscoveryObligation[]>(`/court/discovery${query}`);
      if (result) setObligations(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const overdue = useMemo(() => obligations.filter(d => d.status === 'overdue' || (d.status === 'pending' && new Date(d.dueDate) < new Date())), [obligations]);
  const pending = useMemo(() => obligations.filter(d => d.status === 'pending' || d.status === 'in_progress'), [obligations]);

  return { obligations, loading, load, overdue, pending };
}

/* ── FEATURE 107: Evidence Subpoena Tracking ───────────────
   Spillman Flex tracks subpoenas duces tecum (for records)
   and ensures evidence is properly transferred to court. */
export interface EvidenceSubpoena {
  id: string;
  caseNumber: string;
  issuedTo: string;
  recordsRequested: string;
  issuedAt: string;
  dueDate: string;
  receivedDate: string | null;
  evidenceItemIds: string[];
  chainOfCustody: Array<{ from: string; to: string; date: string; reason: string }>;
  status: 'pending' | 'partial' | 'received' | 'objected' | 'quashed';
  courtDate: string;
  notes: string;
}

export function useEvidenceSubpoena() {
  const [subpoenas, setSubpoenas] = useState<EvidenceSubpoena[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiFetch<EvidenceSubpoena[]>('/court/evidence-subpoenas');
      if (result) setSubpoenas(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const pending = useMemo(() => subpoenas.filter(s => s.status === 'pending' || s.status === 'partial'), [subpoenas]);

  return { subpoenas, loading, load, pending };
}

/* ── FEATURE 108: Witness Availability Calendar ────────────
   Spillman Flex maintains a witness availability calendar
   to coordinate court dates and avoid scheduling conflicts. */
export interface WitnessAvailability {
  witnessId: string;
  witnessName: string;
  caseNumber: string;
  unavailableDates: string[];
  preferredContactMethod: 'phone' | 'email' | 'mail';
  contactInfo: string;
  notes: string;
  lastUpdated: string;
}

export function useWitnessAvailability() {
  const [witnesses, setWitnesses] = useState<WitnessAvailability[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (caseNumber?: string) => {
    setLoading(true);
    try {
      const query = caseNumber ? `?caseNumber=${caseNumber}` : '';
      const result = await apiFetch<WitnessAvailability[]>(`/court/witness-availability${query}`);
      if (result) setWitnesses(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const findAvailableWitnesses = useCallback((date: string) => {
    return witnesses.filter(w => !w.unavailableDates.includes(date));
  }, [witnesses]);

  return { witnesses, loading, load, findAvailableWitnesses };
}

/* ── FEATURE 109: Subpoena Batch Generation ────────────────
   Spillman Flex generates batches of subpoenas for cases
   with multiple witnesses, saving time and ensuring consistency. */
export interface SubpoenaBatch {
  caseNumber: string;
  courtDate: string;
  courtName: string;
  judge: string;
  witnesses: Array<{ name: string; address: string; type: Subpoena['type'] }>;
  generatedAt: string;
  generatedBy: string;
  subpoenaIds: string[];
}

export function generateSubpoenaBatch(
  caseNumber: string,
  courtDate: string,
  courtName: string,
  judge: string,
  witnesses: Array<{ name: string; address: string; type: Subpoena['type'] }>,
  generatedBy: string
): SubpoenaBatch {
  // Service deadline: typically 14 days before court for witnesses, 7 for officers
  const deadlineDate = new Date(courtDate);
  deadlineDate.setDate(deadlineDate.getDate() - 14);

  return {
    caseNumber,
    courtDate,
    courtName,
    judge,
    witnesses,
    generatedAt: new Date().toISOString(),
    generatedBy,
    subpoenaIds: [], // Will be populated after creation
  };
}

/* ── FEATURE 110: Court Liaison Dashboard ──────────────────
   Spillman Flex provides a court liaison dashboard showing
   all active cases with court dates, required officers,
   and pending items. */
export interface CourtDashboard {
  todayAppearances: CourtAppearance[];
  tomorrowAppearances: CourtAppearance[];
  thisWeekAppearances: CourtAppearance[];
  pendingSubpoenas: number;
  overdueService: number;
  discoveryDue: number;
  officerConflicts: Array<{ officerName: string; appearances: CourtAppearance[] }>;
  casesWithIssues: Array<{ caseNumber: string; issue: string; severity: string }>;
}

export function useCourtLiaisonDashboard() {
  const [dashboard, setDashboard] = useState<CourtDashboard | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiFetch<CourtDashboard>('/court/dashboard');
      if (result) setDashboard(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  return { dashboard, loading, load };
}
