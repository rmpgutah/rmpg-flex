// ============================================================
// RMPG Flex — CAD Command Line Parser
// Parses shorthand dispatch commands and returns structured
// actions for the DispatchPage to execute.
// Grammar: VERB [ARGS...]
// ============================================================

import { apiFetch } from '../hooks/useApi';

// ─── Types ──────────────────────────────────────────────────

export type CommandAction =
  | { type: 'new_call'; incidentType?: string; location?: string }
  | { type: 'assign_unit'; callSign: string; callNumber: string }
  | { type: 'set_status'; callSign: string; status: string }
  | { type: 'clear_call'; callNumber: string }
  | { type: 'query_person'; query: string }
  | { type: 'query_vehicle'; query: string }
  | { type: 'query_warrant'; query: string }
  | { type: 'premise_history'; address: string }
  | { type: 'dispatch_units'; callNumber: string; unitCallSigns: string[] }
  | { type: 'add_note'; callNumber: string; note: string }
  | { type: 'change_priority'; callNumber: string; priority: string }
  | { type: 'unit_status_check'; callSign?: string }
  | { type: 'create_bolo'; description: string }
  | { type: 'query_bolo'; query: string }
  | { type: 'new_fi'; location?: string }
  | { type: 'query_trespass'; query: string }
  | { type: 'hold_call'; callNumber: string; resume?: boolean }
  | { type: 'promote_incident'; callNumber: string }
  | { type: 'le_notify'; callNumber: string; agency?: string }
  | { type: 'select_call'; callId: string; callNumber: string }
  | { type: 'set_mileage'; callSign: string; mileageType: 'start' | 'end'; value: number }
  | { type: 'voice_status'; callSign?: string }
  | { type: 'voice_check'; callNumber: string }
  | { type: 'voice_eta'; callSign: string }
  | { type: 'voice_weather' }
  | { type: 'voice_time' }
  | { type: 'voice_ack' }
  | { type: 'voice_allclear'; callNumber?: string }
  | { type: 'voice_summary' }
  | { type: 'voice_locate'; callSign: string }
  | { type: 'voice_serve'; callNumber: string }
  | { type: 'voice_deadline'; callNumber: string }
  | { type: 'voice_stack' }
  | { type: 'voice_units' }
  | { type: 'voice_pending' }
  | { type: 'voice_priority' }
  | { type: 'lookup_code'; code: string; result?: { description: string; priority: string; category: string; requires_backup: boolean; officer_safety: boolean; ems_needed: boolean; fire_needed: boolean } }
  | { type: 'premise_alert'; address: string; alerts?: { title: string; alert_type: string; alert_level: string; description?: string }[] }
  | { type: 'redispatch'; callNumber: string; unitCallSigns: string[] }
  | { type: 'escalate_priority'; callNumber: string }
  | { type: 'deescalate_priority'; callNumber: string }
  | { type: 'request_backup'; callNumber: string; count: number }
  | { type: 'transfer_call'; callNumber: string; dispatcher: string }
  | { type: 'show_timeline'; callNumber: string }
  | { type: 'show_workload'; callSign?: string }
  | { type: 'show_hotspots' }
  | { type: 'show_coverage' }
  | { type: 'show_nearby'; callNumber: string }
  | { type: 'supervisor_review'; callNumber: string; notes: string }
  | { type: 'manage_premise_alert'; address: string }
  | { type: 'show_shift_summary' }
  | { type: 'check_recurring'; address: string }
  | { type: 'cross_reference'; query: string }
  | { type: 'handoff'; shiftType: string }
  | { type: 'mutual_aid'; agency: string; reason?: string }
  | { type: 'narrative'; callId: string; text: string }
  | { type: 'quality_metrics'; days?: number }
  | { type: 'show_help' }
  | { type: 'none' };

export interface CommandResult {
  success: boolean;
  message: string;
  action: CommandAction;
}

// ─── Status code mapping ────────────────────────────────────

const STATUS_MAP: Record<string, string> = {
  AVL: 'available',
  AVAIL: 'available',
  ENR: 'enroute',
  ENROUTE: 'enroute',
  ONS: 'onscene',
  ONSCENE: 'onscene',
  BSY: 'busy',
  BUSY: 'busy',
  OOD: 'off_duty',
  OFF: 'off_duty',
  DIS: 'dispatched',
  DISP: 'dispatched',
};

// ─── Command definitions ────────────────────────────────────

