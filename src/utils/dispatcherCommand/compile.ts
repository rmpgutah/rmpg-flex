// ============================================================
// Dispatcher Command Engine — compile tool calls into steps
// ============================================================
// Pure. A validated tool call + resolved refs → the exact HTTP step(s) the
// client will execute (or a console action). Every emitted path must match
// ALLOWED_PATHS — this is the security boundary between "what the model
// asked for" and "what may hit the API".

import { UPDATABLE_CALL_COLUMNS_BASE, UPDATABLE_CALL_COLUMNS_EXT } from '../../routes/dispatch/callColumns';
import { NAV_PAGES, type ValidatedToolCall } from './catalog';
import type { ClientAction, HttpStep, PlanStep } from './types';

export interface ResolvedCall { id: number; call_number: string; status?: string }
export interface ResolvedUnit { id: number; call_sign: string; status?: string }

export interface ResolvedRefs {
  /** keyed by the ref string exactly as it appeared in params */
  calls: Record<string, ResolvedCall>;
  units: Record<string, ResolvedUnit>;
}

export const ALLOWED_PATHS: RegExp[] = [
  /^\/dispatch\/calls$/,
  /^\/dispatch\/calls\/\d+$/,
  // Board-wide writes. Both are admin/manager in the route AND in the catalog.
  /^\/dispatch\/calls\/(force-close-all|bulk-reassign)$/,
  /^\/dispatch\/calls\/\d+\/(status|dispatch|unassign-unit|hold|resume|escalate|redispatch|undo-redispatch|archive|unarchive|merge-into|split|le-notification|promote-to-incident)$/,
  /^\/dispatch\/units\/\d+\/(status|mileage)$/,
  /^\/comms\/bolos$/,
];

export function isAllowedPath(path: string): boolean {
  return ALLOWED_PATHS.some(re => re.test(path));
}

/** Columns a natural-language "set X on call" may touch. Never a superset of the route's allowlist. */
export const COMMAND_EDITABLE_COLUMNS = new Set<string>(
  [...UPDATABLE_CALL_COLUMNS_BASE, ...UPDATABLE_CALL_COLUMNS_EXT].filter(c =>
    // Structural / lifecycle columns the engine must not touch directly.
    !['status', 'assigned_unit_ids', 'unit_call_signs', 'dispatcher_id', 'created_at', 'previous_status',
      'status_changed_at', 'archived_at', 'priority_score', 'notes'].includes(c)),
);

// NOTE: clearing / closing / cancelling a call used to raise the confirmation
// gate. Per operator policy (2026-09-14) the Y/N turn is reserved for TRUE
// DELETES only — a status is re-settable from the board, so gating the single
// most common radio transmission ("clear me from 42") behind a confirmation
// turn bought nothing and cost a round-trip on every call. See ToolDef.destructive.

export class CompileError extends Error {
  constructor(message: string) { super(message); this.name = 'CompileError'; }
}

function http(method: HttpStep['method'], path: string, summary: string, body?: Record<string, unknown>, destructive = false): HttpStep {
  if (!isAllowedPath(path)) throw new CompileError(`path not allowed: ${path}`);
  return { kind: 'http', method, path, body, summary, destructive };
}

function client(action: ClientAction['action'], payload: Record<string, unknown>, summary: string): ClientAction {
  return { kind: 'client', action, payload, summary };
}

function needCall(refs: ResolvedRefs, ref: unknown): ResolvedCall {
  const key = String(ref ?? '');
  const c = refs.calls[key];
  if (!c) throw new CompileError(`call "${key}" not found`);
  return c;
}

function needUnit(refs: ResolvedRefs, ref: unknown): ResolvedUnit {
  const key = String(ref ?? '').toUpperCase();
  const u = refs.units[key] ?? refs.units[String(ref ?? '')];
  if (!u) throw new CompileError(`unit "${key}" not found`);
  return u;
}

