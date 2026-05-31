// ============================================================
// RMPG Flex — Officer Safety & Welfare System (Spillman Flex Standard)
// 10 officer safety features: welfare check scheduling, officer
// status monitoring, safety alert generation, hazard flagging,
// backup request protocol, scene assessment, suspect risk
// scoring, tactical advisories, de-escalation triggers, and
// post-incident wellness checks.
// ============================================================

import { useState, useCallback, useRef, useEffect } from 'react';
import { apiFetch } from './useApi';

/* ── FEATURE 11: Welfare Check Auto-Scheduling ─────────────
   Spillman Flex automatically prompts welfare checks at
   configurable intervals when an officer is on a call. */
export interface WelfareCheckConfig {
  intervalSeconds: number;
  missedThreshold: number;    // how many missed before escalation
  escalateAfterMissed: boolean;
  notifySupervisor: boolean;
}

const DEFAULT_WELFARE_CONFIG: WelfareCheckConfig = {
  intervalSeconds: 300,       // 5 minutes
  missedThreshold: 2,
  escalateAfterMissed: true,
  notifySupervisor: true,
};

export interface WelfareState {
  active: boolean;
  lastCheckin: Date | null;
  missedCount: number;
  escalated: boolean;
  callId: string | null;
  unitId: string | null;
}

export function useWelfareCheck() {
  const [config, setConfig] = useState<WelfareCheckConfig>(DEFAULT_WELFARE_CONFIG);
  const [state, setState] = useState<WelfareState>({
    active: false,
    lastCheckin: null,
    missedCount: 0,
    escalated: false,
    callId: null,
    unitId: null,
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [loading, setLoading] = useState(false);

  const startWelfare = useCallback((unitId: string, callId: string) => {
    setState(prev => ({ ...prev, active: true, unitId, callId, lastCheckin: new Date(), missedCount: 0, escalated: false }));
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(async () => {
      setState(prev => {
        if (!prev.active) return prev;
        const now = Date.now();
        const elapsed = prev.lastCheckin ? Math.floor((now - prev.lastCheckin.getTime()) / 1000) : 0;
        const newMissed = elapsed > config.intervalSeconds ? prev.missedCount + 1 : prev.missedCount;
        const escalated = newMissed >= config.missedThreshold;
        return { ...prev, missedCount: newMissed, escalated };
      });
      // Auto-escalate if threshold exceeded
      setState(prev => {
        if (prev.escalated && config.escalateAfterMissed) {
          apiFetch('/dispatch/welfare/escalate', { method: 'POST', body: { unitId: prev.unitId, callId: prev.callId } }).catch(() => {});
        }
        return prev;
      });
    }, config.intervalSeconds * 1000);
  }, [config]);

  const checkin = useCallback(async () => {
    setState(prev => ({ ...prev, lastCheckin: new Date(), missedCount: 0 }));
    if (state.unitId) {
      await apiFetch(`/dispatch/welfare/checkin/${state.unitId}`, { method: 'POST' }).catch(() => {});
    }
  }, [state.unitId]);

  const stopWelfare = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setState(prev => ({ ...prev, active: false }));
  }, []);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  return { config, setConfig, state, startWelfare, checkin, stopWelfare, loading };
}

/* ── FEATURE 12: Officer Status Monitoring ─────────────────
   Spillman Flex tracks officer status transitions and flags
   unusual patterns (extended off-scene, no GPS update, etc.) */
export interface OfficerStatusLog {
  officerId: string;
  timestamp: Date;
  oldStatus: string;
  newStatus: string;
  duration: number;       // seconds in previous status
  gpsLat: number | null;
  gpsLng: number | null;
  callId: string | null;
}

export interface OfficerStatusAlert {
  type: 'extended_scene' | 'no_gps' | 'rapid_toggle' | 'unusual_pattern';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: Date;
  officerId: string;
}