const COMMANDS: Record<string, { usage: string; desc: string }> = {
  NC:   { usage: 'NC <type> <location>',      desc: 'New Call — opens call form pre-filled' },
  CI:   { usage: 'CI <call#>',               desc: 'Call Info — select/focus a call by number' },
  AS:   { usage: 'AS <unit> <call#>',          desc: 'Assign unit to call' },
  DU:   { usage: 'DU <call#> <unit1> [unit2]', desc: 'Dispatch units to call (multi-assign)' },
  ST:   { usage: 'ST <unit> <status>',         desc: 'Set unit status (AVL/ENR/ONS/BSY)' },
  US:   { usage: 'US [unit]',                  desc: 'Unit status check (all or specific)' },
  CL:   { usage: 'CL <call#> [disp]',          desc: 'Clear call with optional disposition' },
  HD:   { usage: 'HD <call#> [R]',             desc: 'Hold call (HD call# R to resume)' },
  ML:   { usage: 'ML <unit> <start|end> <mi>', desc: 'Log mileage for unit (start or end)' },
  NT:   { usage: 'NT <call#> <note text>',     desc: 'Add note/narrative to call' },
  PRI:  { usage: 'PRI <call#> <P1-P4>',       desc: 'Change call priority' },
  QP:   { usage: 'QP <name>',                 desc: 'Query person (NCIC)' },
  QV:   { usage: 'QV <plate>',                desc: 'Query vehicle (NCIC)' },
  QW:   { usage: 'QW <name>',                 desc: 'Query warrants (NCIC)' },
  PR:   { usage: 'PR <address>',              desc: 'Premise history lookup' },
  BO:   { usage: 'BO <description>',          desc: 'Create BOLO alert' },
  QB:   { usage: 'QB [search]',               desc: 'Query active BOLOs' },
  FI:   { usage: 'FI [location]',             desc: 'New Field Interview card' },
  QT:   { usage: 'QT <name or address>',      desc: 'Query trespass orders' },
  PI:   { usage: 'PI <call#>',               desc: 'Promote call to incident report' },
  LE:   { usage: 'LE <call#> [agency]',      desc: 'Notify external agency' },
  STATUS: { usage: 'STATUS [unit]',          desc: 'Voice announce unit status' },
  CHECK: { usage: 'CHECK <call#>',          desc: 'Voice read-back call details' },
  ETA:  { usage: 'ETA <unit>',              desc: 'Voice announce unit ETA' },
  WEATHER: { usage: 'WEATHER',              desc: 'Voice announce weather' },
  TIME: { usage: 'TIME',                    desc: 'Voice announce current time' },
  ACK:  { usage: 'ACK or 10-4',            desc: 'Play acknowledgment tone' },
  'ALL-CLEAR': { usage: 'ALL-CLEAR [call#]', desc: 'Announce all-clear on call' },
  SUMMARY:  { usage: 'SUMMARY or SHIFT',       desc: 'Voice announce shift summary stats' },
  LOCATE:   { usage: 'LOCATE <unit>',           desc: 'Announce unit last known GPS location' },
  SERVE:    { usage: 'SERVE <call#>',           desc: 'Announce serve details (doc, subject, attempts)' },
  DEADLINE: { usage: 'DEADLINE <call#>',        desc: 'Announce 72hr deadline status' },
  STACK:    { usage: 'STACK',                   desc: 'Announce stacked calls at selected location' },
  UNITS:    { usage: 'UNITS',                   desc: 'Announce all unit statuses' },
  PENDING:  { usage: 'PENDING',                 desc: 'Announce pending call count and details' },
  PRIORITY: { usage: 'PRIORITY',                desc: 'Announce calls by priority breakdown' },
  CODE: { usage: 'CODE <10-code>',              desc: 'Lookup dispatch code (10-71, CODE-3, etc.)' },
  PA:   { usage: 'PA <address>',                desc: 'Manage premise alert for address' },
  RD:   { usage: 'RD <call#> <unit1> [unit2]', desc: 'Redispatch — reassign units to call' },
  ESC:  { usage: 'ESC <call#>',               desc: 'Escalate call priority' },
  DESC: { usage: 'DESC <call#>',              desc: 'De-escalate call priority' },
  BK:   { usage: 'BK <call#> [count]',        desc: 'Request backup for call' },
  TR:   { usage: 'TR <call#> <dispatcher>',   desc: 'Transfer call to another dispatcher' },
  TL:   { usage: 'TL <call#>',               desc: 'Show call timeline' },
  WL:   { usage: 'WL [unit]',                desc: 'Show workload (all or specific unit)' },
  HS:   { usage: 'HS',                        desc: 'Show hot spots map' },
  CV:   { usage: 'CV',                        desc: 'Show unit coverage map' },
  NB:   { usage: 'NB <call#>',               desc: 'Show nearby calls' },
  SR:   { usage: 'SR <call#> <notes>',        desc: 'Flag call for supervisor review' },
  SS:   { usage: 'SS',                        desc: 'Show shift summary' },
  RC:   { usage: 'RC <address>',              desc: 'Check recurring calls at address' },
  XR:   { usage: 'XR <query>',               desc: 'Cross reference search' },
  HO:   { usage: 'HO <shift_type>',          desc: 'Initiate shift handoff with auto-briefing' },
  MA:   { usage: 'MA <agency> [reason]',      desc: 'Request mutual aid from agency' },
  NAR:  { usage: 'NAR <call#> <text>',        desc: 'Add versioned narrative to call' },
  QM:   { usage: 'QM [days]',                desc: 'Show dispatch quality metrics' },
  HELP: { usage: 'HELP',                       desc: 'Show command reference' },
};

// ─── Context interface (passed by DispatchPage) ─────────────

export interface CadContext {
  units: Array<{ id: string; call_sign: string; status: string; current_call_id?: string }>;
  calls: Array<{ id: string; call_number: string; status: string }>;
  currentUser?: string;
}

// ─── Fuzzy Matching ──────────────────────────────────────────

/** Simple Levenshtein distance for short strings */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

/** Find best-matching unit by call_sign using prefix match then Levenshtein */
function fuzzyFindUnit(query: string, units: CadContext['units']): CadContext['units'][0] | null {
  const q = query.toUpperCase();
  // Exact match first
  const exact = units.find(u => u.call_sign.toUpperCase() === q);
  if (exact) return exact;
  // Prefix match
  const prefixed = units.filter(u => u.call_sign.toUpperCase().startsWith(q));
  if (prefixed.length === 1) return prefixed[0];
  // Levenshtein within threshold of 2
  let best: CadContext['units'][0] | null = null;
  let bestDist = 3;
  for (const u of units) {
    const d = levenshtein(q, u.call_sign.toUpperCase());
    if (d < bestDist) { bestDist = d; best = u; }
  }
  return best;
}

