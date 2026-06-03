// ============================================================
// RMPG Flex — AI Report Generation (incident narrative + shift summary)
// ============================================================
// LLM helpers that turn structured CAD data + radio transcripts into written
// reports. Grounding is the whole game: the model REWRITES the facts it's
// given, it never authors new ones — a police narrative that invents details
// is a liability, so every prompt hard-forbids unsupported claims.
//
// Self-contained model path (Scout → llama-3.3-70b fallback) so report
// generation inherits the dispatcher's resilience without coupling to its
// internals. Best-effort: a model failure returns null and the caller surfaces
// a clear error rather than a fabricated report.
// ============================================================

// `Ai` is a global type from @cloudflare/workers-types.
const REPORT_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
const REPORT_FALLBACK_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

async function runReportLLM(
  ai: Ai,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string | null> {
  for (const model of [REPORT_MODEL, REPORT_FALLBACK_MODEL]) {
    try {
      const res = (await ai.run(model, {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
        temperature: 0.2, // factual, low-creativity
      } as never)) as { response?: unknown };
      // Workers AI returns `response` as a string for plain text output (no
      // JSON contract here), but be defensive in case it's wrapped.
      const text = typeof res?.response === 'string'
        ? res.response
        : (res?.response != null ? String((res.response as { reply?: unknown }).reply ?? '') : '');
      const cleaned = text.replace(/```/g, '').trim();
      if (cleaned) return cleaned;
    } catch (err) {
      console.warn(`[aiReports] ${model} failed:`, (err as Error)?.message);
    }
  }
  return null;
}

// ─── Incident narrative ─────────────────────────────────────

export interface NarrativeCall {
  call_number?: string | null;
  incident_type?: string | null;
  priority?: string | null;
  status?: string | null;
  location_address?: string | null;
  description?: string | null;
  notes?: string | null;
  disposition?: string | null;
  unit_call_signs?: string | null;
  caller_name?: string | null;
  created_at?: string | null;
  cleared_at?: string | null;
}

export interface NarrativeInput {
  call: NarrativeCall;
  /** Radio traffic associated with the call, oldest→newest. */
  transmissions: Array<{ unit: string | null; text: string; at: string | null }>;
}

const NARRATIVE_SYSTEM =
  'You are a police records clerk writing the NARRATIVE section of an incident report for Rocky Mountain Protective Group. ' +
  'Write in plain, professional past tense, third person ("Officer …", "the reporting unit …"). Be factual and concise — ' +
  '1 to 3 short paragraphs. Use ONLY the facts in the CAD record and radio traffic provided; NEVER invent names, times, ' +
  'addresses, charges, or outcomes that are not given. If a detail is unknown, omit it — do not speculate. Output ONLY the ' +
  'narrative prose, no headings, no JSON, no bullet points.';

function buildNarrativePrompt(input: NarrativeInput): string {
  const c = input.call;
  const lines: string[] = ['=== CAD RECORD ==='];
  const add = (label: string, v: unknown) => { if (v != null && String(v).trim()) lines.push(`${label}: ${v}`); };
  add('Call number', c.call_number);
  add('Type', c.incident_type);
  add('Priority', c.priority);
  add('Status', c.status);
  add('Location', c.location_address);
  add('Caller', c.caller_name);
  add('Units', c.unit_call_signs);
  add('Received', c.created_at);
  add('Cleared', c.cleared_at);
  add('Disposition', c.disposition);
  add('Description', c.description);
  add('Notes', c.notes);
  lines.push('=== RADIO TRAFFIC (oldest first) ===');
  if (input.transmissions.length) {
    for (const t of input.transmissions) lines.push(`  [${t.at || '—'}] ${t.unit || 'Unit'}: ${t.text}`);
  } else {
    lines.push('  (none logged)');
  }
  lines.push('');
  lines.push('Write the incident narrative from the above.');
  return lines.join('\n');
}

/** Draft an incident narrative from a CAD record + its radio traffic. */
export async function generateIncidentNarrative(ai: Ai, input: NarrativeInput): Promise<string | null> {
  return runReportLLM(ai, NARRATIVE_SYSTEM, buildNarrativePrompt(input), 700);
}

// ─── Shift summary ──────────────────────────────────────────

export interface ShiftSummaryInput {
  unit: string;
  hours: number;
  /** Calls the unit handled in the window. */
  calls: Array<{ call_number: string | null; incident_type: string | null; disposition: string | null; status: string | null }>;
  /** Count of radio transmissions from the unit. */
  transmissionCount: number;
  /** Distinct statuses the unit cycled through (for context). */
  statuses: string[];
}

const SHIFT_SYSTEM =
  'You are a shift supervisor writing a brief end-of-shift activity summary for one unit at Rocky Mountain Protective Group. ' +
  'Summarize what the unit did using ONLY the data provided — calls handled (by type and disposition), call volume, and radio ' +
  'activity. Be concise and factual: a short paragraph plus a few key counts. NEVER invent calls, outcomes, or details not ' +
  'given. Output ONLY the summary prose, no JSON.';

function buildShiftPrompt(input: ShiftSummaryInput): string {
  const lines: string[] = [
    `Unit: ${input.unit}`,
    `Window: last ${input.hours} hour(s)`,
    `Radio transmissions from unit: ${input.transmissionCount}`,
    `Statuses cycled: ${input.statuses.join(', ') || 'unknown'}`,
    `Calls handled (${input.calls.length}):`,
  ];
  if (input.calls.length) {
    for (const c of input.calls) {
      lines.push(`  ${c.call_number || '(no #)'} — ${c.incident_type || 'unknown'} [${c.status || '?'}${c.disposition ? `, ${c.disposition}` : ''}]`);
    }
  } else {
    lines.push('  (no calls)');
  }
  lines.push('');
  lines.push('Write the shift activity summary.');
  return lines.join('\n');
}

/** Draft an end-of-shift activity summary for a unit. */
export async function generateShiftSummary(ai: Ai, input: ShiftSummaryInput): Promise<string | null> {
  return runReportLLM(ai, SHIFT_SYSTEM, buildShiftPrompt(input), 500);
}
