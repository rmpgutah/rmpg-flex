// ============================================================
// Dispatcher Command Engine — LLM planner
// ============================================================
// Free-form text → PlannerOutput via callAi (Claude → OpenAI → Workers AI).
// The prompt is generated from the tool catalog; the model's JSON is parsed
// defensively (fenced, prefixed, or trailing prose all tolerated) and then
// every tool call is re-validated by catalog.ts — nothing here is trusted.

import { z } from 'zod';
import { callAi, type AiCallResult } from '../callAi';
import { describeCatalog, TOOLS } from './catalog';
import type { CommandContext, PlannerOutput } from './types';

interface PlannerEnv { DB: D1Database; AI: Ai; KV?: KVNamespace }

const plannerSchema = z.object({
  intent: z.string().max(60).default('unclear'),
  reply: z.string().max(600).default(''),
  clarify: z.string().max(300).optional().nullable(),
  tool_calls: z.array(z.object({
    tool: z.string(),
    params: z.record(z.string(), z.unknown()).default({}),
  })).default([]),
});

/**
 * Pull the first balanced JSON object out of model text. Handles ```json
 * fences, leading prose, and trailing commentary. Pure.
 */
export function extractJsonObject(text: string): string | null {
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse + shape-validate planner output. Returns null when there is no usable
 * JSON at all (caller degrades to a clarify turn). Pure.
 */
export function parsePlannerOutput(text: string): PlannerOutput | null {
  const json = extractJsonObject(text);
  if (!json) return null;
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return null; }
  const parsed = plannerSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;
  return {
    intent: d.intent || 'unclear',
    reply: d.reply || '',
    tool_calls: d.tool_calls.filter(t => typeof t.tool === 'string' && t.tool in TOOLS),
    ...(d.clarify ? { clarify: d.clarify } : {}),
  };
}

export interface AwarenessSnapshot {
  pendingCalls: Array<{ call_number: string; incident_type: string | null; priority: string | null; location_address: string | null }>;
  activeCalls: Array<{ call_number: string; incident_type: string | null; priority: string | null; status: string; location_address: string | null; unit_call_signs: string | null }>;
  units: Array<{ call_sign: string; status: string }>;
}

export function buildPlannerPrompt(ctx: CommandContext, awareness: AwarenessSnapshot): string {
  const board = [
    awareness.activeCalls.length
      ? `ACTIVE CALLS:\n${awareness.activeCalls.map(c => `  ${c.call_number} ${c.priority ?? ''} ${c.status} ${c.incident_type ?? ''} @ ${c.location_address ?? '?'}${c.unit_call_signs ? ` units=${c.unit_call_signs}` : ''}`).join('\n')}`
      : 'ACTIVE CALLS: none',
    awareness.pendingCalls.length
      ? `PENDING (unassigned): ${awareness.pendingCalls.map(c => c.call_number).join(', ')}`
      : 'PENDING: none',
    awareness.units.length
      ? `UNITS: ${awareness.units.map(u => `${u.call_sign}=${u.status}`).join(', ')}`
      : 'UNITS: none on duty',
    ctx.selectedCallNumber ? `SELECTED CALL: ${ctx.selectedCallNumber} (what "this call"/"that call"/"it" means)` : 'SELECTED CALL: none',
    ctx.unitCallSign ? `SPEAKER UNIT: ${ctx.unitCallSign}` : '',
  ].filter(Boolean).join('\n');

  return `You are the command interpreter for RMPG Flex, a police CAD (computer-aided dispatch) in Salt Lake City. A dispatcher typed or spoke ONE instruction. Turn it into tool calls from the catalog below. Do NOT refuse or lecture; if the instruction is a CAD operation, do it. If it is ambiguous or missing a required value, set "clarify" to ONE short question and return no tool_calls. If it is not a CAD instruction at all (chit-chat, a question about the world), set intent "chatter", reply "", and no tool_calls.

TOOL CATALOG (role: ${ctx.role}):
${describeCatalog(ctx.role)}

RULES:
- Call references: pass the call number or the digits the user said (e.g. "42", "0042", "CFS26-0042"). For "this call"/"that call"/"it", pass "selected call".
- Unit references: pass the call-sign as said (e.g. "12", "A12", "unit 14" → "14").
- Priorities are P1..P4 ("priority one"/"code 3" → P1). Unit statuses: available, dispatched, enroute, onscene, busy, off_duty, out_of_service ("10-8" → available, "10-7" → out_of_service, "10-23"/"10-97"/"arrived" → onscene, "10-76" → enroute).
- To clear/close a call you MUST include a disposition; if the user gave none, clarify: "Disposition for <call>?".
- Several operations in one sentence → several tool_calls, in order.
- For editing arbitrary call data use update_call_fields with snake_case CAD column names (caller_name, caller_phone, description, cross_street, vehicle_description, subject_description, direction_of_travel, weapons_involved, injuries_reported, num_subjects, case_number, court_name, plaintiff_name, service_instructions, le_agency, action_taken …). Booleans as true/false.
- "reply" is what dispatch says back, ≤ 2 short sentences, radio-terse, no emoji. Confirm what WILL be done (the system appends results).

CURRENT BOARD:
${board}

Respond with ONLY a JSON object:
{"intent":"<short_snake_case>","reply":"<text>","clarify":"<question or omit>","tool_calls":[{"tool":"<name>","params":{...}}]}`;
}

export interface PlanWithAiResult {
  output: PlannerOutput | null;
  provider?: string;
  model?: string;
  error?: string;
}

export async function planWithAi(env: PlannerEnv, text: string, ctx: CommandContext, awareness: AwarenessSnapshot): Promise<PlanWithAiResult> {
  let res: AiCallResult;
  try {
    res = await callAi(env, {
      system: buildPlannerPrompt(ctx, awareness),
      text: `INSTRUCTION: ${text}`,
      maxTokens: 700,
    });
  } catch (err) {
    return { output: null, error: err instanceof Error ? err.message : String(err) };
  }
  return { output: parsePlannerOutput(res.text), provider: res.provider, model: res.model };
}