export function analyzeOfficerStatus(statusLog: OfficerStatusLog[]): OfficerStatusAlert[] {
  const alerts: OfficerStatusAlert[] = [];
  if (statusLog.length < 3) return alerts;

  const lastEntry = statusLog[statusLog.length - 1];

  // Extended on-scene (> 2 hours without update)
  if (lastEntry.newStatus === 'onscene' && lastEntry.duration > 7200) {
    alerts.push({ type: 'extended_scene', severity: 'warning', message: `Officer on scene for ${Math.round(lastEntry.duration / 60)} minutes`, timestamp: new Date(), officerId: lastEntry.officerId });
  }

  // No GPS update in last 10 minutes
  const recentEntries = statusLog.filter(e => (Date.now() - e.timestamp.getTime()) < 600000);
  const hasGps = recentEntries.some(e => e.gpsLat && e.gpsLng);
  if (!hasGps && recentEntries.length > 0) {
    alerts.push({ type: 'no_gps', severity: 'warning', message: 'No GPS update in last 10 minutes', timestamp: new Date(), officerId: lastEntry.officerId });
  }

  // Rapid status toggle (> 5 changes in 1 minute)
  const lastMinute = statusLog.filter(e => (Date.now() - e.timestamp.getTime()) < 60000);
  if (lastMinute.length > 5) {
    alerts.push({ type: 'rapid_toggle', severity: 'info', message: `${lastMinute.length} status changes in last minute`, timestamp: new Date(), officerId: lastEntry.officerId });
  }

  return alerts;
}

/* ── FEATURE 13: Scene Hazard Assessment ────────────────────
   Spillman Flex prompts officers to assess and report scene
   hazards. This generates a hazard score for dispatcher awareness. */
export interface SceneHazard {
  type: 'weapons' | 'chemical' | 'structural' | 'traffic' | 'crowd' | 'animal' | 'environmental' | 'other';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  reportedBy: string;
  timestamp: Date;
}

export function assessSceneRisk(hazards: SceneHazard[]): { score: number; level: 'safe' | 'caution' | 'danger' | 'critical'; advisories: string[] } {
  if (hazards.length === 0) return { score: 0, level: 'safe', advisories: [] };

  const weights = { low: 1, medium: 3, high: 7, critical: 15 };
  const score = hazards.reduce((sum, h) => sum + (weights[h.severity] || 1), 0);

  const advisories: string[] = [];
  const hazardTypes = new Set(hazards.map(h => h.type));
  if (hazardTypes.has('weapons')) advisories.push('Weapons present on scene — maintain cover');
  if (hazardTypes.has('chemical')) advisories.push('Chemical hazard — request HazMat if needed');
  if (hazardTypes.has('structural')) advisories.push('Structural hazard — avoid entry until cleared');
  if (hazardTypes.has('traffic')) advisories.push('Traffic hazard — position vehicles for scene protection');
  if (hazardTypes.has('crowd')) advisories.push('Crowd present — request crowd control units');

  let level: 'safe' | 'caution' | 'danger' | 'critical' = 'safe';
  if (score >= 15) level = 'critical';
  else if (score >= 7) level = 'danger';
  else if (score >= 3) level = 'caution';

  return { score, level, advisories };
}

/* ── FEATURE 14: Backup Request Protocol ────────────────────
   Spillman Flex provides standardized backup request levels
   and auto-dispatches the closest available units. */
export type BackupLevel = 'routine' | 'urgent' | 'emergency' | 'officer_down';

export interface BackupRequest {
  level: BackupLevel;
  requestingUnit: string;
  location: { lat: number; lng: number } | null;
  reason: string;
  unitsNeeded: number;
  timestamp: Date;
}

export const BACKUP_PROTOCOLS: Record<BackupLevel, { label: string; code: string; units: number; priority: string; broadcast: boolean }> = {
  routine: { label: 'Routine Backup', code: '10-78R', units: 1, priority: 'P3', broadcast: false },
  urgent: { label: 'Urgent Backup', code: '10-78', units: 2, priority: 'P2', broadcast: true },
  emergency: { label: 'Emergency Backup', code: '10-33', units: 4, priority: 'P1', broadcast: true },
  officer_down: { label: 'Officer Down', code: '10-00', units: 99, priority: 'P1', broadcast: true },
};

/* ── FEATURE 15: Subject Risk Scoring ──────────────────────
   Spillman Flex calculates a subject risk score from available
   data: criminal history, warrants, flags, officer safety inputs. */
export interface SubjectRiskProfile {
  hasWarrants: boolean;
  warrantCount: number;
  hasViolentHistory: boolean;
  hasWeaponsHistory: boolean;
  hasGangAffiliation: boolean;
  hasMentalHealthFlag: boolean;
  hasSubstanceAbuseFlag: boolean;
  priorResistArrest: boolean;
  priorAssaultOfficer: boolean;
  flags: string[];
}

