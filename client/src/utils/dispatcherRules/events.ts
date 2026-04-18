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

// Some existing server broadcasts wrap the record under a key (e.g.
// citations emit `{action: 'citation_issued', citation: {...}}` and
// arrests emit `{action: 'arrest_created', arrest: {...}}`) while
// newer broadcasts use a flat shape (`{action, field1, field2}`).
// Rules tolerate BOTH so we don't have to change the existing
// production broadcast contracts that non-brain UI consumers depend on.
function pick(payload: any, wrapperKey: string): any {
  if (!payload) return {};
  return payload[wrapperKey] ?? payload;
}

export const EVENT_RULES: DispatcherRule[] = [
  // ─── Citations ────────────────────────────────────────────
  // Server already broadcasts action='citation_issued' with nested
  // { citation: {citation_number, subject_name, violation, officer_name} }.
  {
    id: 'citation-issued',
    trigger: 'event',
    eventTypes: ['citation_issued', 'citation_created'],
    match: (ctx) => !!pick(ctx.event?.payload, 'citation').citation_number,
    severity: 'minor',
    cooldownMs: 0,
    entityKey: (ctx) => String(pick(ctx.event?.payload, 'citation').citation_number ?? 'global'),
    compose: (ctx) => {
      const c = pick(ctx.event!.payload, 'citation');
      const by = c.officer_name ?? c.officer_call_sign;
      const byClause = by ? ` by ${by}` : '';
      const fine = c.fine_amount != null ? `, $${c.fine_amount} fine` : '';
      return `Citation ${c.citation_number} issued${byClause}${fine}.`;
    },
  },

  // ─── Incidents ────────────────────────────────────────────
  {
    id: 'incident-created',
    trigger: 'event',
    eventTypes: ['incident_created'],
    match: (ctx) => !!pick(ctx.event?.payload, 'incident').incident_number,
    severity: 'minor',
    cooldownMs: 0,
    entityKey: (ctx) => String(pick(ctx.event?.payload, 'incident').incident_number ?? 'global'),
    compose: (ctx) => {
      const p = pick(ctx.event!.payload, 'incident');
      const from = p.source_call ? ` from call ${p.source_call}` : '';
      return `Incident ${p.incident_number} opened${from}.`;
    },
  },

  // ─── Warrants ─────────────────────────────────────────────
  {
    id: 'warrant-entered',
    trigger: 'event',
    eventTypes: ['warrant_entered'],
    match: (ctx) => !!pick(ctx.event?.payload, 'warrant').subject_name,
    severity: 'moderate',
    cooldownMs: 0,
    entityKey: (ctx) => String(pick(ctx.event?.payload, 'warrant').warrant_id ?? 'global'),
    compose: (ctx) => {
      const p = pick(ctx.event!.payload, 'warrant');
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
    match: (ctx) => !!pick(ctx.event?.payload, 'evidence').tag_number,
    severity: 'minor',
    cooldownMs: 0,
    entityKey: (ctx) => String(pick(ctx.event?.payload, 'evidence').tag_number ?? 'global'),
    compose: (ctx) => {
      const p = pick(ctx.event!.payload, 'evidence');
      const forCase = p.case_number ? ` for case ${p.case_number}` : '';
      return `Evidence tag ${p.tag_number} logged${forCase}.`;
    },
  },

  // ─── Arrests ──────────────────────────────────────────────
  // Server already broadcasts action='arrest_created' with nested
  // { arrest: {id, subject_name, charge, booking_number, officer_name} }.
  {
    id: 'arrest-booked',
    trigger: 'event',
    eventTypes: ['arrest_created'],
    match: (ctx) => !!pick(ctx.event?.payload, 'arrest').subject_name,
    severity: 'moderate',
    cooldownMs: 0,
    entityKey: (ctx) => String(pick(ctx.event?.payload, 'arrest').id ?? pick(ctx.event?.payload, 'arrest').arrest_id ?? 'global'),
    compose: (ctx) => {
      const p = pick(ctx.event!.payload, 'arrest');
      const charge = p.charge ?? 'charges pending';
      const by = p.officer_name ?? p.officer_call_sign;
      const byClause = by ? `, by ${by}` : '';
      return `Arrest booked: ${p.subject_name}, ${charge}${byClause}.`;
    },
  },

  // ─── HR leave approval ────────────────────────────────────
  {
    id: 'hr-approval',
    trigger: 'event',
    eventTypes: ['leave_approved'],
    match: (ctx) => !!pick(ctx.event?.payload, 'leave').officer_name,
    severity: 'minor',
    cooldownMs: 0,
    entityKey: (ctx) => String(pick(ctx.event?.payload, 'leave').leave_id ?? pick(ctx.event?.payload, 'leave').id ?? 'global'),
    compose: (ctx) => {
      const p = pick(ctx.event!.payload, 'leave');
      return `Leave request approved for ${p.officer_name}.`;
    },
  },
];