/**
 * Compile one validated tool call. Server-side reads (`def.serverRead`) are
 * NOT compiled here — the route runs them and folds the text into `reply`.
 */
export function compileToolCall(call: ValidatedToolCall, refs: ResolvedRefs, author: string): PlanStep[] {
  const p = call.params as Record<string, any>;
  switch (call.tool) {
    case 'create_call': {
      const body: Record<string, unknown> = {
        incident_type: String(p.incident_type).trim().toLowerCase().replace(/\s+/g, '_'),
        priority: p.priority ?? 'P3',
        location_address: String(p.location_address).trim(),
        source: 'dispatcher_command',
      };
      for (const k of ['description', 'caller_name', 'caller_phone'] as const) if (p[k]) body[k] = p[k];
      return [
        http('POST', '/dispatch/calls', `Create ${body.priority} ${body.incident_type} call at ${body.location_address}`, body),
        client('refresh', {}, 'Refresh board'),
      ];
    }
    case 'update_call_fields': {
      const c = needCall(refs, p.call);
      const fields: Record<string, unknown> = {};
      const rejected: string[] = [];
      for (const [k, v] of Object.entries(p.fields as Record<string, unknown>)) {
        const col = k.trim().toLowerCase().replace(/\s+/g, '_');
        if (COMMAND_EDITABLE_COLUMNS.has(col)) fields[col] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
        else rejected.push(k);
      }
      if (Object.keys(fields).length === 0) {
        throw new CompileError(`no editable field in: ${rejected.join(', ')}`);
      }
      const summary = `Update ${c.call_number}: ${Object.entries(fields).map(([k, v]) => `${k}=${String(v)}`).join(', ')}` +
        (rejected.length ? ` (skipped ${rejected.join(', ')})` : '');
      return [http('PUT', `/dispatch/calls/${c.id}`, summary, fields), client('refresh', {}, 'Refresh board')];
    }
    case 'set_call_status': {
      const c = needCall(refs, p.call);
      const body: Record<string, unknown> = { status: p.status };
      if (p.disposition) body.disposition = String(p.disposition).trim().toLowerCase().replace(/\s+/g, '_');
      return [
        http('POST', `/dispatch/calls/${c.id}/status`, `${c.call_number} → ${String(p.status).toUpperCase()}${body.disposition ? ` (${body.disposition})` : ''}`, body),
        client('refresh', {}, 'Refresh board'),
      ];
    }
    case 'assign_units': {
      const c = needCall(refs, p.call);
      const units = (p.units as string[]).map(u => needUnit(refs, u));
      return [
        http('POST', `/dispatch/calls/${c.id}/dispatch`, `Dispatch ${units.map(u => u.call_sign).join(', ')} to ${c.call_number}`, { unit_ids: units.map(u => u.id) }),
        client('refresh', {}, 'Refresh board'),
      ];
    }
    case 'unassign_unit': {
      const c = needCall(refs, p.call);
      const u = needUnit(refs, p.unit);
      return [
        http('POST', `/dispatch/calls/${c.id}/unassign-unit`, `Remove ${u.call_sign} from ${c.call_number}`, { unit_id: u.id }),
        client('refresh', {}, 'Refresh board'),
      ];
    }
    case 'hold_call': {
      const c = needCall(refs, p.call);
      return [http('POST', `/dispatch/calls/${c.id}/hold`, `${c.call_number} ON HOLD`), client('refresh', {}, 'Refresh board')];
    }
    case 'resume_call': {
      const c = needCall(refs, p.call);
      return [http('POST', `/dispatch/calls/${c.id}/resume`, `${c.call_number} RESUMED`), client('refresh', {}, 'Refresh board')];
    }
    case 'set_priority': {
      const c = needCall(refs, p.call);
      const body: Record<string, unknown> = { new_priority: p.priority };
      if (p.reason) body.reason = p.reason;
      return [http('POST', `/dispatch/calls/${c.id}/escalate`, `${c.call_number} priority → ${p.priority}`, body), client('refresh', {}, 'Refresh board')];
    }
    case 'add_note': {
      const c = needCall(refs, p.call);
      return [client('append_note', { call_id: c.id, call_number: c.call_number, text: p.text, author }, `Note on ${c.call_number}: "${String(p.text).slice(0, 60)}"`)];
    }
    case 'set_unit_status': {
      const u = needUnit(refs, p.unit);
      return [http('PUT', `/dispatch/units/${u.id}/status`, `${u.call_sign} → ${String(p.status).toUpperCase()}`, { status: p.status }), client('refresh', {}, 'Refresh board')];
    }
    case 'create_bolo': {
      const body = {
        type: p.type ?? 'other',
        title: String(p.title).slice(0, 120),
        description: p.description ?? p.title,
        priority: p.priority ?? 'P3',
        status: 'active',
      };
      return [http('POST', '/comms/bolos', `BOLO: ${body.title}`, body)];
    }
    case 'redispatch': {
      const c = needCall(refs, p.call);
      return [http('POST', `/dispatch/calls/${c.id}/redispatch`, `Re-dispatch ${c.call_number}`, {}), client('refresh', {}, 'Refresh board')];
    }
    case 'undo_redispatch': {
      const c = needCall(refs, p.call);
      return [http('POST', `/dispatch/calls/${c.id}/undo-redispatch`, `Undo return visit on ${c.call_number}`, {}), client('refresh', {}, 'Refresh board')];
    }
    case 'archive_call': {
      const c = needCall(refs, p.call);
      return [http('POST', `/dispatch/calls/${c.id}/archive`, `Archive ${c.call_number}`), client('refresh', {}, 'Refresh board')];
    }
    case 'unarchive_call': {
      const c = needCall(refs, p.call);
      return [http('POST', `/dispatch/calls/${c.id}/unarchive`, `Restore ${c.call_number} to the board`), client('refresh', {}, 'Refresh board')];
    }
    case 'merge_calls': {
      const src = needCall(refs, p.call);
      const target = needCall(refs, p.into);
      if (src.id === target.id) throw new CompileError('cannot merge a call into itself');
      return [
        http('POST', `/dispatch/calls/${src.id}/merge-into`, `Merge ${src.call_number} into ${target.call_number}`, { target_call_id: target.id }),
        client('refresh', {}, 'Refresh board'),
      ];
    }
    case 'split_call': {
      const c = needCall(refs, p.call);
      const splits = (p.splits as Array<Record<string, unknown>>).map(s => {
        const out: Record<string, unknown> = {
          incident_type: String(s.incident_type).trim().toLowerCase().replace(/\s+/g, '_'),
        };
        if (s.description) out.description = s.description;
        if (s.location_address) out.location_address = s.location_address;
        return out;
      });
      return [
        http('POST', `/dispatch/calls/${c.id}/split`, `Split ${c.call_number} into ${splits.map(s => String(s.incident_type)).join(', ')}`, { splits }),
        client('refresh', {}, 'Refresh board'),
      ];
    }
    case 'notify_agency': {
      const c = needCall(refs, p.call);
      const body: Record<string, unknown> = {};
      if (p.agency) body.agency = String(p.agency).trim();
      if (p.case_number) body.case_number = String(p.case_number).trim();
      return [
        http('POST', `/dispatch/calls/${c.id}/le-notification`, `${c.call_number}: notified ${body.agency ?? 'Local PD'}${body.case_number ? ` (case ${body.case_number})` : ''}`, body),
        client('refresh', {}, 'Refresh board'),
      ];
    }
    case 'promote_to_incident': {
      const c = needCall(refs, p.call);
      return [http('POST', `/dispatch/calls/${c.id}/promote-to-incident`, `Promote ${c.call_number} to an incident report`, {}), client('refresh', {}, 'Refresh board')];
    }
    case 'set_unit_mileage': {
      const u = needUnit(refs, p.unit);
      return [http('PUT', `/dispatch/units/${u.id}/mileage`, `${u.call_sign} odometer → ${Number(p.mileage).toLocaleString()} mi`, { mileage: Number(p.mileage) })];
    }
    case 'bulk_reassign': {
      const u = needUnit(refs, p.unit);
      const calls = (p.calls as string[]).map(ref => needCall(refs, ref));
      // De-dupe: "reassign 42, 0042 and 43" resolves two refs to one call, and
      // the route would otherwise count it twice in its chunked IN-list.
      const ids = [...new Set(calls.map(c => c.id))];
      return [
        http('POST', '/dispatch/calls/bulk-reassign',
          `Reassign ${ids.length} call${ids.length === 1 ? '' : 's'} (${calls.map(c => c.call_number).join(', ')}) to ${u.call_sign}`,
          { call_ids: ids, unit_id: u.id }),
        client('refresh', {}, 'Refresh board'),
      ];
    }
    case 'force_close_all': {
      const body: Record<string, unknown> = {};
      if (p.disposition) body.disposition = String(p.disposition).trim().toLowerCase().replace(/\s+/g, '_');
      // The summary is what the dispatcher sees in the command bar and HEARS
      // read back on the voice path, so it has to say "ALL" out loud — this
      // step is not scoped to a selection and runs without a confirmation turn.
      return [
        http('POST', '/dispatch/calls/force-close-all',
          `Close ALL active calls on the board${body.disposition ? ` (${body.disposition})` : ''} and release every unit`, body),
        client('refresh', {}, 'Refresh board'),
      ];
    }
    case 'delete_call': {
      const c = needCall(refs, p.call);
      return [
        http('DELETE', `/dispatch/calls/${c.id}`, `PERMANENTLY DELETE ${c.call_number}`, undefined, true),
        client('refresh', {}, 'Refresh board'),
      ];
    }
    case 'select_call': {
      const c = needCall(refs, p.call);
      return [client('select_call', { call_id: c.id, call_number: c.call_number }, `Select ${c.call_number}`)];
    }
    case 'open_new_call':
      return [client('open_new_call', { incident_type: p.incident_type, location_address: p.location_address, description: p.description }, 'Open new-call form')];
    case 'open_ncic':
      return [client('open_ncic', { type: p.type, query: p.query }, `NCIC ${p.type}: ${p.query}`)];
    case 'navigate': {
      const key = String(p.page).toLowerCase().replace(/\s+/g, '-');
      const path = NAV_PAGES[key];
      if (!path) throw new CompileError(`unknown page "${p.page}"`);
      return [client('navigate', { path }, `Go to ${key}`)];
    }
    case 'help':
      return [client('show_help', {}, 'Help')];
    default:
      if (call.def.serverRead) return [];
      throw new CompileError(`no compiler for ${call.tool}`);
  }
}

/** Collect the call / unit refs a set of tool calls mention, for the resolver. */
export function collectRefs(calls: ValidatedToolCall[]): { callRefs: string[]; unitRefs: string[] } {
  const callRefs = new Set<string>();
  const unitRefs = new Set<string>();
  for (const c of calls) {
    const p = c.params as Record<string, unknown>;
    if (typeof p.call === 'string') callRefs.add(p.call);
    // merge_calls carries a SECOND call ref. Without this the target never
    // reaches the resolver and every merge dies in needCall().
    if (typeof p.into === 'string') callRefs.add(p.into);
    // bulk_reassign carries an ARRAY of call refs — same trap as `into` above.
    if (Array.isArray(p.calls)) for (const r of p.calls) if (typeof r === 'string') callRefs.add(r);
    if (typeof p.unit === 'string') unitRefs.add(p.unit);
    if (Array.isArray(p.units)) for (const u of p.units) if (typeof u === 'string') unitRefs.add(u);
  }
  return { callRefs: [...callRefs], unitRefs: [...unitRefs] };
}