export function calculateSubjectRisk(profile: SubjectRiskProfile): { score: number; level: 'low' | 'moderate' | 'high' | 'extreme'; color: string; summary: string } {
  let score = 0;
  const factors: string[] = [];

  if (profile.hasWarrants) { score += 3 * profile.warrantCount; factors.push(`${profile.warrantCount} active warrant(s)`); }
  if (profile.hasViolentHistory) { score += 5; factors.push('History of violence'); }
  if (profile.hasWeaponsHistory) { score += 6; factors.push('Known weapons access'); }
  if (profile.hasGangAffiliation) { score += 3; factors.push('Gang affiliation'); }
  if (profile.hasMentalHealthFlag) { score += 2; factors.push('Mental health flag'); }
  if (profile.hasSubstanceAbuseFlag) { score += 2; factors.push('Substance abuse history'); }
  if (profile.priorResistArrest) { score += 4; factors.push('Prior resisting arrest'); }
  if (profile.priorAssaultOfficer) { score += 7; factors.push('Prior assault on officer'); }

  let level: 'low' | 'moderate' | 'high' | 'extreme' = 'low';
  let color = '#22c55e';
  if (score >= 15) { level = 'extreme'; color = '#7f1d1d'; }
  else if (score >= 10) { level = 'high'; color = '#dc2626'; }
  else if (score >= 5) { level = 'moderate'; color = '#f59e0b'; }

  return { score, level, color, summary: factors.join('; ') || 'No elevated risk factors' };
}

/* ── FEATURE 16: Tactical Advisory System ──────────────────
   Spillman Flex provides real-time tactical advisories based
   on call type, location history, and officer feedback. */
export interface TacticalAdvisory {
  id: string;
  type: 'approach' | 'entry' | 'containment' | 'arrest' | 'search' | 'general';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  source: string;
  expiresAt: Date | null;
}

export function generateTacticalAdvisories(
  riskLevel: string,
  hasWeapons: boolean,
  premiseHistory: string[],
  officerNotes: string
): TacticalAdvisory[] {
  const advisories: TacticalAdvisory[] = [];

  if (hasWeapons) {
    advisories.push({ id: `tac-${Date.now()}-1`, type: 'approach', severity: 'critical', message: 'WEAPONS ALERT: Exercise extreme caution. Use cover and maintain distance.', source: 'call_flags', expiresAt: null });
    advisories.push({ id: `tac-${Date.now()}-2`, type: 'approach', severity: 'critical', message: 'Do not approach subject directly. Wait for backup before contact.', source: 'protocol', expiresAt: null });
  }

  if (riskLevel === 'extreme' || riskLevel === 'high') {
    advisories.push({ id: `tac-${Date.now()}-3`, type: 'arrest', severity: 'warning', message: 'HIGH-RISK SUBJECT: Use multiple officers for any contact. Consider tactical team.', source: 'risk_score', expiresAt: null });
  }

  if (premiseHistory.includes('previous_ambush') || premiseHistory.includes('booby_trap')) {
    advisories.push({ id: `tac-${Date.now()}-4`, type: 'entry', severity: 'critical', message: 'CRITICAL: Premise has history of ambush/booby traps. Do not enter without tactical clearance.', source: 'premise_history', expiresAt: null });
  }

  if (premiseHistory.includes('drug_lab')) {
    advisories.push({ id: `tac-${Date.now()}-5`, type: 'entry', severity: 'warning', message: 'HAZMAT: Possible drug lab. Request HazMat team. Use respiratory protection.', source: 'premise_history', expiresAt: null });
  }

  return advisories;
}

/* ── FEATURE 17: De-escalation Trigger Detection ───────────
   Spillman Flex monitors call narratives for de-escalation
   opportunities and suggests intervention strategies. */
export interface DeescalationStrategy {
  trigger: string;
  strategy: string;
  communicationTip: string;
  backupRecommended: boolean;
}

export const DEESCALATION_STRATEGIES: DeescalationStrategy[] = [
  { trigger: 'mental health', strategy: 'Crisis Intervention', communicationTip: 'Speak calmly, use subject\'s name, avoid rapid movements', backupRecommended: true },
  { trigger: 'suicidal', strategy: 'Suicide Prevention Protocol', communicationTip: 'Build rapport, validate feelings, maintain safe distance', backupRecommended: true },
  { trigger: 'intoxicated', strategy: 'Intoxication Management', communicationTip: 'Use simple language, avoid confrontation, wait for sobriety', backupRecommended: false },
  { trigger: 'domestic', strategy: 'Domestic Dispute Protocol', communicationTip: 'Separate parties, interview individually, remain neutral', backupRecommended: true },
  { trigger: 'juvenile', strategy: 'Juvenile Intervention', communicationTip: 'Use age-appropriate language, contact guardians, avoid intimidation', backupRecommended: false },
  { trigger: 'elderly', strategy: 'Elderly Assistance', communicationTip: 'Speak clearly and respectfully, accommodate physical limitations', backupRecommended: false },
  { trigger: 'language barrier', strategy: 'Translation Services', communicationTip: 'Request interpreter, use translation app, avoid gestures that may offend', backupRecommended: false },
];

