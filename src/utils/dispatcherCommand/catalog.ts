// ============================================================
// Dispatcher Command Engine — tool catalog
// ============================================================
// The closed set of operations the planner may request. Every tool has a
// zod schema (the LLM's output is untrusted), a role list, and a
// destructive flag. Adding a CAD capability = adding a row here + a branch
// in compile.ts. The planner prompt is generated FROM this table, so the
// model can never be told about a tool that doesn't exist.

import { z } from 'zod';

export const WRITE_ROLES = ['dispatcher', 'supervisor', 'manager', 'admin'] as const;
export const CREATE_ROLES = ['officer', ...WRITE_ROLES] as const;
/** Merge/split restructure a call's identity — supervisor sign-off, per the routes' own guards. */
export const SUPERVISOR_ROLES = ['supervisor', 'manager', 'admin'] as const;
/** Hard delete is admin/manager only — mirrors calls.delete('/:id') exactly. */
export const DELETE_ROLES = ['admin', 'manager'] as const;
export const READ_ROLES = ['officer', 'dispatcher', 'supervisor', 'manager', 'admin', 'contract_manager', 'human_resources'] as const;

export const CALL_STATUSES = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled'] as const;
export const UNIT_STATUSES = ['available', 'dispatched', 'enroute', 'onscene', 'busy', 'off_duty', 'out_of_service'] as const;
export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export const LOOKUP_KINDS = ['plate', 'person', 'warrant', 'premise', 'vin'] as const;

/** A call reference the resolver turns into an id: number, suffix, or "selected". */
const callRef = z.string().min(1).max(40);
const unitRef = z.string().min(1).max(20);

export interface ToolDef {
  name: string;
  description: string;
  params: z.ZodTypeAny;
  roles: readonly string[];
  /**
   * Requires a Y/N confirmation turn before the client executes it.
   *
   * OPERATOR POLICY (set 2026-09-14): this gate is reserved for TRUE DELETES —
   * an operation that removes a record with no in-app way back. Everything
   * else, including clearing/closing a call, unassigning a unit, re-dispatching,
   * merging and bulk status writes, executes immediately: those are all
   * recoverable (status is re-settable, units re-assignable) and a confirmation
   * turn on routine radio traffic costs more than it protects.
   *
   * Do NOT set this true for "high impact but reversible". The narrower the
   * gate, the more a confirmation prompt actually means something.
   */
  destructive: boolean;
  /** Reads run on the server and fold their answer into `reply`. */
  serverRead?: boolean;
}

