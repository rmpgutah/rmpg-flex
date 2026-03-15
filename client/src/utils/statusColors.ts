// ============================================================
// RMPG Flex — Consolidated Status Color Tokens
// ============================================================
// Single source of truth for all status-related colors.
// Provides both Tailwind class strings (for badges/UI) and
// hex values (for maps, inline styles, canvas).
// ============================================================

import type { UnitStatus, CallStatus, CallPriority, IncidentStatus } from '../types';

// ── Unit Status ─────────────────────────────────────────────

export const UNIT_STATUS_HEX: Record<UnitStatus, string> = {
  available: '#22c55e',
  dispatched: '#f59e0b',
  enroute: '#3b82f6',
  onscene: '#a855f7',
  busy: '#ef4444',
  off_duty: '#6b7280',
};

export const UNIT_STATUS_CLASSES: Record<UnitStatus, string> = {
  available: 'bg-green-900/50 text-green-400 border border-green-700/50',
  dispatched: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  enroute: 'bg-brand-900/50 text-brand-400 border border-brand-700/50',
  onscene: 'bg-purple-900/50 text-purple-400 border border-purple-700/50',
  busy: 'bg-red-900/50 text-red-400 border border-red-700/50',
  off_duty: 'bg-rmpg-700/50 text-rmpg-400 border border-rmpg-600/50',
};

export const UNIT_STATUS_LABELS: Record<UnitStatus, string> = {
  available: 'Available',
  dispatched: 'Dispatched',
  enroute: 'En Route',
  onscene: 'On Scene',
  busy: 'Busy',
  off_duty: 'Off Duty',
};

export const UNIT_STATUS_ABBREV: Record<UnitStatus, string> = {
  available: 'AVL',
  dispatched: 'DSP',
  enroute: 'ENR',
  onscene: 'ONS',
  busy: 'BSY',
  off_duty: 'OFD',
};

// ── Call Priority ───────────────────────────────────────────

export const PRIORITY_HEX: Record<string, string> = {
  P1: '#dc2626',
  P2: '#f59e0b',
  P3: '#3b82f6',
  P4: '#6b7280',
};

export const PRIORITY_CLASSES: Record<CallPriority, string> = {
  P1: 'bg-red-900/50 text-red-400 border border-red-700/50',
  P2: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  P3: 'bg-brand-900/50 text-brand-400 border border-brand-700/50',
  P4: 'bg-rmpg-700/50 text-rmpg-300 border border-rmpg-600/50',
};

export const PRIORITY_LABELS: Record<CallPriority, string> = {
  P1: 'P1 - EMER',
  P2: 'P2 - URG',
  P3: 'P3 - RTN',
  P4: 'P4 - SCHED',
};

// ── Call Status ─────────────────────────────────────────────

export const CALL_STATUS_CLASSES: Record<CallStatus, string> = {
  pending: 'bg-yellow-900/50 text-yellow-400 border border-yellow-700/50',
  dispatched: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  enroute: 'bg-brand-900/50 text-brand-400 border border-brand-700/50',
  onscene: 'bg-purple-900/50 text-purple-400 border border-purple-700/50',
  cleared: 'bg-rmpg-600/50 text-rmpg-200 border border-rmpg-500/50',
  closed: 'bg-rmpg-700/50 text-rmpg-400 border border-rmpg-600/50',
  cancelled: 'bg-rmpg-700/50 text-rmpg-400 border border-rmpg-600/50',
  archived: 'bg-slate-800/50 text-slate-400 border border-slate-600/50',
  on_hold: 'bg-amber-900/50 text-amber-400 border border-amber-600/50 animate-pulse',
};

export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  pending: 'Pending',
  dispatched: 'Dispatched',
  enroute: 'En Route',
  onscene: 'On Scene',
  cleared: 'Cleared',
  closed: 'Closed',
  cancelled: 'Cancelled',
  archived: 'Archived',
  on_hold: 'HELD',
};

// ── Incident Status ─────────────────────────────────────────

export const INCIDENT_STATUS_CLASSES: Record<IncidentStatus, string> = {
  draft: 'bg-rmpg-700/50 text-rmpg-300 border border-rmpg-600/50',
  submitted: 'bg-brand-900/50 text-brand-400 border border-brand-700/50',
  under_review: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  approved: 'bg-green-900/50 text-green-400 border border-green-700/50',
  returned: 'bg-red-900/50 text-red-400 border border-red-700/50',
};

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  returned: 'Returned',
};
