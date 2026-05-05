/**
 * Dispatch Dialogue Agent — natural-language voice operator.
 *
 * Replaces the rigid regex-first / NLU-fallback split with an LLM-first
 * planner that emits a structured plan in one pass:
 *
 *   { reply, voice_mode, actions: [{ tool, params }], pending_followup? }
 *
 * Actions whose name matches a dispatchTools entry are delegated into the
 * existing `executeCommand` switch in routes/voice.ts (no duplicated
 * business logic). Dialogue-only tools (reply_only, mileage_capture,
 * push_to_mdt, refuse_off_topic) are handled here.
 *
 * Voice mode is decided by the *caller* via `source`, not by the LLM,
 * so the Spillman-flat path is deterministic:
 *   source='announcer' → voice_mode='spillman_flat' (terminal target announcer)
 *   source='speech'    → voice_mode='conversational' (officer talking to dispatch)
 */

import aiManager from './aiManager';
import { toolsAsPromptSection, DIALOGUE_ONLY_TOOLS } from './dispatchTools';

export type VoiceSource = 'announcer' | 'speech';
export type VoiceMode = 'spillman_flat' | 'conversational';

export interface DialogueContext {
  officer: {
    user_id: number;
    name: string;
    call_sign?: string;
    status?: string;
    gps?: { lat: number; lng: number; address?: string };
  };
  current_call?: {
    call_number: string;
    incident_type: string;
    priority: string;
    location_address?: string;
  };
  recent_turns: Array<{ role: 'officer' | 'dispatch'; text: string }>;
  pending_followup?: PendingFollowup;
  refusal_count?: number; // tracks pushback round on off-topic asks
}

export interface PendingFollowup {
  kind: 'starting_mileage' | 'ending_mileage' | 'identity_choice' | 'confirm_action';
  prompt: string;
  expires_at: number;
  meta?: Record<string, any>;
}

export interface PlannedAction {
  tool: string;
  params: Record<string, any>;
}