export const TOOLS: Record<string, ToolDef> = {
  create_call: {
    name: 'create_call',
    description: 'Create a new call for service. Needs an incident type and a location address; priority defaults to P3.',
    params: z.object({
      incident_type: z.string().min(1).max(80),
      location_address: z.string().min(3).max(200),
      priority: z.enum(PRIORITIES).optional(),
      description: z.string().max(2000).optional(),
      caller_name: z.string().max(120).optional(),
      caller_phone: z.string().max(40).optional(),
    }),
    roles: CREATE_ROLES,
    destructive: false,
  },
  update_call_fields: {
    name: 'update_call_fields',
    description: 'Set one or more fields on an existing call (caller name/phone, description, cross street, vehicle/subject description, weapons_involved, injuries_reported, case_number, court_name, etc.). Field names are snake_case CAD columns.',
    params: z.object({
      call: callRef,
      fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).refine(f => Object.keys(f).length > 0, 'at least one field'),
    }),
    roles: WRITE_ROLES,
    destructive: false,
  },
  set_call_status: {
    name: 'set_call_status',
    description: 'Change a call\'s status. Clearing/closing/cancelling REQUIRES a disposition (e.g. unfounded, report_taken, arrest, gone_on_arrival).',
    params: z.object({
      call: callRef,
      status: z.enum(CALL_STATUSES),
      disposition: z.string().max(120).optional(),
    }),
    roles: WRITE_ROLES,
    destructive: false, // computed per-status in compile.ts
  },
  assign_units: {
    name: 'assign_units',
    description: 'Assign / dispatch one or more units (by call-sign) to a call.',
    params: z.object({ call: callRef, units: z.array(unitRef).min(1).max(8) }),
    roles: WRITE_ROLES,
    destructive: false,
  },
  unassign_unit: {
    name: 'unassign_unit',
    description: 'Remove a unit from a call.',
    params: z.object({ call: callRef, unit: unitRef }),
    roles: WRITE_ROLES,
    destructive: false, // reversible — re-assign the unit
  },
  hold_call: {
    name: 'hold_call',
    description: 'Place a call on hold.',
    params: z.object({ call: callRef }),
    roles: WRITE_ROLES,
    destructive: false,
  },
  resume_call: {
    name: 'resume_call',
    description: 'Take a call off hold.',
    params: z.object({ call: callRef }),
    roles: WRITE_ROLES,
    destructive: false,
  },
  set_priority: {
    name: 'set_priority',
    description: 'Change a call\'s priority (P1 highest … P4 lowest).',
    params: z.object({ call: callRef, priority: z.enum(PRIORITIES), reason: z.string().max(200).optional() }),
    roles: WRITE_ROLES,
    destructive: false,
  },
  add_note: {
    name: 'add_note',
    description: 'Append a narrative note to a call.',
    params: z.object({ call: callRef, text: z.string().min(1).max(2000) }),
    roles: CREATE_ROLES,
    destructive: false,
  },
  set_unit_status: {
    name: 'set_unit_status',
    description: 'Set a unit\'s status (available/10-8, dispatched, enroute, onscene, busy, off_duty, out_of_service/10-7).',
    params: z.object({ unit: unitRef, status: z.enum(UNIT_STATUSES) }),
    roles: CREATE_ROLES,
    destructive: false,
  },
  create_bolo: {
    name: 'create_bolo',
    description: 'Issue a BOLO (be-on-the-lookout) for a person, vehicle, or other.',
    params: z.object({
      type: z.enum(['person', 'vehicle', 'other']).optional(),
      title: z.string().min(1).max(120),
      description: z.string().max(2000).optional(),
      priority: z.enum(PRIORITIES).optional(),
    }),
    roles: CREATE_ROLES,
    destructive: false,
  },
  redispatch: {
    name: 'redispatch',
    description: 'Re-dispatch a cleared PSO / process-service call as a new attempt.',
    params: z.object({ call: callRef }),
    roles: WRITE_ROLES,
    destructive: false, // creates a NEW linked call; undo_redispatch reverses it
  },
  undo_redispatch: {
    name: 'undo_redispatch',
    description: 'Undo the most recent re-dispatch / return visit on a call.',
    params: z.object({ call: callRef }),
    roles: WRITE_ROLES,
    destructive: false,
  },
  archive_call: {
    name: 'archive_call',
    description: 'Archive a call (removes it from the active board; reversible with unarchive).',
    params: z.object({ call: callRef }),
    roles: WRITE_ROLES,
    destructive: false,
  },
  unarchive_call: {
    name: 'unarchive_call',
    description: 'Restore an archived call to the active board.',
    params: z.object({ call: callRef }),
    roles: WRITE_ROLES,
    destructive: false,
  },
  merge_calls: {
    name: 'merge_calls',
    description: 'Merge one call into another (duplicate reports of the same incident). The source call is folded into the target.',
    params: z.object({ call: callRef, into: callRef }),
    roles: SUPERVISOR_ROLES,
    destructive: false,
  },
  split_call: {
    name: 'split_call',
    description: 'Split a call into one or more additional child calls, each with its own incident type (e.g. one scene that is both an assault and a stolen vehicle).',
    params: z.object({
      call: callRef,
      splits: z.array(z.object({
        incident_type: z.string().min(1).max(80),
        description: z.string().max(2000).optional(),
        location_address: z.string().max(200).optional(),
      })).min(1).max(5),
    }),
    roles: WRITE_ROLES,
    destructive: false,
  },
  notify_agency: {
    name: 'notify_agency',
    description: 'Record that an outside law-enforcement agency was notified on a call (e.g. SLCPD, UHP), with an optional agency case number.',
    params: z.object({ call: callRef, agency: z.string().max(200).optional(), case_number: z.string().max(100).optional() }),
    roles: WRITE_ROLES,
    destructive: false,
  },
  promote_to_incident: {
    name: 'promote_to_incident',
    description: 'Promote a call to a full incident report.',
    params: z.object({ call: callRef }),
    roles: CREATE_ROLES,
    destructive: false,
  },
  set_unit_mileage: {
    name: 'set_unit_mileage',
    description: 'Record a unit\'s current odometer reading.',
    params: z.object({ unit: unitRef, mileage: z.number().nonnegative().max(2_000_000) }),
    roles: WRITE_ROLES,
    destructive: false,
  },
  delete_call: {
    name: 'delete_call',
    description: 'PERMANENTLY delete a call for service and detach its records. Irreversible — use only for a call created in error. Prefer cancel or archive.',
    params: z.object({ call: callRef }),
    roles: DELETE_ROLES,
    destructive: true, // a true delete — the one thing that still asks Y/N
  },
  // ── Reads (server-side) ──
  lookup_record: {
    name: 'lookup_record',
    description: 'Run a record check: plate, person (name), warrant (name), premise (address), or vin.',
    params: z.object({ kind: z.enum(LOOKUP_KINDS), query: z.string().min(1).max(120) }),
    roles: READ_ROLES,
    destructive: false,
    serverRead: true,
  },
  call_status: {
    name: 'call_status',
    description: 'Read back the status, assigned units and disposition of a call.',
    params: z.object({ call: callRef }),
    roles: READ_ROLES,
    destructive: false,
    serverRead: true,
  },
  closest_unit: {
    name: 'closest_unit',
    description: 'Name the nearest available unit to an address.',
    params: z.object({ address: z.string().min(3).max(200) }),
    roles: READ_ROLES,
    destructive: false,
    serverRead: true,
  },
  unit_location: {
    name: 'unit_location',
    description: 'Where a unit is right now (GPS) and what it is doing.',
    params: z.object({ unit: unitRef }),
    roles: READ_ROLES,
    destructive: false,
    serverRead: true,
  },
  list_pending: {
    name: 'list_pending',
    description: 'List pending (unassigned) calls, highest priority first.',
    params: z.object({}),
    roles: READ_ROLES,
    destructive: false,
    serverRead: true,
  },
  list_units: {
    name: 'list_units',
    description: 'List units and their statuses (optionally one unit).',
    params: z.object({ unit: unitRef.optional() }),
    roles: READ_ROLES,
    destructive: false,
    serverRead: true,
  },
  lookup_code: {
    name: 'lookup_code',
    description: 'Look up a dispatch / ten-code (e.g. 10-71, CODE-3) and read back what it means.',
    params: z.object({ code: z.string().min(1).max(20) }),
    roles: READ_ROLES,
    destructive: false,
    serverRead: true,
  },
  premise_alerts: {
    name: 'premise_alerts',
    description: 'Read active premise alerts / hazards on file for an address before units arrive.',
    params: z.object({ address: z.string().min(3).max(200) }),
    roles: READ_ROLES,
    destructive: false,
    serverRead: true,
  },
  call_timeline: {
    name: 'call_timeline',
    description: 'Read back the audit timeline of a call — who did what and when.',
    params: z.object({ call: callRef }),
    roles: READ_ROLES,
    destructive: false,
    serverRead: true,
  },
  shift_summary: {
    name: 'shift_summary',
    description: 'Summarize the current shift: call volume by status and priority, and unit availability.',
    params: z.object({}),
    roles: READ_ROLES,
    destructive: false,
    serverRead: true,
  },
  // ── Console actions ──
  select_call: {
    name: 'select_call',
    description: 'Select / open a call on the dispatch board.',
    params: z.object({ call: callRef }),
    roles: READ_ROLES,
    destructive: false,
  },
  open_new_call: {
    name: 'open_new_call',
    description: 'Open the new-call form pre-filled (use when the user wants to enter a call interactively, or when a required field is missing).',
    params: z.object({ incident_type: z.string().max(80).optional(), location_address: z.string().max(200).optional(), description: z.string().max(2000).optional() }),
    roles: CREATE_ROLES,
    destructive: false,
  },
  open_ncic: {
    name: 'open_ncic',
    description: 'Open the NCIC query panel for a person, vehicle, or warrant search.',
    params: z.object({ type: z.enum(['person', 'vehicle', 'warrant']), query: z.string().min(1).max(120) }),
    roles: READ_ROLES,
    destructive: false,
  },
  navigate: {
    name: 'navigate',
    description: 'Go to a console page: dispatch, map, records, warrants, bolos (communications), field-interviews, trespass-orders, plate-log, radio, fleet, reports.',
    params: z.object({ page: z.string().min(1).max(40) }),
    roles: READ_ROLES,
    destructive: false,
  },
  help: {
    name: 'help',
    description: 'Show what the dispatcher can do.',
    params: z.object({}),
    roles: READ_ROLES,
    destructive: false,
  },
};