/** Find best-matching call by call_number using prefix match then Levenshtein */
function fuzzyFindCall(query: string, calls: CadContext['calls']): CadContext['calls'][0] | null {
  const q = query.toUpperCase();
  // Exact match first
  const exact = calls.find(c => c.call_number.toUpperCase() === q);
  if (exact) return exact;
  // Suffix match (allow typing just the numeric part, e.g., "123" matches "CFS-2026-00123")
  const suffixed = calls.filter(c => c.call_number.toUpperCase().endsWith(q));
  if (suffixed.length === 1) return suffixed[0];
  // Prefix match
  const prefixed = calls.filter(c => c.call_number.toUpperCase().startsWith(q));
  if (prefixed.length === 1) return prefixed[0];
  // Levenshtein within threshold of 3
  let best: CadContext['calls'][0] | null = null;
  let bestDist = 4;
  for (const c of calls) {
    const d = levenshtein(q, c.call_number.toUpperCase());
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

// ─── Command History Persistence ─────────────────────────────

const HISTORY_KEY = 'rmpg_cad_history';
const HISTORY_MAX = 100;

export function loadCommandHistory(): string[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

export function saveCommandHistory(history: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_MAX)));
  } catch { /* localStorage full or unavailable */ }
}

// ─── Parser ─────────────────────────────────────────────────

