// ============================================================
// RMPG Flex — Serve Intake Phase 1 Quality Gate: heuristic checker
// ============================================================
// runHeuristics() performs fast, deterministic checks against the
// fields extracted by serveIntakeExtract.ts. It is intentionally
// source-agnostic — it only cares about the extracted value and
// whether that value appears in the raw document text.
//
// The LLM-backed judgeMerged() function is Task 5 and lives in a
// separate export of this same file (not implemented here).
// ============================================================

import type { ExtractedField } from './serveIntakeExtract';

export interface FieldVerdict {
  ok: boolean;
  reason: string | null;
  suggested_value: string | null;
  judge_confidence: number;
  source: 'heuristic' | 'claude' | 'workers_ai';
}

export interface RawDoc { name: string; text: string }

// Full US state/territory 2-letter codes.
const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC','PR','GU','VI','AS','MP',
]);

// 5-digit or 5+4 with optional hyphen (84084 or 84084-1234).
const ZIP_RE = /^\d{5}(?:-?\d{4})?$/;

// ISO date YYYY-MM-DD.
const DOB_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// ── Helpers ──────────────────────────────────────────────────

function containsCaseInsensitive(rawDocs: RawDoc[], needle: string): boolean {
  if (!needle.trim()) return false;
  const n = needle.toLowerCase();
  return rawDocs.some(d => d.text.toLowerCase().includes(n));
}

function pass(): FieldVerdict {
  return { ok: true, reason: null, suggested_value: null, judge_confidence: 0.95, source: 'heuristic' };
}

function fail(reason: string): FieldVerdict {
  return { ok: false, reason, suggested_value: null, judge_confidence: 0.9, source: 'heuristic' };
}

// ── Public API ───────────────────────────────────────────────

/**
 * Run deterministic heuristic checks on the extracted fields.
 *
 * Only fields present in `fields` are checked — callers receive an
 * entry in the output only for keys they passed in.  Unknown keys
 * are ignored so the function remains forward-compatible as the
 * field set grows.
 *
 * Checks performed:
 *   - Name fields (first/last/business): value must appear verbatim
 *     (case-insensitive) in at least one raw document.
 *   - recipient_address: at least one whitespace-delimited token of
 *     ≥3 chars must appear in a raw document.
 *   - recipient_state: must be a real US 2-letter state/territory code.
 *   - recipient_zip: must match 5-digit or ZIP+4 format.
 *   - recipient_dob: must be ISO YYYY-MM-DD in the range 1900..today
 *     (uses Date.UTC to avoid timezone drift on the host).
 */
export function runHeuristics(
  fields: Record<string, ExtractedField>,
  rawDocs: RawDoc[],
): Record<string, FieldVerdict> {
  const out: Record<string, FieldVerdict> = {};

  // ── Name fields: must appear in source text ────────────────
  for (const key of ['recipient_first_name', 'recipient_last_name', 'recipient_business_name'] as const) {
    const f = fields[key];
    if (!f?.value) continue;
    out[key] = containsCaseInsensitive(rawDocs, f.value)
      ? pass()
      : fail('value not found in any source document');
  }

  // ── Address: at least one significant token must appear ────
  const addr = fields.recipient_address;
  if (addr?.value) {
    const tokens = addr.value.split(/\s+/).filter(t => t.length >= 3);
    const hit = tokens.some(t => containsCaseInsensitive(rawDocs, t));
    out.recipient_address = hit ? pass() : fail('no token appears in any source document');
  }

  // ── State: valid US 2-letter code ─────────────────────────
  const state = fields.recipient_state;
  if (state?.value) {
    out.recipient_state = US_STATES.has(state.value.toUpperCase())
      ? pass()
      : fail(`'${state.value}' is not a valid US state or territory code`);
  }

  // ── ZIP: 5-digit or ZIP+4 ─────────────────────────────────
  const zip = fields.recipient_zip;
  if (zip?.value) {
    out.recipient_zip = ZIP_RE.test(zip.value)
      ? pass()
      : fail('zip is not 5 or 9 digits');
  }

  // ── DOB: ISO date in 1900..today ──────────────────────────
  // Use Date.UTC throughout to avoid the "one day off" timezone bug
  // that afflicts `new Date(isoString)` parsing in non-UTC environments.
  const dob = fields.recipient_dob;
  if (dob?.value) {
    const m = DOB_RE.exec(dob.value);
    if (!m) {
      out.recipient_dob = fail('dob is not in ISO YYYY-MM-DD format');
    } else {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      const ms = Date.UTC(year, month - 1, day);
      const min = Date.UTC(1900, 0, 1);
      const now = Date.now();
      out.recipient_dob = (ms >= min && ms <= now)
        ? pass()
        : fail('dob outside valid range (1900–today)');
    }
  }

  return out;
}

// ============================================================
// Task 5 — LLM judge + fallback chain (judgeMerged)
// ============================================================

import { callAi } from './callAi';

const AI_TIMEOUT_MS = 35_000;
const RAW_RESPONSE_CAP = 8 * 1024;
const PER_DOC_TEXT_CAP = 40_000;