export const NAV_PAGES: Record<string, string> = {
  dispatch: '/dispatch',
  map: '/map',
  records: '/records',
  warrants: '/warrants',
  bolos: '/communications',
  communications: '/communications',
  'field-interviews': '/field-interviews',
  'trespass-orders': '/trespass-orders',
  'plate-log': '/plate-log',
  radio: '/radio',
  fleet: '/fleet',
  reports: '/reports',
  intel: '/intel',
  admin: '/admin',
};

export interface ValidatedToolCall {
  tool: string;
  params: Record<string, unknown>;
  def: ToolDef;
}

export interface ToolValidationError { tool: string; error: string }

/**
 * Validate a raw tool call against the catalog and the caller's role.
 * Pure. Unknown tools and bad params are reported, never thrown.
 */
export function validateToolCall(
  raw: { tool: unknown; params?: unknown },
  role: string,
): { ok: true; call: ValidatedToolCall } | { ok: false; error: ToolValidationError } {
  const tool = typeof raw.tool === 'string' ? raw.tool.trim() : '';
  const def = TOOLS[tool];
  if (!def) return { ok: false, error: { tool, error: `unknown tool "${tool}"` } };
  if (!def.roles.includes(role)) {
    return { ok: false, error: { tool, error: `role "${role}" may not ${tool.replace(/_/g, ' ')}` } };
  }
  const parsed = def.params.safeParse(raw.params ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    return { ok: false, error: { tool, error: `${where}${issue?.message ?? 'invalid parameters'}` } };
  }
  return { ok: true, call: { tool, params: parsed.data as Record<string, unknown>, def } };
}

/** Human list of tools for HELP output and the planner prompt. */
export function describeCatalog(role: string): string {
  return Object.values(TOOLS)
    .filter(t => t.roles.includes(role))
    .map(t => `- ${t.name}: ${t.description}`)
    .join('\n');
}
