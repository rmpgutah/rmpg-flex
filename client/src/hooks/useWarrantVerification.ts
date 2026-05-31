// ============================================================
// RMPG Flex — Warrant Verification System (Spillman Flex Standard)
// 10 administrative features: warrant verification workflow,
// warrant confirmation hit tracking, warrant service attempt
// logging, warrant recall process, bond/surety tracking,
// warrant expiration management, multi-jurisdiction warrant
// check, warrant packet assembly, extradition eligibility
// check, and warrant statistical reporting.
// ============================================================

import { useState, useCallback, useMemo } from 'react';
import { apiFetch } from './useApi';

/* ── FEATURE 71: Warrant Verification Workflow ─────────────
   Spillman Flex provides a step-by-step warrant verification
   process to confirm validity before service. */
export interface WarrantVerification {
  warrantId: string;
  verifiedAt: Date | null;
  verifiedBy: string | null;
  confirmationMethod: 'ncic' | 'state' | 'agency' | 'court' | 'none';
  confirmationReference: string | null;
  status: 'unverified' | 'pending' | 'verified' | 'invalid' | 'recalled';
  notes: string;
  subjectConfirmed: boolean;
  chargesConfirmed: boolean;
  bondConfirmed: boolean;
  expirationConfirmed: boolean;
}

export function useWarrantVerification() {
  const [verifications, setVerifications] = useState<Map<string, WarrantVerification>>(new Map());
  const [loading, setLoading] = useState(false);

  const verifyWarrant = useCallback(async (warrantId: string, method: WarrantVerification['confirmationMethod']) => {
    setLoading(true);
    try {
      const result = await apiFetch<WarrantVerification>(`/warrants/${warrantId}/verify`, {
        method: 'POST',
        body: { confirmationMethod: method },
      });
      if (result) {
        setVerifications(prev => new Map(prev).set(warrantId, result));
      }
      return result;
    } catch { return null; }
    finally { setLoading(false); }
  }, []);

  const getVerification = useCallback((warrantId: string) => verifications.get(warrantId), [verifications]);

  return { verifications, loading, verifyWarrant, getVerification };
}

/* ── FEATURE 72: Warrant Confirmation Hit Tracking ─────────
   Spillman Flex tracks NCIC/state warrant confirmation hits
   and logs the confirmation process for audit. */
export interface WarrantHit {
  id: string;
  warrantId: string;
  subjectName: string;
  hitSource: 'ncic' | 'nlv' | 'state_registry' | 'national' | 'interstate';
  hitTimestamp: Date;
  confirmedBy: string;
  confirmationNumber: string;
  charges: string[];
  issuingAgency: string;
  extraditable: boolean;
  bond: number | null;
  notes: string;
}

export function useWarrantHitTracking() {
  const [hits, setHits] = useState<WarrantHit[]>([]);
  const [loading, setLoading] = useState(false);

  const recordHit = useCallback(async (warrantId: string, subjectName: string, hitSource: string, charges: string[], issuingAgency: string, extraditable: boolean) => {
    setLoading(true);
    try {
      const result = await apiFetch<WarrantHit>('/warrants/hits', {
        method: 'POST',
        body: { warrantId, subjectName, hitSource, charges, issuingAgency, extraditable },
      });
      if (result) setHits(prev => [...prev, result]);
      return result;
    } catch { return null; }
    finally { setLoading(false); }
  }, []);

  const pendingHits = useMemo(() => hits.filter(h => !h.confirmationNumber), [hits]);

  return { hits, loading, recordHit, pendingHits };
}

/* ── FEATURE 73: Warrant Service Attempt Logging ────────────
   Spillman Flex logs all warrant service attempts with
   location, time, and outcome for due diligence tracking. */