export interface DialoguePlan {
  reply: string;
  actions: PlannedAction[];
  voice_mode: VoiceMode;
  pending_followup?: PendingFollowup;
  off_topic?: boolean;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(ctx: DialogueContext, source: VoiceSource): string {
  const officerLine = ctx.officer.call_sign
    ? `${ctx.officer.name} operating ${ctx.officer.call_sign}, current status: ${ctx.officer.status ?? 'unknown'}.`
    : `${ctx.officer.name}, no active unit.`;

  const callLine = ctx.current_call
    ? `Currently assigned: ${ctx.current_call.call_number}, ${ctx.current_call.incident_type}, priority ${ctx.current_call.priority}, at ${ctx.current_call.location_address ?? 'unknown'}.`
    : 'No active call assignment.';

  const gpsLine = ctx.officer.gps?.address
    ? `Officer GPS: ${ctx.officer.gps.address}.`
    : ctx.officer.gps
    ? `Officer GPS: ${ctx.officer.gps.lat.toFixed(5)}, ${ctx.officer.gps.lng.toFixed(5)}.`
    : 'Officer GPS unavailable.';

  const pendingLine = ctx.pending_followup
    ? `IMPORTANT: there is a pending follow-up: "${ctx.pending_followup.prompt}" (kind: ${ctx.pending_followup.kind}). Treat the next officer utterance as a response to that prompt unless it is clearly a new request.`
    : '';

  const voiceLine = source === 'announcer'
    ? `VOICE MODE: SPILLMAN FLAT. The officer triggered a target announcer from the terminal. Reply in the clipped Spillman/Motorola CAD style: short fragments, no filler, plate/name/incident-type read in canonical order. Do not editorialize. Example: "Plate one alpha bravo charlie. Twenty-twenty Honda Civic, blue. Registered Smith, John. No wants no warrants."`
    : `VOICE MODE: CONVERSATIONAL HUMAN. The officer is speaking to dispatch in their own words. Reply with full sentences, natural cadence, professional but warm. Acknowledge what they said before answering. Example: "Copy that, you're looking for the plate — coming back as a 2020 Honda Civic, blue, registered to a John Smith. No wants, no warrants on the registered owner."`;

  const refusalLine = (ctx.refusal_count ?? 0) >= 1
    ? `Officer has been redirected once already on off-topic requests. If they push again, you may grant the request once if it is *adjacent* to police work (research, weather, traffic conditions, sports score during a slow shift). If it remains genuinely off-mission (personal errands, social media, unrelated entertainment), use refuse_off_topic and stop relenting.`
    : `Off-topic policy: Work-related research is ALWAYS granted (legal questions, statute lookups, geography, weather, traffic, news, properties, persons, businesses, vehicles, drugs, weapons, tactics — anything an officer might legitimately ask about). For genuinely off-mission requests (personal errands, social media, jokes, entertainment), give one polite redirect first. Don't refuse_off_topic on the first ask — push back gently in the reply, but plan reply_only.`;

  return `You are the on-air dispatcher for Rocky Mountain Protective Group, a Salt Lake City law-enforcement / private-security agency. You communicate by voice with officers in the field. You are NOT a chatbot; you are a working dispatcher with situational awareness.

OFFICER CONTEXT:
${officerLine}
${callLine}
${gpsLine}
${pendingLine}

${voiceLine}

YOUR OUTPUT:
You MUST emit a single JSON object (no markdown, no commentary):
{
  "reply": "<what you would say over the radio — under 40 words for conversational, under 20 for spillman_flat>",
  "actions": [{"tool": "<tool_name>", "params": {...}}],
  "pending_followup": null OR {"kind":"starting_mileage|ending_mileage|identity_choice|confirm_action","prompt":"<what to ask next>"},
  "off_topic": false
}

AVAILABLE TOOLS (these are the actions you can plan; the system executes them):
${toolsAsPromptSection()}

10-CODE BEHAVIOR (CRITICAL):
- "10-97" / "on scene" / "I'm on scene" → plan status_update(status=on_scene) AND set pending_followup with kind="starting_mileage" prompt="Starting mileage?" so the next utterance captures the odometer reading.
- "10-8" / "available" / "clear" / "back in service" → plan status_update(status=available) AND set pending_followup kind="ending_mileage" prompt="Ending mileage?".
- When pending_followup is starting_mileage or ending_mileage AND the officer says a number, plan mileage_capture(kind=..., value=...) and clear the followup.
- "10-76" / "en route" → status_update(status=en_route). No mileage prompt.
- "10-4" / "copy" / "roger" → acknowledge.
- "10-99" / "officer down" / "shots fired" / "panic" / "emergency traffic" → DO NOT plan any panic-related action. These phrases are NEVER a panic trigger via voice. Panic alarms fire ONLY from a deliberate manual press of the physical PANIC button. If an officer says one of these phrases, plan reply_only and respond by reminding them to press the panic button if it's a real emergency: "If this is an emergency, press the PANIC button. Otherwise, what do you need?"

CONFIRMATION POLICY:
- start_pursuit and Code-3 dispatch require confirmation: set pending_followup kind="confirm_action" and ask "Confirm pursuit on this vehicle?" — do NOT execute the action until confirmed on the next turn.
- The officer_down / panic action is NOT available via voice at all (see above).
- Everything else auto-executes.

IDENTITY DISAMBIGUATION:
When run_name or run_plate would yield more than 3 hits, plan push_to_mdt(result_kind=..., count=N) AND a brief verbal ack like "Six hits on Smith, on your screen." Do not read all of them aloud.

HALLUCINATION GUARD:
You do NOT know live system state — you only know what is in OFFICER CONTEXT above. If the officer asks about something you cannot answer from context (a specific case, plate, name, location, unit position), plan the appropriate tool to fetch it. NEVER invent data. If unsure, your reply must be exactly: "Stand by while I check the system." and you must plan the tool that will answer.

${refusalLine}

PUSHING BACK ON OFF-TOPIC (first round):
If the officer asks something off-mission, set off_topic=true, plan reply_only, and reply with a gentle redirect like "We're on the clock — anything operational I can help with?" or "Let's keep the channel for ops. What do you need?". Do NOT refuse outright on round one.

EXAMPLES:
Officer: "10-97" → {"reply":"Copy 12, on scene.","actions":[{"tool":"status_update","params":{"status":"on_scene"}}],"pending_followup":{"kind":"starting_mileage","prompt":"Starting mileage?"}}
Officer: "84321" (with pending starting_mileage) → {"reply":"Eight-four-three-two-one, logged.","actions":[{"tool":"mileage_capture","params":{"kind":"starting","value":84321}}]}
Officer: "Who's closest to me?" → {"reply":"Stand by while I check the system.","actions":[{"tool":"nearest_units","params":{}}]}
Officer: "Run plate 1ABC234" (announcer) → {"reply":"Stand by.","actions":[{"tool":"run_plate","params":{"plate":"1ABC234"}}]}
Officer: "What time does the game start tonight?" → {"reply":"Let's keep it operational. Need anything on scene?","actions":[{"tool":"reply_only","params":{}}],"off_topic":true}

Now process the officer's transcript and emit the JSON plan.`;
}

// ---------------------------------------------------------------------------
// Plan a turn
// ---------------------------------------------------------------------------

export async function planDialogueTurn(
  transcript: string,
  ctx: DialogueContext,
  source: VoiceSource,
): Promise<DialoguePlan | null> {
  if (!transcript || transcript.trim().length === 0) return null;

  const sysPrompt = buildSystemPrompt(ctx, source);
  const turnsBlock = ctx.recent_turns.length > 0
    ? `\n\nRECENT CONVERSATION (oldest first):\n${ctx.recent_turns.slice(-6).map(t => `${t.role}: ${t.text}`).join('\n')}\n`
    : '';

  const userMessage = `${turnsBlock}\nOfficer just said: "${transcript.trim()}"\n\nEmit the JSON plan now.`;

  const result = await aiManager.chat(sysPrompt, userMessage, {
    temperature: 0.2,
    maxTokens: 350,
    jsonMode: true,
  });
  if (!result) return null;

  let parsed: any;
  try { parsed = JSON.parse(result); } catch { return null; }

  const plan: DialoguePlan = {
    reply: typeof parsed.reply === 'string' ? parsed.reply : '',
    actions: Array.isArray(parsed.actions)
      ? parsed.actions.filter((a: any) => a && typeof a.tool === 'string').map((a: any) => ({
          tool: a.tool,
          params: a.params && typeof a.params === 'object' ? a.params : {},
        }))
      : [],
    voice_mode: source === 'announcer' ? 'spillman_flat' : 'conversational',
    off_topic: parsed.off_topic === true,
  };

  if (parsed.pending_followup && typeof parsed.pending_followup === 'object') {
    const pf = parsed.pending_followup;
    if (pf.kind && pf.prompt) {
      plan.pending_followup = {
        kind: pf.kind,
        prompt: pf.prompt,
        expires_at: Date.now() + 60_000,
        meta: pf.meta,
      };
    }
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Helpers exposed for the route
// ---------------------------------------------------------------------------

export function isDialogueOnlyTool(name: string): boolean {
  return DIALOGUE_ONLY_TOOLS.has(name);
}

/**
 * If the officer said something that looks like a bare number while a mileage
 * follow-up is pending, return a synthetic plan without an LLM round-trip.
 * Saves ~400ms on the most common turn in the on-scene dialogue.
 */
export function tryFastMileageCapture(
  transcript: string,
  ctx: DialogueContext,
): DialoguePlan | null {
  const pf = ctx.pending_followup;
  if (!pf) return null;
  if (pf.kind !== 'starting_mileage' && pf.kind !== 'ending_mileage') return null;
  const m = transcript.trim().match(/^[\s,]*(\d{2,7})[\s.,]*$/);
  if (!m) return null;
  const value = parseInt(m[1], 10);
  const kind = pf.kind === 'starting_mileage' ? 'starting' : 'ending';
  return {
    reply: `${value}, logged.`,
    actions: [{ tool: 'mileage_capture', params: { kind, value } }],
    voice_mode: 'spillman_flat',
  };
}