export interface JudgeResult {
  verdicts: Record<string, FieldVerdict>;
  model: string;
  ms: number;
  raw_response: string;
  flagged_field_count: number;
  overall_status: 'clean' | 'needs_review' | 'error';
  fallback_chain: ('heuristic' | 'claude' | 'workers_ai')[];
}

const SYSTEM_PROMPT = `You are a verification system for legal process-service extractions.
You receive: (1) a JSON object of FIELDS each with {value, confidence}; (2) the raw text
of each source document. For EACH field, decide whether the value is supported by the raw
text. Return ONLY valid JSON of shape: { "verdicts": { "<field>": { "ok": boolean,
"reason": string|null, "suggested_value": string|null, "judge_confidence": number } } }.
Be conservative — when in doubt, set ok=false with a reason. Do NOT invent fields that
were not in the input.`;

function buildJudgePrompt(
  fields: Record<string, ExtractedField>,
  rawDocs: RawDoc[],
  docTypes: string[],
): string {
  const truncatedDocs = rawDocs.map(d => ({
    name: d.name,
    text: d.text.length > PER_DOC_TEXT_CAP ? d.text.slice(0, PER_DOC_TEXT_CAP) + '\n…[truncated]' : d.text,
  }));
  return [
    'DOC TYPES (one per file, in order): ' + JSON.stringify(docTypes),
    'FIELDS:',
    JSON.stringify(fields, null, 2),
    'RAW DOCUMENTS:',
    truncatedDocs.map(d => `--- ${d.name} ---\n${d.text}`).join('\n\n'),
    'Return ONLY the JSON object.',
  ].join('\n\n');
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

function tryParseJudgeJson(text: string): Record<string, FieldVerdict> | null {
  try {
    const stripped = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '')
      .trim();
    const parsed = JSON.parse(stripped) as { verdicts?: Record<string, any> };
    const out: Record<string, FieldVerdict> = {};
    for (const [k, v] of Object.entries(parsed.verdicts ?? {})) {
      if (!v || typeof v !== 'object') continue;
      out[k] = {
        ok: !!(v as any).ok,
        reason: typeof (v as any).reason === 'string' ? (v as any).reason.slice(0, 120) : null,
        suggested_value: typeof (v as any).suggested_value === 'string' ? (v as any).suggested_value : null,
        judge_confidence: typeof (v as any).judge_confidence === 'number' ? (v as any).judge_confidence : 0.5,
        source: 'claude',
      };
    }
    return out;
  } catch {
    return null;
  }
}

// Merge LLM verdicts ON TOP of heuristic verdicts, but with the floor rule:
// a heuristic-flagged field cannot be upgraded to clean by the LLM.
function mergeVerdicts(
  heuristic: Record<string, FieldVerdict>,
  llm: Record<string, FieldVerdict> | null,
): Record<string, FieldVerdict> {
  const out: Record<string, FieldVerdict> = { ...heuristic };
  if (!llm) return out;
  for (const [k, v] of Object.entries(llm)) {
    if (out[k]?.ok === false) continue;
    out[k] = v;
  }
  return out;
}

export async function judgeMerged(
  env: { DB: any; AI: any },
  fields: Record<string, ExtractedField>,
  rawDocs: RawDoc[],
  docTypes: string[],
): Promise<JudgeResult> {
  const started = Date.now();
  const fallback_chain: ('heuristic' | 'claude' | 'workers_ai')[] = ['heuristic'];

  const heuristic = runHeuristics(fields, rawDocs);
  let llm: Record<string, FieldVerdict> | null = null;
  let model = 'heuristic-only';
  let rawResponse = '';

  // Skip the LLM entirely when heuristic produced nothing AND every field's
  // self-confidence is high (>= 0.7). Saves the 10–15s tax on clean packets.
  const heuristicFlagged = Object.values(heuristic).some(v => !v.ok);
  const anyLowConf = Object.values(fields).some(f => f.value && f.confidence < 0.7);

  if (heuristicFlagged || anyLowConf) {
    try {
      const r = await withTimeout(
        callAi(env as any, {
          system: SYSTEM_PROMPT,
          text: buildJudgePrompt(fields, rawDocs, docTypes),
          maxTokens: 1024,
          providers: ['claude', 'workers-ai'],
        }),
        AI_TIMEOUT_MS,
        'judge LLM timed out',
      );
      rawResponse = r.text.length > RAW_RESPONSE_CAP ? r.text.slice(0, RAW_RESPONSE_CAP) : r.text;
      llm = tryParseJudgeJson(r.text);
      model = `${r.provider}:${r.model}`;
      fallback_chain.push(r.provider === 'claude' ? 'claude' : 'workers_ai');
    } catch {
      // LLM stage failed — heuristic-only verdict stands.
    }
  }

  const verdicts = mergeVerdicts(heuristic, llm);
  const flagged_field_count = Object.values(verdicts).filter(v => !v.ok).length;
  const overall_status: JudgeResult['overall_status'] =
    flagged_field_count > 0 ? 'needs_review' : 'clean';

  return {
    verdicts,
    model,
    ms: Date.now() - started,
    raw_response: rawResponse,
    flagged_field_count,
    overall_status,
    fallback_chain,
  };
}