export interface ServiceAttempt {
  id: string;
  warrantId: string;
  attemptedAt: Date;
  attemptedBy: string;
  location: string;
  method: 'knock_and_announce' | 'surveillance' | 'traffic_stop' | 'workplace' | 'family_contact' | 'other';
  outcome: 'served' | 'not_home' | 'refused_entry' | 'subject_fled' | 'wrong_address' | 'other';
  notes: string;
  followUpNeeded: boolean;
}

export function useWarrantServiceLogging(warrantId: string) {
  const [attempts, setAttempts] = useState<ServiceAttempt[]>([]);
  const [loading, setLoading] = useState(false);

  const logAttempt = useCallback(async (method: string, outcome: string, location: string, notes: string, followUpNeeded: boolean) => {
    setLoading(true);
    try {
      const result = await apiFetch<ServiceAttempt>(`/warrants/${warrantId}/attempts`, {
        method: 'POST',
        body: { method, outcome, location, notes, followUpNeeded },
      });
      if (result) setAttempts(prev => [...prev, result]);
      return result;
    } catch { return null; }
    finally { setLoading(false); }
  }, [warrantId]);

  const serviceRate = useMemo(() => attempts.length > 0 ? (attempts.filter(a => a.outcome === 'served').length / attempts.length * 100) : 0, [attempts]);

  return { attempts, loading, logAttempt, serviceRate };
}

/* ── FEATURE 74: Warrant Recall Process ────────────────────
   Spillman Flex provides a structured warrant recall workflow
   when a warrant is no longer valid or has been satisfied. */
export interface WarrantRecall {
  warrantId: string;
  recallRequestedBy: string;
  recallRequestedAt: Date;
  reason: 'bond_posted' | 'case_dismissed' | 'subject_deceased' | 'clerical_error' | 'duplicate' | 'superseded' | 'other';
  reasonDetail: string;
  courtOrderRef: string | null;
  status: 'pending' | 'approved' | 'denied' | 'processed';
  approvedBy: string | null;
  approvedAt: Date | null;
  ncicRemoved: boolean;
  ncicRemovedAt: Date | null;
}

export function useWarrantRecall() {
  const [loading, setLoading] = useState(false);

  const requestRecall = useCallback(async (warrantId: string, reason: WarrantRecall['reason'], detail: string) => {
    setLoading(true);
    try {
      const result = await apiFetch<WarrantRecall>(`/warrants/${warrantId}/recall`, {
        method: 'POST',
        body: { reason, reasonDetail: detail },
      });
      return result;
    } catch { return null; }
    finally { setLoading(false); }
  }, []);

  const checkRecallStatus = useCallback(async (warrantId: string) => {
    const result = await apiFetch<WarrantRecall>(`/warrants/${warrantId}/recall`);
    return result;
  }, []);

  return { loading, requestRecall, checkRecallStatus };
}

/* ── FEATURE 75: Bond / Surety Tracking ────────────────────
   Spillman Flex tracks bond amounts, surety types, and
   payment status for warrants with bond provisions. */
export interface BondTracking {
  warrantId: string;
  bondAmount: number;
  bondType: 'cash' | 'surety' | 'property' | 'personal_recognizance' | 'signature' | 'none';
  bondPosted: boolean;
  postedAmount: number;
  postedBy: string | null;
  postedAt: Date | null;
  suretyCompany: string | null;
  bondStatus: 'active' | 'forfeited' | 'exonerated' | 'refunded';
  courtDate: string | null;
  conditions: string[];
}

export function useBondTracking() {
  const [bonds, setBonds] = useState<BondTracking[]>([]);
  const [loading, setLoading] = useState(false);

  const getBond = useCallback(async (warrantId: string) => {
    const result = await apiFetch<BondTracking>(`/warrants/${warrantId}/bond`);
    return result;
  }, []);

  const updateBond = useCallback(async (warrantId: string, updates: Partial<BondTracking>) => {
    setLoading(true);
    try {
      const result = await apiFetch<BondTracking>(`/warrants/${warrantId}/bond`, {
        method: 'PUT',
        body: updates,
      });
      if (result) setBonds(prev => [...prev.filter(b => b.warrantId !== warrantId), result]);
      return result;
    } catch { return null; }
    finally { setLoading(false); }
  }, []);

  const activeBonds = useMemo(() => bonds.filter(b => b.bondStatus === 'active'), [bonds]);
  const totalActiveAmount = useMemo(() => activeBonds.reduce((sum, b) => sum + b.bondAmount, 0), [activeBonds]);

  return { bonds, loading, getBond, updateBond, activeBonds, totalActiveAmount };
}