export async function executeCommand(
  input: string,
  ctx: CadContext,
): Promise<CommandResult> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { success: false, message: '', action: { type: 'none' } };
  }

  const parts = trimmed.split(/\s+/);
  const verb = parts[0].toUpperCase();
  const args = parts.slice(1);

  switch (verb) {
    // ── New Call ──
    case 'NC': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: NC <type> [location]', action: { type: 'none' } };
      }
      const incidentType = args[0];
      const location = args.slice(1).join(' ') || undefined;
      return {
        success: true,
        message: `Opening new call form${location ? ` for ${location}` : ''}...`,
        action: { type: 'new_call', incidentType, location },
      };
    }

    // ── Call Info / Select ──
    case 'CI': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: CI <call_number>', action: { type: 'none' } };
      }
      const callQuery = args[0].toUpperCase();
      const call = fuzzyFindCall(callQuery, ctx.calls);
      if (!call) {
        return { success: false, message: `Call "${callQuery}" not found`, action: { type: 'none' } };
      }
      return {
        success: true,
        message: `Selected call ${call.call_number}`,
        action: { type: 'select_call', callId: call.id, callNumber: call.call_number },
      };
    }

    // ── Mileage Log ──
    case 'ML': {
      if (args.length < 3) {
        return { success: false, message: 'Usage: ML <unit> <start|end> <mileage>', action: { type: 'none' } };
      }
      const unitQuery = args[0].toUpperCase();
      const mileageType = args[1].toUpperCase() === 'END' ? 'end' as const : 'start' as const;
      const mileageVal = parseInt(args[2], 10);

      if (isNaN(mileageVal)) {
        return { success: false, message: `Invalid mileage value "${args[2]}"`, action: { type: 'none' } };
      }

      const unit = fuzzyFindUnit(unitQuery, ctx.units);
      if (!unit) {
        return { success: false, message: `Unit "${unitQuery}" not found`, action: { type: 'none' } };
      }

      try {
        await apiFetch(`/dispatch/units/${unit.id}/mileage`, {
          method: 'PUT',
          body: JSON.stringify({ mileage: mileageVal }),
        });
        return {
          success: true,
          message: `${unit.call_sign} mileage ${mileageType}: ${mileageVal.toLocaleString()} mi`,
          action: { type: 'set_mileage', callSign: unit.call_sign, mileageType, value: mileageVal },
        };
      } catch (err: any) {
        return { success: false, message: `Failed: ${err.message}`, action: { type: 'none' } };
      }
    }

    // ── Assign Unit ──
    case 'AS': {
      if (args.length < 2) {
        return { success: false, message: 'Usage: AS <unit_call_sign> <call_number>', action: { type: 'none' } };
      }
      const unit = fuzzyFindUnit(args[0], ctx.units);
      if (!unit) {
        return { success: false, message: `Unit "${args[0]}" not found`, action: { type: 'none' } };
      }

      const call = fuzzyFindCall(args[1], ctx.calls);
      if (!call) {
        return { success: false, message: `Call "${args[1]}" not found`, action: { type: 'none' } };
      }

      try {
        await apiFetch(`/dispatch/calls/${call.id}/assign-unit`, {
          method: 'POST',
          body: JSON.stringify({ unit_id: Number(unit.id) }),
        });
        return {
          success: true,
          message: `${unit.call_sign} assigned to ${call.call_number}`,
          action: { type: 'assign_unit', callSign: unit.call_sign, callNumber: call.call_number },
        };
      } catch (err: any) {
        return { success: false, message: `Failed: ${err.message}`, action: { type: 'none' } };
      }
    }

    // ── Set Unit Status ──
    case 'ST': {
      if (args.length < 2) {
        return { success: false, message: 'Usage: ST <unit_call_sign> <status> (AVL/ENR/ONS/BSY/OOD)', action: { type: 'none' } };
      }
      const statusCode = args[1].toUpperCase();
      const status = STATUS_MAP[statusCode];

      if (!status) {
        return {
          success: false,
          message: `Unknown status "${statusCode}". Use: AVL, ENR, ONS, BSY, OOD`,
          action: { type: 'none' },
        };
      }

      const unit = fuzzyFindUnit(args[0], ctx.units);
      if (!unit) {
        return { success: false, message: `Unit "${args[0]}" not found`, action: { type: 'none' } };
      }

      try {
        await apiFetch(`/dispatch/units/${unit.id}/status`, {
          method: 'PUT',
          body: JSON.stringify({ status }),
        });
        return {
          success: true,
          message: `${unit.call_sign} → ${status.toUpperCase()}`,
          action: { type: 'set_status', callSign: unit.call_sign, status },
        };
      } catch (err: any) {
        return { success: false, message: `Failed: ${err.message}`, action: { type: 'none' } };
      }
    }

    // ── Clear/Close Call ──
    case 'CL': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: CL <call#> [disposition]', action: { type: 'none' } };
      }
      const disposition = args.length > 1 ? args.slice(1).join(' ').toUpperCase() : undefined;
      const call = fuzzyFindCall(args[0], ctx.calls);

      if (!call) {
        return { success: false, message: `Call "${args[0]}" not found`, action: { type: 'none' } };
      }

      try {
        await apiFetch(`/dispatch/calls/${call.id}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 'cleared', ...(disposition ? { disposition } : {}) }),
        });
        return {
          success: true,
          message: `${call.call_number} CLEARED${disposition ? ` — ${disposition}` : ''}`,
          action: { type: 'clear_call', callNumber: call.call_number },
        };
      } catch (err: any) {
        return { success: false, message: `Failed: ${err.message}`, action: { type: 'none' } };
      }
    }

    // ── Hold / Resume Call ──
    case 'HD':
    case 'HOLD': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: HD <call#> [R to resume]', action: { type: 'none' } };
      }
      const isResume = args.length > 1 && args[1].toUpperCase() === 'R';
      const hdCall = fuzzyFindCall(args[0], ctx.calls);

      if (!hdCall) {
        return { success: false, message: `Call "${args[0]}" not found`, action: { type: 'none' } };
      }

      try {
        const endpoint = isResume ? 'resume' : 'hold';
        await apiFetch(`/dispatch/calls/${hdCall.id}/${endpoint}`, { method: 'POST' });
        return {
          success: true,
          message: isResume ? `${hdCall.call_number} RESUMED` : `${hdCall.call_number} ON HOLD`,
          action: { type: 'hold_call', callNumber: hdCall.call_number, resume: isResume },
        };
      } catch (err: any) {
        return { success: false, message: `Failed: ${err.message}`, action: { type: 'none' } };
      }
    }

    // ── Query Person (NCIC) ──
    case 'QP':
    case 'QH': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: QP <name>', action: { type: 'none' } };
      }
      const query = args.join(' ');
      return {
        success: true,
        message: `Querying person: ${query}...`,
        action: { type: 'query_person', query },
      };
    }

    // ── Query Vehicle (NCIC) ──
    case 'QV': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: QV <plate>', action: { type: 'none' } };
      }
      const query = args.join(' ');
      return {
        success: true,
        message: `Querying vehicle: ${query}...`,
        action: { type: 'query_vehicle', query },
      };
    }

    // ── Query Warrants ──
    case 'QW': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: QW <name>', action: { type: 'none' } };
      }
      const query = args.join(' ');
      return {
        success: true,
        message: `Querying warrants: ${query}...`,
        action: { type: 'query_warrant', query },
      };
    }

    // ── Premise History ──
    case 'PR': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: PR <address>', action: { type: 'none' } };
      }
      const address = args.join(' ');
      return {
        success: true,
        message: `Looking up premise: ${address}...`,
        action: { type: 'premise_history', address },
      };
    }

    // ── Dispatch Units (multi-assign) ──
    case 'DU': {
      if (args.length < 2) {
        return { success: false, message: 'Usage: DU <call#> <unit1> [unit2] [unit3]', action: { type: 'none' } };
      }
      const call = fuzzyFindCall(args[0], ctx.calls);
      if (!call) {
        return { success: false, message: `Call "${args[0]}" not found`, action: { type: 'none' } };
      }

      const unitArgs = args.slice(1);
      const results: string[] = [];
      let anyFailed = false;
      const assignedSigns: string[] = [];
      for (const sign of unitArgs) {
        const unit = fuzzyFindUnit(sign, ctx.units);
        if (!unit) {
          results.push(`${sign}: NOT FOUND`);
          anyFailed = true;
          continue;
        }
        assignedSigns.push(unit.call_sign);
        try {
          await apiFetch(`/dispatch/calls/${call.id}/assign-unit`, {
            method: 'POST',
            body: JSON.stringify({ unit_id: Number(unit.id) }),
          });
          results.push(`${unit.call_sign}: ASSIGNED`);
        } catch (err: any) {
          results.push(`${unit.call_sign}: FAILED (${err.message})`);
          anyFailed = true;
        }
      }

      return {
        success: !anyFailed,
        message: `Dispatch ${call.call_number}:\n${results.join('\n')}`,
        action: { type: 'dispatch_units', callNumber: call.call_number, unitCallSigns: assignedSigns },
      };
    }

    // ── Add Note to Call ──
    case 'NT': {
      if (args.length < 2) {
        return { success: false, message: 'Usage: NT <call#> <note text>', action: { type: 'none' } };
      }
      const noteText = args.slice(1).join(' ');
      const call = fuzzyFindCall(args[0], ctx.calls);
      if (!call) {
        return { success: false, message: `Call "${args[0]}" not found`, action: { type: 'none' } };
      }

      try {
        // Fetch current call to get existing notes, then append
        const current = await apiFetch<any>(`/dispatch/calls/${call.id}`);
        let existingNotes: any[] = [];
        try { existingNotes = JSON.parse(current.notes || '[]'); } catch { /* start fresh */ }
        existingNotes.push({
          id: String(Date.now()),
          author: ctx.currentUser || 'Dispatch',
          text: noteText,
          timestamp: new Date().toISOString(),
        });
        await apiFetch(`/dispatch/calls/${call.id}`, {
          method: 'PUT',
          body: JSON.stringify({ notes: JSON.stringify(existingNotes) }),
        });
        return {
          success: true,
          message: `Note added to ${call.call_number}: "${noteText}"`,
          action: { type: 'add_note', callNumber: call.call_number, note: noteText },
        };
      } catch (err: any) {
        return { success: false, message: `Failed: ${err.message}`, action: { type: 'none' } };
      }
    }

    // ── Change Call Priority ──
    case 'PRI': {
      if (args.length < 2) {
        return { success: false, message: 'Usage: PRI <call#> <P1|P2|P3|P4>', action: { type: 'none' } };
      }
      const priority = args[1].toUpperCase();

      if (!['P1', 'P2', 'P3', 'P4'].includes(priority)) {
        return { success: false, message: `Invalid priority "${priority}". Use P1, P2, P3, or P4.`, action: { type: 'none' } };
      }

      const call = fuzzyFindCall(args[0], ctx.calls);
      if (!call) {
        return { success: false, message: `Call "${args[0]}" not found`, action: { type: 'none' } };
      }

      try {
        await apiFetch(`/dispatch/calls/${call.id}`, {
          method: 'PUT',
          body: JSON.stringify({ priority }),
        });
        return {
          success: true,
          message: `${call.call_number} priority → ${priority}`,
          action: { type: 'change_priority', callNumber: call.call_number, priority },
        };
      } catch (err: any) {
        return { success: false, message: `Failed: ${err.message}`, action: { type: 'none' } };
      }
    }

    // ── Unit Status Check ──
    case 'US': {
      if (args.length === 0) {
        // Show all active units status summary
        const active = ctx.units.filter(u => u.status !== 'off_duty');
        if (active.length === 0) {
          return { success: true, message: 'No active units.', action: { type: 'unit_status_check' } };
        }
        const lines = active.map(u => {
          const st = u.status.toUpperCase().padEnd(12);
          const onCall = u.current_call_id ? ` [CALL]` : '';
          return `  ${u.call_sign.padEnd(10)} ${st}${onCall}`;
        });
        return {
          success: true,
          message: `UNIT STATUS REPORT\n${'─'.repeat(40)}\n${lines.join('\n')}\n${'─'.repeat(40)}\n${active.length} unit(s) active`,
          action: { type: 'unit_status_check' },
        };
      }

      const unit = fuzzyFindUnit(args[0], ctx.units);
      if (!unit) {
        return { success: false, message: `Unit "${args[0]}" not found`, action: { type: 'none' } };
      }
      return {
        success: true,
        message: `${unit.call_sign}: ${unit.status.toUpperCase()}${unit.current_call_id ? ' [ON CALL]' : ''}`,
        action: { type: 'unit_status_check', callSign: unit.call_sign },
      };
    }

    // ── Create BOLO ──
    case 'BO': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: BO <description>', action: { type: 'none' } };
      }
      const description = args.join(' ');
      try {
        await apiFetch('/comms/bolos', {
          method: 'POST',
          body: JSON.stringify({
            title: `BOLO — ${description.substring(0, 50)}`,
            description,
            priority: 'high',
            status: 'active',
          }),
        });
        return {
          success: true,
          message: `BOLO CREATED: ${description}`,
          action: { type: 'create_bolo', description },
        };
      } catch (err: any) {
        return { success: false, message: `Failed: ${err.message}`, action: { type: 'none' } };
      }
    }

    // ── Query BOLOs ──
    case 'QB': {
      const query = args.join(' ') || '';
      return {
        success: true,
        message: query ? `Querying BOLOs: ${query}...` : 'Opening active BOLOs...',
        action: { type: 'query_bolo', query },
      };
    }

    // ── New Field Interview ──
    case 'FI': {
      const location = args.join(' ') || undefined;
      return {
        success: true,
        message: `Opening Field Interview form${location ? ` at ${location}` : ''}...`,
        action: { type: 'new_fi', location },
      };
    }

    // ── Query Trespass Orders ──
    case 'QT': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: QT <name or address>', action: { type: 'none' } };
      }
      const query = args.join(' ');
      return {
        success: true,
        message: `Querying trespass orders: ${query}...`,
        action: { type: 'query_trespass', query },
      };
    }

    // ── Promote Call to Incident ──
    case 'PI': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: PI <call#>', action: { type: 'none' } };
      }
      const call = fuzzyFindCall(args[0], ctx.calls);
      if (!call) {
        return { success: false, message: `Call "${args[0]}" not found`, action: { type: 'none' } };
      }

      try {
        await apiFetch(`/dispatch/calls/${call.id}/promote-to-incident`, { method: 'POST' });
        return {
          success: true,
          message: `${call.call_number} PROMOTED → Incident report created`,
          action: { type: 'promote_incident', callNumber: call.call_number },
        };
      } catch (err: any) {
        return { success: false, message: `Failed: ${err.message}`, action: { type: 'none' } };
      }
    }

    // ── Notify External Agency ──
    case 'LE': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: LE <call#> [agency]', action: { type: 'none' } };
      }
      const agency = args.length > 1 ? args.slice(1).join(' ') : undefined;
      const call = fuzzyFindCall(args[0], ctx.calls);
      if (!call) {
        return { success: false, message: `Call "${args[0]}" not found`, action: { type: 'none' } };
      }

      try {
        await apiFetch(`/dispatch/calls/${call.id}/le-notification`, {
          method: 'POST',
          body: JSON.stringify({ agency: agency || 'Local PD' }),
        });
        return {
          success: true,
          message: `${call.call_number} → LE NOTIFIED${agency ? ` (${agency})` : ''}`,
          action: { type: 'le_notify', callNumber: call.call_number, agency },
        };
      } catch (err: any) {
        return { success: false, message: `Failed: ${err.message}`, action: { type: 'none' } };
      }
    }

    // ── Voice: Status ──
    case 'STATUS': {
      if (args.length === 0) {
        const active = ctx.units.filter(u => u.status !== 'off_duty');
        return {
          success: true,
          message: `Voice announcing ${active.length} active units status`,
          action: { type: 'voice_status' },
        };
      }
      const unit = fuzzyFindUnit(args[0], ctx.units);
      if (!unit) {
        return { success: false, message: `Unit "${args[0]}" not found`, action: { type: 'none' } };
      }
      return {
        success: true,
        message: `Voice announcing status: ${unit.call_sign} — ${unit.status.toUpperCase()}`,
        action: { type: 'voice_status', callSign: unit.call_sign },
      };
    }

    // ── Voice: Check (read-back call details) ──
    case 'CHECK': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: CHECK <call#>', action: { type: 'none' } };
      }
      const call = fuzzyFindCall(args[0], ctx.calls);
      if (!call) {
        return { success: false, message: `Call "${args[0]}" not found`, action: { type: 'none' } };
      }
      return {
        success: true,
        message: `Voice read-back for ${call.call_number}`,
        action: { type: 'voice_check', callNumber: call.call_number },
      };
    }

    // ── Voice: ETA ──
    case 'ETA': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: ETA <unit>', action: { type: 'none' } };
      }
      const unit = fuzzyFindUnit(args[0], ctx.units);
      if (!unit) {
        return { success: false, message: `Unit "${args[0]}" not found`, action: { type: 'none' } };
      }
      return {
        success: true,
        message: `Voice announcing ETA for ${unit.call_sign}`,
        action: { type: 'voice_eta', callSign: unit.call_sign },
      };
    }

    // ── Voice: Weather ──
    case 'WEATHER': {
      return {
        success: true,
        message: 'Voice announcing current weather',
        action: { type: 'voice_weather' },
      };
    }

    // ── Voice: Time ──
    case 'TIME': {
      return {
        success: true,
        message: 'Voice announcing current time',
        action: { type: 'voice_time' },
      };
    }

    // ── Voice: Acknowledgment ──
    case 'ACK':
    case '10-4': {
      return {
        success: true,
        message: '10-4',
        action: { type: 'voice_ack' },
      };
    }

    // ── Voice: All-Clear ──
    case 'ALL-CLEAR':
    case 'ALLCLEAR': {
      if (args.length > 0) {
        const call = fuzzyFindCall(args[0], ctx.calls);
        if (!call) {
          return { success: false, message: `Call "${args[0]}" not found`, action: { type: 'none' } };
        }
        return {
          success: true,
          message: `All clear — ${call.call_number}`,
          action: { type: 'voice_allclear', callNumber: call.call_number },
        };
      }
      return {
        success: true,
        message: 'All clear announced',
        action: { type: 'voice_allclear' },
      };
    }

    // ── Voice: Shift Summary ──
    case 'SUMMARY':
    case 'SHIFT':
    case '/SUMMARY':
    case '/SHIFT': {
      return {
        success: true,
        message: 'Voice announcing shift summary',
        action: { type: 'voice_summary' },
      };
    }

    // ── Voice: Locate Unit ──
    case 'LOCATE':
    case '/LOCATE': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: LOCATE <unit>', action: { type: 'none' } };
      }
      const unit = fuzzyFindUnit(args[0], ctx.units);
      if (!unit) {
        return { success: false, message: `Unit "${args[0]}" not found`, action: { type: 'none' } };
      }
      return {
        success: true,
        message: `Voice announcing location of ${unit.call_sign}`,
        action: { type: 'voice_locate', callSign: unit.call_sign },
      };
    }

    // ── Voice: Serve Details ──
    case 'SERVE':
    case '/SERVE': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: SERVE <call#>', action: { type: 'none' } };
      }
      const call = fuzzyFindCall(args[0], ctx.calls);
      if (!call) {
        return { success: false, message: `Call "${args[0]}" not found`, action: { type: 'none' } };
      }
      return {
        success: true,
        message: `Voice announcing serve details for ${call.call_number}`,
        action: { type: 'voice_serve', callNumber: call.call_number },
      };
    }

    // ── Voice: Deadline Status ──
    case 'DEADLINE':
    case '/DEADLINE': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: DEADLINE <call#>', action: { type: 'none' } };
      }
      const call = fuzzyFindCall(args[0], ctx.calls);
      if (!call) {
        return { success: false, message: `Call "${args[0]}" not found`, action: { type: 'none' } };
      }
      return {
        success: true,
        message: `Voice announcing deadline for ${call.call_number}`,
        action: { type: 'voice_deadline', callNumber: call.call_number },
      };
    }

    // ── Voice: Stacked Calls ──
    case 'STACK':
    case '/STACK': {
      return {
        success: true,
        message: 'Voice announcing stacked calls at selected location',
        action: { type: 'voice_stack' },
      };
    }

    // ── Voice: All Unit Statuses ──
    case 'UNITS':
    case '/UNITS': {
      const active = ctx.units.filter(u => u.status !== 'off_duty');
      return {
        success: true,
        message: `Voice announcing ${active.length} active unit statuses`,
        action: { type: 'voice_units' },
      };
    }

    // ── Voice: Pending Calls ──
    case 'PENDING':
    case '/PENDING': {
      const pending = ctx.calls.filter(c => c.status === 'pending');
      return {
        success: true,
        message: `Voice announcing ${pending.length} pending calls`,
        action: { type: 'voice_pending' },
      };
    }

    // ── Voice: Priority Breakdown ──
    case 'PRIORITY':
    case '/PRIORITY': {
      return {
        success: true,
        message: 'Voice announcing call priority breakdown',
        action: { type: 'voice_priority' },
      };
    }

    // ── Dispatch Code Lookup ──
    case 'CODE':
    case '10': {
      // Allow "CODE 10-71" or "10-71" or "CODE CODE-3" or just "10-71"
      let codeQuery = args.join('-') || '';
      // If entered as "10 71", reconstruct as "10-71"
      if (verb === '10' && args.length >= 1) {
        codeQuery = '10-' + args.join('-');
      }
      if (!codeQuery) {
        return { success: false, message: 'Usage: CODE <code> (e.g., CODE 10-71, 10-71, CODE-3)', action: { type: 'none' } };
      }
      try {
        const result = await apiFetch<{ found: boolean; code?: string; description?: string; priority?: string; category?: string; requires_backup?: number; officer_safety?: number; ems_needed?: number; fire_needed?: number }>(
          `/dispatch/geography/codes/lookup/${encodeURIComponent(codeQuery)}`
        );
        if (result && result.found) {
          const flags: string[] = [];
          if (result.requires_backup) flags.push('BACKUP');
          if (result.officer_safety) flags.push('SAFETY');
          if (result.ems_needed) flags.push('EMS');
          if (result.fire_needed) flags.push('FIRE');
          const flagStr = flags.length > 0 ? ` [${flags.join(' ')}]` : '';
          return {
            success: true,
            message: `${result.code}: ${result.description} (${result.priority} / ${result.category})${flagStr}`,
            action: {
              type: 'lookup_code', code: codeQuery,
              result: {
                description: result.description || '',
                priority: result.priority || 'P3',
                category: result.category || 'general',
                requires_backup: !!result.requires_backup,
                officer_safety: !!result.officer_safety,
                ems_needed: !!result.ems_needed,
                fire_needed: !!result.fire_needed,
              },
            },
          };
        }
        return { success: false, message: `Code "${codeQuery}" not found in database`, action: { type: 'lookup_code', code: codeQuery } };
      } catch {
        return { success: false, message: `Failed to lookup code "${codeQuery}"`, action: { type: 'none' } };
      }
    }

    // ── Premise Alert Manage ──
    case 'PA':
    case 'PREMISE': {
      const address = args.join(' ');
      if (!address) {
        return { success: false, message: 'Usage: PA <address> (e.g., PA 123 Main St)', action: { type: 'none' } };
      }
      return {
        success: true,
        message: `Managing premise alert for "${address}"...`,
        action: { type: 'manage_premise_alert', address },
      };
    }

    // ── Redispatch ──
    case 'RD': {
      if (args.length < 2) {
        return { success: false, message: 'Usage: RD <call#> <unit1> [unit2...]', action: { type: 'none' } };
      }
      const call = fuzzyFindCall(args[0], ctx.calls);
      if (!call) {
        return { success: false, message: `Call "${args[0]}" not found`, action: { type: 'none' } };
      }
      const unitCallSigns = args.slice(1).map(s => s.toUpperCase());
      return {
        success: true,
        message: `Redispatching ${call.call_number} → ${unitCallSigns.join(', ')}`,
        action: { type: 'redispatch', callNumber: call.call_number, unitCallSigns },
      };
    }

    // ── Escalate Priority ──
    case 'ESC': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: ESC <call#>', action: { type: 'none' } };
      }
      const call = fuzzyFindCall(args[0], ctx.calls);
      if (!call) {
        return { success: false, message: `Call "${args[0]}" not found`, action: { type: 'none' } };
      }
      return {
        success: true,
        message: `Escalating priority for ${call.call_number}`,
        action: { type: 'escalate_priority', callNumber: call.call_number },
      };
    }

    // ── De-escalate Priority ──
    case 'DESC': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: DESC <call#>', action: { type: 'none' } };
      }
      const call = fuzzyFindCall(args[0], ctx.calls);
      if (!call) {
        return { success: false, message: `Call "${args[0]}" not found`, action: { type: 'none' } };
      }
      return {
        success: true,
        message: `De-escalating priority for ${call.call_number}`,
        action: { type: 'deescalate_priority', callNumber: call.call_number },
      };
    }

    // ── Request Backup ──
    case 'BK': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: BK <call#> [count]', action: { type: 'none' } };
      }
      const call = fuzzyFindCall(args[0], ctx.calls);
      if (!call) {
        return { success: false, message: `Call "${args[0]}" not found`, action: { type: 'none' } };
      }
      const count = args.length > 1 ? parseInt(args[1], 10) : 1;
      return {
        success: true,
        message: `Requesting ${count} backup unit(s) for ${call.call_number}`,
        action: { type: 'request_backup', callNumber: call.call_number, count: isNaN(count) ? 1 : count },
      };
    }

    // ── Transfer Call ──
    case 'TR': {
      if (args.length < 2) {
        return { success: false, message: 'Usage: TR <call#> <dispatcher>', action: { type: 'none' } };
      }
      const call = fuzzyFindCall(args[0], ctx.calls);
      if (!call) {
        return { success: false, message: `Call "${args[0]}" not found`, action: { type: 'none' } };
      }
      const dispatcher = args[1];
      return {
        success: true,
        message: `Transferring ${call.call_number} to ${dispatcher}`,
        action: { type: 'transfer_call', callNumber: call.call_number, dispatcher },
      };
    }

    // ── Timeline ──
    case 'TL': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: TL <call#>', action: { type: 'none' } };
      }
      const call = fuzzyFindCall(args[0], ctx.calls);
      if (!call) {
        return { success: false, message: `Call "${args[0]}" not found`, action: { type: 'none' } };
      }
      return {
        success: true,
        message: `Showing timeline for ${call.call_number}`,
        action: { type: 'show_timeline', callNumber: call.call_number },
      };
    }

    // ── Workload ──
    case 'WL': {
      if (args.length === 0) {
        return {
          success: true,
          message: 'Showing dispatcher workload overview',
          action: { type: 'show_workload' },
        };
      }
      const unit = fuzzyFindUnit(args[0], ctx.units);
      if (!unit) {
        return { success: false, message: `Unit "${args[0]}" not found`, action: { type: 'none' } };
      }
      return {
        success: true,
        message: `Showing workload for ${unit.call_sign}`,
        action: { type: 'show_workload', callSign: unit.call_sign },
      };
    }

    // ── Hot Spots ──
    case 'HS': {
      return {
        success: true,
        message: 'Showing hot spots map',
        action: { type: 'show_hotspots' },
      };
    }

    // ── Coverage ──
    case 'CV': {
      return {
        success: true,
        message: 'Showing unit coverage map',
        action: { type: 'show_coverage' },
      };
    }

    // ── Nearby Calls ──
    case 'NB': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: NB <call#>', action: { type: 'none' } };
      }
      const call = fuzzyFindCall(args[0], ctx.calls);
      if (!call) {
        return { success: false, message: `Call "${args[0]}" not found`, action: { type: 'none' } };
      }
      return {
        success: true,
        message: `Showing nearby calls for ${call.call_number}`,
        action: { type: 'show_nearby', callNumber: call.call_number },
      };
    }

    // ── Supervisor Review ──
    case 'SR': {
      if (args.length < 2) {
        return { success: false, message: 'Usage: SR <call#> <notes...>', action: { type: 'none' } };
      }
      const call = fuzzyFindCall(args[0], ctx.calls);
      if (!call) {
        return { success: false, message: `Call "${args[0]}" not found`, action: { type: 'none' } };
      }
      const notes = args.slice(1).join(' ');
      return {
        success: true,
        message: `Flagged ${call.call_number} for supervisor review: "${notes}"`,
        action: { type: 'supervisor_review', callNumber: call.call_number, notes },
      };
    }

    // ── Shift Summary ──
    case 'SS': {
      return {
        success: true,
        message: 'Showing shift summary',
        action: { type: 'show_shift_summary' },
      };
    }

    // ── Recurring Calls ──
    case 'RC': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: RC <address...>', action: { type: 'none' } };
      }
      const address = args.join(' ');
      return {
        success: true,
        message: `Checking recurring calls at "${address}"`,
        action: { type: 'check_recurring', address },
      };
    }

    // ── Cross Reference ──
    case 'XR': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: XR <query...>', action: { type: 'none' } };
      }
      const query = args.join(' ');
      return {
        success: true,
        message: `Cross referencing: ${query}...`,
        action: { type: 'cross_reference', query },
      };
    }

    // ── Shift Handoff ──
    case 'HO': {
      const shiftType = args[0] || 'day';
      return {
        success: true,
        message: `Initiating shift handoff (${shiftType})...`,
        action: { type: 'handoff', shiftType },
      };
    }

    // ── Mutual Aid ──
    case 'MA': {
      if (args.length < 1) {
        return { success: false, message: 'Usage: MA <agency> [reason]', action: { type: 'none' } };
      }
      const agency = args[0];
      const reason = args.slice(1).join(' ') || undefined;
      return {
        success: true,
        message: `Requesting mutual aid from ${agency}...`,
        action: { type: 'mutual_aid', agency, reason },
      };
    }

    // ── Narrative ──
    case 'NAR': {
      if (args.length < 2) {
        return { success: false, message: 'Usage: NAR <call#> <text>', action: { type: 'none' } };
      }
      const callId = args[0];
      const text = args.slice(1).join(' ');
      return {
        success: true,
        message: `Adding narrative to call ${callId}...`,
        action: { type: 'narrative', callId, text },
      };
    }

    // ── Quality Metrics ──
    case 'QM': {
      const days = args[0] ? parseInt(args[0], 10) : undefined;
      return {
        success: true,
        message: `Loading quality metrics${days ? ` (${days} days)` : ''}...`,
        action: { type: 'quality_metrics', days },
      };
    }

    // ── Help ──
    case 'HELP':
    case '?': {
      const helpLines = Object.entries(COMMANDS)
        .map(([, cmd]) => `  ${cmd.usage.padEnd(28)} ${cmd.desc}`)
        .join('\n');
      return {
        success: true,
        message: `CAD COMMAND REFERENCE\n${'─'.repeat(50)}\n${helpLines}\n${'─'.repeat(50)}`,
        action: { type: 'show_help' },
      };
    }

    default: {
      // Auto-detect 10-codes entered directly (e.g., "10-71")
      if (/^10-\d+$/i.test(verb)) {
        try {
          const result = await apiFetch<{ found: boolean; code?: string; description?: string; priority?: string; category?: string; requires_backup?: number; officer_safety?: number; ems_needed?: number; fire_needed?: number }>(
            `/dispatch/geography/codes/lookup/${encodeURIComponent(verb)}`
          );
          if (result && result.found) {
            const flags: string[] = [];
            if (result.requires_backup) flags.push('BACKUP');
            if (result.officer_safety) flags.push('SAFETY');
            if (result.ems_needed) flags.push('EMS');
            if (result.fire_needed) flags.push('FIRE');
            const flagStr = flags.length > 0 ? ` [${flags.join(' ')}]` : '';
            return {
              success: true,
              message: `${result.code}: ${result.description} (${result.priority} / ${result.category})${flagStr}`,
              action: {
                type: 'lookup_code', code: verb,
                result: {
                  description: result.description || '',
                  priority: result.priority || 'P3',
                  category: result.category || 'general',
                  requires_backup: !!result.requires_backup,
                  officer_safety: !!result.officer_safety,
                  ems_needed: !!result.ems_needed,
                  fire_needed: !!result.fire_needed,
                },
              },
            };
          }
        } catch { /* fall through to unknown */ }
      }
      // Also detect CODE-N format (e.g., "CODE-3")
      if (/^CODE-\d+$/i.test(verb)) {
        try {
          const result = await apiFetch<{ found: boolean; code?: string; description?: string; priority?: string; category?: string }>(
            `/dispatch/geography/codes/lookup/${encodeURIComponent(verb)}`
          );
          if (result && result.found) {
            return {
              success: true,
              message: `${result.code}: ${result.description} (${result.priority} / ${result.category})`,
              action: { type: 'lookup_code', code: verb, result: { description: result.description || '', priority: result.priority || 'P3', category: result.category || 'general', requires_backup: false, officer_safety: false, ems_needed: false, fire_needed: false } },
            };
          }
        } catch { /* fall through */ }
      }
      return {
        success: false,
        message: `Unknown command: ${verb}. Type HELP for commands.`,
        action: { type: 'none' },
      };
    }
  }
}

/** Get list of known command verbs for autocomplete */
export function getCommandVerbs(): string[] {
  return Object.keys(COMMANDS);
}

/** Get command definitions for help display */
export function getCommandDefs(): Record<string, { usage: string; desc: string }> {
  return { ...COMMANDS };
}
