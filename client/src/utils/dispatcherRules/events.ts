// ============================================================
// Dispatcher Brain — Event Rules (Phase 2)
//
// Rules that fire when the server broadcasts a non-dispatch
// mutation via WebSocket. Kept deliberately short-form: most live
// at 'minor' severity with no cooldown because the events are
// naturally infrequent (one per mutation) and the per-rule
// entityKey prevents edit storms from re-speaking.
//
// The 6 rules here match 1:1 with the 6 server mutation sites
// Task 2.7 will wire up (citations, incidents, warrants, evidence,
// arrests, HR leave approvals).
// ============================================================

import type { DispatcherRule } from './types';

export const EVENT_RULES: DispatcherRule[] = [
  // ─── Citations ────────────────────────────────────────────
  {
    id: 'citation-issued',
    trigger: 'event',
    eventTypes: ['citation_created'],
    match: (ctx) => !!ctx.event?.payload?.citation_number,
    severity: 'minor',
    cooldownMs: 0,
    entityKey: (ctx) => ctx.event?.payload?.citation_number ?? 'global',
    compose: (ctx) => {
      const p = ctx.event!.payload;
      const by = p.officer_call_sign ? ` by ${p.officer_call_sign}` : '';
      const fine = p.fine_amount != null ? `, $${p.fine_amount} fine` : '';
      return `Citation ${p.citation_number} issued${by}${fine}.`;
    },
  },

  // ─── Incidents ────────────────────────────────────────────
  {
    id: 'incident-created',
    trigger: 'event',
    eventTypes: ['incident_created'],
    match: (ctx) => !!ctx.event?.payload?.incident_number,
    severity: 'minor',
    cooldownMs: 0,
    entityKey: (ctx) => ctx.event?.payload?.incident_number ?? 'global',
    compose: (ctx) => {
      const p = ctx.event!.payload;
      const from = p.source_call ? ` from call ${p.source_call}` : '';
      return `Incident ${p.incident_number} opened${from}.`;
    },
  },

  // ─── Warrants ─────────────────────────────────────────────
  {
    id: 'warrant-entered',
    trigger: 'event',
    eventTypes: ['warrant_entered'],
    match: (ctx) => !!ctx.event?.payload?.subject_name,
    severity: 'moderate',
    cooldownMs: 0,
    entityKey: (ctx) => String(ctx.event?.payload?.warrant_id ?? 'global'),
    compose: (ctx) => {
      const p = ctx.event!.payload;
      const cls = p.offense_class ?? 'offense class unknown';
      const bail = p.bail_amount != null ? `, $${p.bail_amount} bail` : '';
      return `New warrant on ${p.subject_name}, ${cls}${bail}.`;
    },
  },

  // ─── Evidence ─────────────────────────────────────────────
  {
    id: 'evidence-logged',
    trigger: 'event',
    eventTypes: ['evidence_logged'],
    match: (ctx) => !!ctx.event?.payload?.tag_number,
    severity: 'minor',
    cooldownMs: 0,
    entityKey: (ctx) => ctx.event?.payload?.tag_number ?? 'global',
    compose: (ctx) => {
      const p = ctx.event!.payload;
      const forCase = p.case_number ? ` for case ${p.case_number}` : '';
      return `Evidence tag ${p.tag_number} logged${forCase}.`;
    },
  },

  // ─── Arrests ──────────────────────────────────────────────
  {
    id: 'arrest-booked',
    trigger: 'event',
    eventTypes: ['arrest_created'],
    match: (ctx) => !!ctx.event?.payload?.subject_name,
    severity: 'moderate',
    cooldownMs: 0,
    entityKey: (ctx) => String(ctx.event?.payload?.arrest_id ?? 'global'),
    compose: (ctx) => {
      const p = ctx.event!.payload;
      const charge = p.charge ?? 'charges pending';
      const by = p.officer_call_sign ? `, by ${p.officer_call_sign}` : '';
      return `Arrest booked: ${p.subject_name}, ${charge}${by}.`;
    },
  },

  // ─── HR leave approval ────────────────────────────────────
  {
    id: 'hr-approval',
    trigger: 'event',
    eventTypes: ['leave_approved'],
    match: (ctx) => !!ctx.event?.payload?.officer_name,
    severity: 'minor',
    cooldownMs: 0,
    entityKey: (ctx) => String(ctx.event?.payload?.leave_id ?? 'global'),
    compose: (ctx) => `Leave request approved for ${ctx.event!.payload.officer_name}.`,
  },
];