/* ── FEATURE 76: Warrant Expiration Management ─────────────
   Spillman Flex tracks warrant expiration dates and alerts
   before warrants automatically expire. */
export interface WarrantExpiration {
  warrantId: string;
  issuedDate: Date;
  expirationDate: Date;
  daysRemaining: number;
  status: 'active' | 'expiring_soon' | 'expired';
  renewable: boolean;
  renewalProcess: string;
}

export function trackWarrantExpirations(
  warrants: Array<{ id: string; issuedDate: string; expirationDate: string | null; renewable: boolean }>
): WarrantExpiration[] {
  const now = new Date();
  return warrants.map(w => {
    const expirationDate = w.expirationDate ? new Date(w.expirationDate) : new Date(w.issuedDate);
    if (!w.expirationDate) expirationDate.setFullYear(expirationDate.getFullYear() + 5);

    const daysRemaining = Math.ceil((expirationDate.getTime() - now.getTime()) / 86400000);
    let status: WarrantExpiration['status'] = 'active';
    if (daysRemaining <= 0) status = 'expired';
    else if (daysRemaining <= 30) status = 'expiring_soon';

    return {
      warrantId: w.id,
      issuedDate: new Date(w.issuedDate),
      expirationDate,
      daysRemaining,
      status,
      renewable: w.renewable,
      renewalProcess: w.renewable ? 'File motion to renew with issuing court' : 'Obtain new warrant from issuing court',
    };
  }).sort((a, b) => a.daysRemaining - b.daysRemaining);
}

/* ── FEATURE 77: Multi-Jurisdiction Warrant Check ───────────
   Spillman Flex checks multiple warrant databases and
   consolidates results into a unified view. */
export interface MultiJurisdictionResult {
  jurisdiction: string;
  database: string;
  searchedAt: Date;
  hits: Array<{ name: string; dob: string; charges: string[]; warrantNumber: string; issuingAgency: string }>;
  errors: string[];
  status: 'complete' | 'partial' | 'failed';
}

export function useMultiJurisdictionWarrantCheck() {
  const [results, setResults] = useState<MultiJurisdictionResult[]>([]);
  const [loading, setLoading] = useState(false);

  const searchAll = useCallback(async (firstName: string, lastName: string, dob: string, jurisdictions: string[]) => {
    setLoading(true);
    try {
      const result = await apiFetch<MultiJurisdictionResult[]>('/warrants/multi-jurisdiction', {
        method: 'POST',
        body: { firstName, lastName, dob, jurisdictions },
      });
      if (result) setResults(result);
      return result;
    } catch { return null; }
    finally { setLoading(false); }
  }, []);

  const totalHits = useMemo(() => results.reduce((sum, r) => sum + r.hits.length, 0), [results]);
  const failedJurisdictions = useMemo(() => results.filter(r => r.status === 'failed').map(r => r.jurisdiction), [results]);

  return { results, loading, searchAll, totalHits, failedJurisdictions };
}

/* ── FEATURE 78: Warrant Packet Assembly ───────────────────
   Spillman Flex assembles a complete warrant service packet
   with all required documents for the serving officer. */
export interface WarrantPacket {
  warrantId: string;
  warrant: { number: string; type: string; charges: string[]; issuingCourt: string; judge: string; issuedDate: string };
  subject: { name: string; dob: string; race: string; sex: string; height: string; weight: string; hair: string; eyes: string; address: string; photo: string | null };
  conditions: string[];
  bondInfo: { amount: number; type: string; conditions: string[] };
  cautionFlags: string[];
  serviceHistory: Array<{ date: string; attempt: string; outcome: string }>;
}

