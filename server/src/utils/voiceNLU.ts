/**
 * Voice NLU Engine — AI-Powered Natural Language Understanding
 *
 * Uses the aiManager (Groq LLM) to parse free-form voice commands
 * when regex matching fails, and to generate follow-up questions
 * and tactical assessments for dispatch operations.
 */

import aiManager from './aiManager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NLUResult {
  action: string;
  params: Record<string, any>;
  confidence: number;
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const NLU_SYSTEM_PROMPT = `You are a police dispatch voice command parser. Parse the officer's spoken command into a structured action.

Available actions:
- status_update: Officer updating their status. Params: status (string), call_sign (string optional)
- acknowledge: Acknowledge a dispatch or assignment. Params: call_id (number optional)
- request_backup: Request backup units. Params: urgency ("routine"|"code2"|"code3"), reason (string optional)
- request_ems: Request EMS/ambulance. Params: reason (string optional), injuries (number optional)
- request_k9: Request K-9 unit. Params: reason (string optional)
- run_plate: Run a license plate. Params: plate (string), state (string optional)
- next_call: Request next pending call. Params: none
- start_pursuit: Initiate vehicle pursuit. Params: vehicle_description (string optional), direction (string optional), speed (string optional)
- mark_evidence: Mark evidence at scene. Params: evidence_type (string optional), description (string optional)
- create_call: Create a new call for service. Params: call_type (string), address (string optional), description (string optional)
- case_status: Check status of a case. Params: case_number (string optional)
- link_case: Link current call to a case. Params: case_number (string)
- start_statement: Begin recording a statement. Params: subject_name (string optional)
- end_statement: Stop recording a statement. Params: none
- code_4: Mark scene as code 4 (no further assistance needed). Params: call_id (number optional)

Respond with ONLY valid JSON in this exact format:
{ "action": "action_name", "params": { ... }, "confidence": 0.0-1.0 }

Rules:
- confidence 0.9+ for clear, unambiguous commands
- confidence 0.5-0.8 for commands requiring interpretation
- confidence below 0.5 if the command is unclear or doesn't match any action
- Only include params that are explicitly mentioned or clearly implied
- If no action matches, use action "unknown" with confidence 0.0`;

const FOLLOWUP_SYSTEM_PROMPT = `You are a police dispatch assistant speaking to an officer over radio.
Generate a brief spoken follow-up question to get missing information.
Keep it under 20 words. Be direct and professional. Use 10-codes sparingly.`;

const TACTICAL_SYSTEM_PROMPT = `You are a tactical operations advisor for a police dispatch system.
Provide 1-2 sentence tactical recommendations. Be direct and actionable.
Mention specific unit types when appropriate (SWAT, K-9, air support, detective, CSI).
Consider officer safety as the top priority.`;

// ---------------------------------------------------------------------------
// Parse voice transcript into structured command
// ---------------------------------------------------------------------------

export async function parseWithNLU(transcript: string): Promise<NLUResult | null> {
  if (!transcript || transcript.trim().length === 0) {
    return null;
  }

  const result = await aiManager.chat(
    NLU_SYSTEM_PROMPT,
    transcript.trim(),
    {
      temperature: 0.1,
      maxTokens: 200,
      jsonMode: true,
    },
  );

  if (!result) return null;

  try {
    const parsed = JSON.parse(result);
    return {
      action: parsed.action ?? 'unknown',
      params: parsed.params ?? {},
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    };
  } catch {
    // LLM returned non-JSON — treat as failure
    return null;
  }
}

// ---------------------------------------------------------------------------
// Generate follow-up question for missing fields
// ---------------------------------------------------------------------------

export async function generateFollowUp(
  action: string,
  missingFields: string[],
  conversationHistory: string[] = [],
): Promise<string | null> {
  const userMessage = [
    `Action: ${action}`,
    `Missing fields: ${missingFields.join(', ')}`,
    conversationHistory.length > 0
      ? `Recent conversation:\n${conversationHistory.slice(-3).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const result = await aiManager.chat(
    FOLLOWUP_SYSTEM_PROMPT,
    userMessage,
    {
      temperature: 0.3,
      maxTokens: 50,
    },
  );

  return result;
}

// ---------------------------------------------------------------------------
// Generate tactical assessment for major calls
// ---------------------------------------------------------------------------

export async function generateTacticalAssessment(
  callData: Record<string, any>,
): Promise<string | null> {
  const userMessage = JSON.stringify(callData, null, 2);

  const result = await aiManager.chat(
    TACTICAL_SYSTEM_PROMPT,
    `Assess this call and provide a tactical recommendation:\n${userMessage}`,
    {
      temperature: 0.2,
      maxTokens: 100,
    },
  );

  return result;
}
