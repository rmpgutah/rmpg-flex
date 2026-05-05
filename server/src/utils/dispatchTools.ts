/**
 * Dispatch tool registry — schemas the LLM uses to decide which existing
 * voice action to invoke. Each tool name maps 1:1 to an action handled by
 * `executeCommand` in routes/voice.ts. The agent does NOT duplicate
 * business logic; it plans, delegates, and synthesizes.
 */

export interface ToolSchema {
  name: string;
  description: string;
  params: Record<string, string>;
}

export const DISPATCH_TOOLS: ToolSchema[] = [
  { name: 'status_update', description: 'Change officer unit status. Use for 10-codes that map to status (10-76 en_route, 10-97 on_scene, 10-8 available, 10-7 out_of_service, 10-10 on_break, 10-6 busy).',
    params: { status: 'en_route|on_scene|available|out_of_service|on_break|busy' } },
  { name: 'acknowledge', description: 'Officer is acknowledging the last dispatch (10-4, copy, roger).', params: {} },
  { name: 'request_backup', description: 'Officer is requesting backup. Broadcasts to nearest units.', params: {} },
  { name: 'request_ems', description: 'Officer is requesting EMS / ambulance / medic.', params: {} },
  { name: 'request_k9', description: 'Officer is requesting K-9 / canine.', params: {} },
  { name: 'run_plate', description: 'Look up a vehicle by plate number.', params: { plate: 'string (alphanumeric)' } },
  { name: 'run_name', description: 'Look up a person by name across persons, warrants, arrests, trespass orders. Cross-database.',
    params: { name: 'string (full or partial name)' } },
  { name: 'next_call', description: 'Read the next pending call from the priority queue.', params: {} },
  { name: 'start_pursuit', description: 'Officer is initiating a vehicle pursuit. Triggers all-units broadcast.', params: {} },
  { name: 'end_pursuit', description: 'Officer is ending an active pursuit.', params: {} },
  { name: 'mark_evidence', description: 'Drop an evidence marker at officer current GPS.', params: {} },
  { name: 'code_4', description: 'Mark scene as code 4 (no further assistance needed). Cancels any pending welfare check.', params: {} },
  { name: 'sitrep', description: 'Generate a situation report: current status, assigned call, queue depth, on-duty count, threat level.', params: {} },
  { name: 'officer_down', description: 'EMERGENCY. Officer down / shots fired / panic / emergency traffic.', params: {} },
  { name: 'area_check', description: 'Recent activity and hazards near the officer GPS in the last 24 hours.', params: {} },
  { name: 'nearest_units', description: 'List the nearest available units to the officer GPS.', params: {} },
  { name: 'threat_check', description: 'Threat assessment for the location of the officer current call.', params: {} },
  { name: 'shift_briefing', description: 'Aggregate shift summary — calls handled, active warrants, BOLOs, weather, hazards.', params: {} },
  { name: 'case_status', description: 'Look up status of a case by number.', params: { case_number: 'string' } },
  { name: 'link_case', description: 'Link the current call to an existing case.', params: { case_number: 'string' } },
  { name: 'start_statement', description: 'Begin recording a witness/suspect statement.', params: { subject_name: 'string optional' } },
  { name: 'end_statement', description: 'Stop the active statement recording.', params: {} },
  // Dialogue-only tools — no executeCommand backing, handled by agent itself
  { name: 'reply_only', description: 'No state-changing action. Reply with information only — answers a question, confirms understanding, or asks a clarifying question. Use for free-form Q&A and any time the officer is talking to dispatch (not the terminal).',
    params: {} },
  { name: 'mileage_capture', description: 'Capture starting or ending odometer mileage spoken by officer (e.g. "starting mileage 84321").',
    params: { kind: 'starting|ending', value: 'integer (miles)' } },
  { name: 'push_to_mdt', description: 'Identity disambiguation — multiple matches found, push the list to officer MDT screen rather than reading aloud.',
    params: { result_kind: 'persons|vehicles|cases|warrants', count: 'integer' } },
  { name: 'refuse_off_topic', description: 'Officer asked something genuinely off-topic and unrelated to police work even after one round of pushback. Decline politely, log it.',
    params: { topic: 'string (what was asked)' } },
];

export function toolsAsPromptSection(): string {
  return DISPATCH_TOOLS.map(t => {
    const ps = Object.keys(t.params).length === 0
      ? 'no params'
      : Object.entries(t.params).map(([k, v]) => `${k}: ${v}`).join(', ');
    return `- ${t.name} (${ps}) — ${t.description}`;
  }).join('\n');
}

// Tools the agent runs server-side without delegating to executeCommand
export const DIALOGUE_ONLY_TOOLS = new Set([
  'reply_only',
  'mileage_capture',
  'push_to_mdt',
  'refuse_off_topic',
]);
