/**
 * Groq AI Utility Module
 *
 * Provides AI-powered call analysis, narrative generation, and unit
 * suggestion capabilities using Groq's LLaMA 3.3-70B model.
 *
 * Graceful degradation: all functions return null when GROQ_API_KEY
 * is not configured. The CAD system works fully without AI.
 */

import Groq from 'groq-sdk';

// ---------------------------------------------------------------------------
// Client setup — null when no API key
// ---------------------------------------------------------------------------
const apiKey = process.env.GROQ_API_KEY || '';
const client = apiKey ? new Groq({ apiKey }) : null;
const MODEL = 'llama-3.3-70b-versatile';

// ---------------------------------------------------------------------------
// Rate limiter — 25 req / 60 s (stays under Groq free-tier 30 RPM)
// ---------------------------------------------------------------------------
const RATE_LIMIT = 25;
const RATE_WINDOW_MS = 60_000;
const timestamps: number[] = [];

function rateLimitOk(): boolean {
  const now = Date.now();
  // Remove expired timestamps
  while (timestamps.length > 0 && timestamps[0] <= now - RATE_WINDOW_MS) {
    timestamps.shift();
  }
  if (timestamps.length >= RATE_LIMIT) return false;
  timestamps.push(now);
  return true;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CallAnalysis {
  suggestedFlags: string[];
  safetyBriefing: string;
  severityOverride: 'moderate' | 'major' | null;
  confidence: number;
}

interface AnalyzeCallInput {
  incident_type: string;
  description?: string;
  notes?: string;
  location_address?: string;
  existing_flags?: string[];
}

interface GenerateNarrativeInput {
  notes: string;
  incident_type?: string;
  location_address?: string;
}

interface UnitInfo {
  call_sign: string;
  status: string;
  latitude?: number;
  longitude?: number;
  current_calls?: number;
  specializations?: string[];
}

interface SuggestUnitsInput {
  call: {
    incident_type: string;
    priority: number | string;
    location_address?: string;
    latitude?: number;
    longitude?: number;
    flags?: string[];
  };
  units: UnitInfo[];
}

export interface UnitSuggestion {
  call_sign: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns true when the Groq client is configured and ready. */
export function isAIAvailable(): boolean {
  return !!client;
}

/**
 * Analyze a CAD call for risk factors, suggested flags, and safety briefing.
 */
export async function analyzeCall(
  callData: AnalyzeCallInput,
): Promise<CallAnalysis | null> {
  if (!client || !rateLimitOk()) return null;

  try {
    const userContent = [
      `Incident type: ${callData.incident_type}`,
      callData.description ? `Description: ${callData.description}` : '',
      callData.notes ? `Notes: ${callData.notes}` : '',
      callData.location_address ? `Location: ${callData.location_address}` : '',
      callData.existing_flags?.length
        ? `Existing flags: ${callData.existing_flags.join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const response = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are an experienced police dispatcher/analyst for RMPG, a private security company in Salt Lake City, Utah. ' +
            'Analyze the CAD call and extract risk factors. Respond with JSON: ' +
            '{ "suggestedFlags": string[] (e.g. "WEAPONS","MENTAL_HEALTH","OFFICER_SAFETY","K9","DV","WARRANT","HAZMAT"), ' +
            '"safetyBriefing": string (1-2 sentence officer safety note), ' +
            '"severityOverride": "moderate"|"major"|null, ' +
            '"confidence": number 0-1 }. ' +
            'Only suggest flags not already present. If nothing notable, return empty flags and null severity.',
        },
        { role: 'user', content: userContent },
      ],
    });

    const text = response.choices?.[0]?.message?.content?.trim();
    if (!text) return null;

    const parsed = JSON.parse(text);

    // Validate required fields
    if (
      !Array.isArray(parsed.suggestedFlags) ||
      typeof parsed.safetyBriefing !== 'string' ||
      typeof parsed.confidence !== 'number'
    ) {
      console.warn('[groqAI] analyzeCall: invalid response shape', parsed);
      return null;
    }

    return {
      suggestedFlags: parsed.suggestedFlags,
      safetyBriefing: parsed.safetyBriefing,
      severityOverride:
        parsed.severityOverride === 'moderate' || parsed.severityOverride === 'major'
          ? parsed.severityOverride
          : null,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
    };
  } catch (err) {
    console.error('[groqAI] analyzeCall error:', err);
    return null;
  }
}

/**
 * Convert brief dispatcher notes into a proper CAD narrative
 * (third person, 2-4 sentences).
 */
export async function generateNarrative(
  input: GenerateNarrativeInput,
): Promise<string | null> {
  if (!client || !rateLimitOk()) return null;

  try {
    const userContent = [
      `Notes: ${input.notes}`,
      input.incident_type ? `Incident type: ${input.incident_type}` : '',
      input.location_address ? `Location: ${input.location_address}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const response = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.4,
      max_tokens: 200,
      messages: [
        {
          role: 'system',
          content:
            'You are a CAD narrative writer. Convert brief dispatcher notes into a professional CAD narrative. ' +
            'Write in third person, use RP (reporting party) context where applicable, and keep it to 2-4 concise sentences. ' +
            'Use law-enforcement standard language. Return only the narrative text, no labels or quotes.',
        },
        { role: 'user', content: userContent },
      ],
    });

    const text = response.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (err) {
    console.error('[groqAI] generateNarrative error:', err);
    return null;
  }
}

/**
 * Suggest the best available units to dispatch to a call based on
 * proximity, availability, specialization, and workload.
 * Returns up to 3 suggestions.
 */
export async function suggestUnits(
  input: SuggestUnitsInput,
): Promise<UnitSuggestion[] | null> {
  if (!client || !rateLimitOk()) return null;

  try {
    const callDesc = [
      `Type: ${input.call.incident_type}`,
      `Priority: ${input.call.priority}`,
      input.call.location_address ? `Location: ${input.call.location_address}` : '',
      input.call.latitude != null ? `Coords: ${input.call.latitude}, ${input.call.longitude}` : '',
      input.call.flags?.length ? `Flags: ${input.call.flags.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const unitsList = input.units
      .map((u) => {
        const parts = [
          u.call_sign,
          `status=${u.status}`,
          u.latitude != null ? `coords=${u.latitude},${u.longitude}` : '',
          u.current_calls != null ? `active_calls=${u.current_calls}` : '',
          u.specializations?.length ? `specs=${u.specializations.join(',')}` : '',
        ];
        return parts.filter(Boolean).join(' | ');
      })
      .join('\n');

    const response = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a dispatch supervisor for RMPG, a private security company in SLC, Utah. ' +
            'Suggest the best units to dispatch based on proximity, availability, specialization, and workload. ' +
            'Respond with JSON: { "suggestions": [{ "call_sign": string, "reason": string }] }. ' +
            'Max 3 suggestions. Only suggest units with available or on-patrol status. Short reasons.',
        },
        {
          role: 'user',
          content: `CALL:\n${callDesc}\n\nAVAILABLE UNITS:\n${unitsList}`,
        },
      ],
    });

    const text = response.choices?.[0]?.message?.content?.trim();
    if (!text) return null;

    const parsed = JSON.parse(text);
    const suggestions: UnitSuggestion[] = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
      : Array.isArray(parsed)
        ? parsed
        : [];

    // Validate and cap at 3
    return suggestions
      .filter(
        (s: any) => typeof s.call_sign === 'string' && typeof s.reason === 'string',
      )
      .slice(0, 3);
  } catch (err) {
    console.error('[groqAI] suggestUnits error:', err);
    return null;
  }
}