export function useWarrantPacket() {
  const [packet, setPacket] = useState<WarrantPacket | null>(null);
  const [loading, setLoading] = useState(false);

  const assemble = useCallback(async (warrantId: string) => {
    setLoading(true);
    try {
      const result = await apiFetch<WarrantPacket>(`/warrants/${warrantId}/packet`);
      if (result) setPacket(result);
      return result;
    } catch { return null; }
    finally { setLoading(false); }
  }, []);

  return { packet, loading, assemble };
}

/* ── FEATURE 79: Extradition Eligibility Check ─────────────
   Spillman Flex checks whether a warrant is extraditable
   based on distance, charge severity, and interstate compacts. */
export interface ExtraditionCheck {
  warrantId: string;
  issuingState: string;
  executingState: string;
  distance: number;
  isCompactState: boolean;
  chargeSeverity: 'felony' | 'misdemeanor' | 'infraction';
  extraditable: boolean;
  extraditionLimit: number; // miles
  estimatedCost: number;
  procedure: string;
  notes: string[];
}

export function checkExtradition(
  warrantId: string,
  issuingState: string,
  executingState: string,
  chargeSeverity: string,
  distanceMiles: number
): ExtraditionCheck {
  const notes: string[] = [];
  let extraditable = false;
  let extraditionLimit = 0;
  let procedure = '';

  switch (chargeSeverity) {
    case 'felony':
      extraditable = true;
      extraditionLimit = 9999;
      procedure = 'Full extradition authorized. Contact issuing agency to confirm they will extradite.';
      notes.push('Felony — no distance limit under UCEA');
      break;
    case 'misdemeanor':
      extraditable = distanceMiles <= 500;
      extraditionLimit = 500;
      procedure = 'Misdemeanor extradition limited to 500 miles. Confirm with issuing agency.';
      notes.push(extraditable ? 'Within 500-mile extradition radius' : 'Exceeds 500-mile misdemeanor extradition limit');
      break;
    case 'infraction':
      extraditable = false;
      extraditionLimit = 0;
      procedure = 'Infractions are not extraditable. Issue citation or summons instead.';
      notes.push('Infractions are non-extraditable offenses');
      break;
    default:
      procedure = 'Unable to determine extradition eligibility. Contact issuing agency.';
      notes.push('Unknown charge severity');
  }

  const isCompactState = true;
  const estimatedCost = Math.round(distanceMiles * 2.5 + 500);

  return { warrantId, issuingState, executingState, distance: distanceMiles, isCompactState, chargeSeverity: chargeSeverity as any, extraditable, extraditionLimit, estimatedCost, procedure, notes };
}

/* ── FEATURE 80: Warrant Statistical Reporting ─────────────
   Spillman Flex generates warrant statistics for command
   staff: service rates, outstanding counts, aging analysis. */
export interface WarrantStats {
  totalActive: number;
  totalServedThisMonth: number;
  totalRecalled: number;
  avgDaysOutstanding: number;
  serviceRate: number;
  byType: Array<{ type: string; active: number; served: number; rate: number }>;
  byPriority: Array<{ priority: string; count: number; avgAge: number }>;
  agingBuckets: Array<{ bucket: string; count: number }>;
  officerPerformance: Array<{ officerName: string; served: number; attempts: number; rate: number }>;
}

export function useWarrantStats() {
  const [stats, setStats] = useState<WarrantStats | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (period: 'month' | 'quarter' | 'year' = 'month') => {
    setLoading(true);
    try {
      const result = await apiFetch<WarrantStats>(`/warrants/stats?period=${period}`);
      if (result) setStats(result);
      return result;
    } catch { return null; }
    finally { setLoading(false); }
  }, []);

  return { stats, loading, load };
}
