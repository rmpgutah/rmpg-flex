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
  | { type: 'select_call'; callId: string }
  | { type: 'set_mileage'; callNumber: string; mileage: number }
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
  AS:   { usage: 'AS <unit> <call#>',          desc: 'Assign unit to call' },
  DU:   { usage: 'DU <call#> <unit1> [unit2]', desc: 'Dispatch units to call (multi-assign)' },
  ST:   { usage: 'ST <unit> <status>',         desc: 'Set unit status (AVL/ENR/ONS/BSY)' },
  US:   { usage: 'US [unit]',                  desc: 'Unit status check (all or specific)' },
  CL:   { usage: 'CL <call#> [disp]',          desc: 'Clear call with optional disposition' },
  HD:   { usage: 'HD <call#> [R]',             desc: 'Hold call (HD call# R to resume)' },
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
  HELP: { usage: 'HELP',                       desc: 'Show command reference' },
};

// ─── Context interface (passed by DispatchPage) ─────────────

export interface CadContext {
  units: Array<{ id: string; call_sign: string; status: string; current_call_id?: string }>;
  calls: Array<{ id: string; call_number: string; status: string }>;
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

    // ── Assign Unit ──
    case 'AS': {
      if (args.length < 2) {
        return { success: false, message: 'Usage: AS <unit_call_sign> <call_number>', action: { type: 'none' } };
      }
      const callSign = args[0].toUpperCase();
      const callNumber = args[1].toUpperCase();

      // Find unit
      const unit = ctx.units.find(u => u.call_sign.toUpperCase() === callSign);
      if (!unit) {
        return { success: false, message: `Unit "${callSign}" not found`, action: { type: 'none' } };
      }

      // Find call
      const call = ctx.calls.find(c => c.call_number.toUpperCase() === callNumber);
      if (!call) {
        return { success: false, message: `Call "${callNumber}" not found`, action: { type: 'none' } };
      }

      // Execute via API
      try {
        await apiFetch(`/dispatch/calls/${call.id}/assign-unit`, {
          method: 'POST',
          body: JSON.stringify({ unit_id: Number(unit.id) }),
        });
        return {
          success: true,
          message: `${callSign} assigned to ${callNumber}`,
          action: { type: 'assign_unit', callSign, callNumber },
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
      const callSign = args[0].toUpperCase();
      const statusCode = args[1].toUpperCase();
      const status = STATUS_MAP[statusCode];

      if (!status) {
        return {
          success: false,
          message: `Unknown status "${statusCode}". Use: AVL, ENR, ONS, BSY, OOD`,
          action: { type: 'none' },
        };
      }

      const unit = ctx.units.find(u => u.call_sign.toUpperCase() === callSign);
      if (!unit) {
        return { success: false, message: `Unit "${callSign}" not found`, action: { type: 'none' } };
      }

      try {
        await apiFetch(`/dispatch/units/${unit.id}/status`, {
          method: 'PUT',
          body: JSON.stringify({ status }),
        });
        return {
          success: true,
          message: `${callSign} → ${status.toUpperCase()}`,
          action: { type: 'set_status', callSign, status },
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
      const callNumber = args[0].toUpperCase();
      const disposition = args.length > 1 ? args.slice(1).join(' ').toUpperCase() : undefined;
      const call = ctx.calls.find(c => c.call_number.toUpperCase() === callNumber);

      if (!call) {
        return { success: false, message: `Call "${callNumber}" not found`, action: { type: 'none' } };
      }

      try {
        await apiFetch(`/dispatch/calls/${call.id}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 'cleared', ...(disposition ? { disposition } : {}) }),
        });
        return {
          success: true,
          message: `${callNumber} CLEARED${disposition ? ` — ${disposition}` : ''}`,
          action: { type: 'clear_call', callNumber },
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
      const hdCallNum = args[0].toUpperCase();
      const isResume = args.length > 1 && args[1].toUpperCase() === 'R';
      const hdCall = ctx.calls.find(c => c.call_number.toUpperCase() === hdCallNum);

      if (!hdCall) {
        return { success: false, message: `Call "${hdCallNum}" not found`, action: { type: 'none' } };
      }

      try {
        const endpoint = isResume ? 'resume' : 'hold';
        await apiFetch(`/dispatch/calls/${hdCall.id}/${endpoint}`, { method: 'POST' });
        return {
          success: true,
          message: isResume ? `${hdCallNum} RESUMED` : `${hdCallNum} ON HOLD`,
          action: { type: 'hold_call', callNumber: hdCallNum, resume: isResume },
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
      const callNumber = args[0].toUpperCase();
      const unitSigns = args.slice(1).map(u => u.toUpperCase());

      const call = ctx.calls.find(c => c.call_number.toUpperCase() === callNumber);
      if (!call) {
        return { success: false, message: `Call "${callNumber}" not found`, action: { type: 'none' } };
      }

      const results: string[] = [];
      let anyFailed = false;
      for (const sign of unitSigns) {
        const unit = ctx.units.find(u => u.call_sign.toUpperCase() === sign);
        if (!unit) {
          results.push(`${sign}: NOT FOUND`);
          anyFailed = true;
          continue;
        }
        try {
          await apiFetch(`/dispatch/calls/${call.id}/assign-unit`, {
            method: 'POST',
            body: JSON.stringify({ unit_id: Number(unit.id) }),
          });
          results.push(`${sign}: ASSIGNED`);
        } catch (err: any) {
          results.push(`${sign}: FAILED (${err.message})`);
          anyFailed = true;
        }
      }

      return {
        success: !anyFailed,
        message: `Dispatch ${callNumber}:\n${results.join('\n')}`,
        action: { type: 'dispatch_units', callNumber, unitCallSigns: unitSigns },
      };
    }

    // ── Add Note to Call ──
    case 'NT': {
      if (args.length < 2) {
        return { success: false, message: 'Usage: NT <call#> <note text>', action: { type: 'none' } };
      }
      const callNumber = args[0].toUpperCase();
      const noteText = args.slice(1).join(' ');

      const call = ctx.calls.find(c => c.call_number.toUpperCase() === callNumber);
      if (!call) {
        return { success: false, message: `Call "${callNumber}" not found`, action: { type: 'none' } };
      }

      try {
        await apiFetch(`/dispatch/calls/${call.id}/notes`, {
          method: 'POST',
          body: JSON.stringify({ content: noteText }),
        });
        return {
          success: true,
          message: `Note added to ${callNumber}: "${noteText}"`,
          action: { type: 'add_note', callNumber, note: noteText },
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
      const callNumber = args[0].toUpperCase();
      const priority = args[1].toUpperCase();

      if (!['P1', 'P2', 'P3', 'P4'].includes(priority)) {
        return { success: false, message: `Invalid priority "${priority}". Use P1, P2, P3, or P4.`, action: { type: 'none' } };
      }

      const call = ctx.calls.find(c => c.call_number.toUpperCase() === callNumber);
      if (!call) {
        return { success: false, message: `Call "${callNumber}" not found`, action: { type: 'none' } };
      }

      try {
        await apiFetch(`/dispatch/calls/${call.id}`, {
          method: 'PUT',
          body: JSON.stringify({ priority }),
        });
        return {
          success: true,
          message: `${callNumber} priority → ${priority}`,
          action: { type: 'change_priority', callNumber, priority },
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

      const callSign = args[0].toUpperCase();
      const unit = ctx.units.find(u => u.call_sign.toUpperCase() === callSign);
      if (!unit) {
        return { success: false, message: `Unit "${callSign}" not found`, action: { type: 'none' } };
      }
      return {
        success: true,
        message: `${unit.call_sign}: ${unit.status.toUpperCase()}${unit.current_call_id ? ' [ON CALL]' : ''}`,
        action: { type: 'unit_status_check', callSign },
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
      const callNumber = args[0].toUpperCase();
      const call = ctx.calls.find(c => c.call_number.toUpperCase() === callNumber);
      if (!call) {
        return { success: false, message: `Call "${callNumber}" not found`, action: { type: 'none' } };
      }

      try {
        await apiFetch(`/dispatch/calls/${call.id}/promote-to-incident`, { method: 'POST' });
        return {
          success: true,
          message: `${callNumber} PROMOTED → Incident report created`,
          action: { type: 'promote_incident', callNumber },
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
      const callNumber = args[0].toUpperCase();
      const agency = args.length > 1 ? args.slice(1).join(' ') : undefined;
      const call = ctx.calls.find(c => c.call_number.toUpperCase() === callNumber);
      if (!call) {
        return { success: false, message: `Call "${callNumber}" not found`, action: { type: 'none' } };
      }

      try {
        await apiFetch(`/dispatch/calls/${call.id}/le-notification`, {
          method: 'POST',
          body: JSON.stringify({ agency: agency || 'Local PD' }),
        });
        return {
          success: true,
          message: `${callNumber} → LE NOTIFIED${agency ? ` (${agency})` : ''}`,
          action: { type: 'le_notify', callNumber, agency },
        };
      } catch (err: any) {
        return { success: false, message: `Failed: ${err.message}`, action: { type: 'none' } };
      }
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

    default:
      return {
        success: false,
        message: `Unknown command: ${verb}. Type HELP for commands.`,
        action: { type: 'none' },
      };
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