export function detectDeescalationTriggers(narrative: string): DeescalationStrategy[] {
  const lower = narrative.toLowerCase();
  return DEESCALATION_STRATEGIES.filter(s => lower.includes(s.trigger));
}

/* ── FEATURE 18: Scene Safety Timer ────────────────────────
   Spillman Flex tracks time-on-scene and automatically prompts
   officers to confirm their safety at configurable intervals. */
export function useSceneSafetyTimer(onsceneSeconds: number, checkInterval: number = 900): { shouldPrompt: boolean; elapsedMinutes: number; promptMessage: string | null } {
  const shouldPrompt = onsceneSeconds > 0 && onsceneSeconds % checkInterval < 5;
  const elapsedMinutes = Math.floor(onsceneSeconds / 60);
  let promptMessage: string | null = null;

  if (shouldPrompt && elapsedMinutes > 0) {
    const hours = Math.floor(elapsedMinutes / 60);
    const mins = elapsedMinutes % 60;
    const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    promptMessage = `Officer safety check: You have been on scene for ${timeStr}. Please confirm your status.`;
  }

  return { shouldPrompt, elapsedMinutes, promptMessage };
}

/* ── FEATURE 19: Post-Incident Wellness Flag ───────────────
   Spillman Flex flags officers who have been involved in
   critical incidents for mandatory wellness follow-up. */
export interface CriticalIncidentCriteria {
  useOfForce: boolean;
  officerInjury: boolean;
  fatality: boolean;
  pursuit: boolean;
  hostageSituation: boolean;
  activeShooter: boolean;
  childVictim: boolean;
  prolongedScene: boolean; // > 4 hours
}

export function assessWellnessNeed(criteria: CriticalIncidentCriteria): { requiresFollowUp: boolean; urgency: 'routine' | 'priority' | 'immediate'; recommendedAction: string } {
  const score = [
    criteria.useOfForce ? 3 : 0,
    criteria.officerInjury ? 5 : 0,
    criteria.fatality ? 5 : 0,
    criteria.pursuit ? 2 : 0,
    criteria.hostageSituation ? 4 : 0,
    criteria.activeShooter ? 5 : 0,
    criteria.childVictim ? 4 : 0,
    criteria.prolongedScene ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  if (score >= 10) return { requiresFollowUp: true, urgency: 'immediate', recommendedAction: 'Mandatory peer support contact within 4 hours. Critical Incident Stress Debriefing within 24 hours.' };
  if (score >= 5) return { requiresFollowUp: true, urgency: 'priority', recommendedAction: 'Supervisor check-in within shift. Offer peer support resources.' };
  if (score >= 2) return { requiresFollowUp: true, urgency: 'routine', recommendedAction: 'Follow up at next briefing. Document in officer wellness log.' };
  return { requiresFollowUp: false, urgency: 'routine', recommendedAction: 'No action required.' };
}

/* ── FEATURE 20: Hazard Zone Mapping ───────────────────────
   Spillman Flex maintains a database of known hazard locations
   and automatically alerts officers approaching those zones. */
export interface HazardZone {
  id: string;
  address: string;
  latitude: number;
  longitude: number;
  radius: number;           // meters
  hazardType: 'aggressive_dog' | 'known_offender' | 'chemical_risk' | 'structural_risk' | 'previous_ambush' | 'booby_trap' | 'drug_lab' | 'other';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  reportedBy: string;
  createdAt: Date;
  expiresAt: Date | null;
  active: boolean;
}

export function checkHazardProximity(
  officerLat: number,
  officerLng: number,
  hazardZones: HazardZone[]
): HazardZone[] {
  return hazardZones.filter(zone => {
    if (!zone.active) return false;
    const R = 6371000; // Earth radius in meters
    const dLat = (zone.latitude - officerLat) * Math.PI / 180;
    const dLon = (zone.longitude - officerLng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(officerLat * Math.PI / 180) * Math.cos(zone.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return distance <= zone.radius;
  });
}
