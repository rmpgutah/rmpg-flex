// ============================================================
// RMPG Flex — Serve Intake structured-field extraction
// ============================================================
// Two paths, both Workers-AI native:
//
//   extractFromText() — Tesseract / pdftotext / pdfjs already gave
//   us raw text. Run Llama 3.3 70B (instruct) with a JSON-schema
//   response_format to project the text into the field shape the
//   client UI expects (OcrScanResult).
//
//   extractFromImage() — uploaded raster (no PDF text layer). Send
//   the bytes to Llama 3.2 11B Vision — single-pass OCR + extraction.
//   Avoids round-tripping through the container Tesseract path.
//
// Both paths return the same shape so the route handler doesn't
// branch on which engine ran. confidence is the model's own
// self-report when present, else derived from how many target
// fields it filled.
// ============================================================

const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as const;
const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct' as const;

// Field set sourced from the client's OcrScanResult + IntakeResult
// shapes (client/src/pages/ServeIntakePage.tsx). Keeping the list
// in one place so the JSON-schema prompt and the post-processor
// stay aligned. Add a field here and both ends pick it up.
export const TARGET_FIELDS = [
  // ── Recipient (the party being served) ────────────────────
  // recipient_type lets the commit step decide whether to create a
  // person row (last_name='Smith'), a business row (Steel Encounters
  // Inc.), or both (corporate service to a registered agent).
  'recipient_type',                       // 'person' | 'business'
  'recipient_first_name', 'recipient_middle_name', 'recipient_last_name',
  'recipient_business_name',              // populated when recipient_type='business'
  'recipient_dob', 'recipient_address', 'recipient_city',
  'recipient_state', 'recipient_zip', 'recipient_phone',
  // Registered agent — separate from recipient because for corporate
  // service the agent IS the human person we physically serve.
  'registered_agent_name',
  // ── Case / court ──────────────────────────────────────────
  'plaintiff', 'defendant', 'case_number', 'court_name', 'jurisdiction',
  'document_type', 'document_subtype', 'filing_date', 'service_deadline',
  'hearing_date',
  // ── Counsel / hiring party ────────────────────────────────
  'attorney_name', 'attorney_phone', 'attorney_email', 'attorney_bar_number',
  'client_name', 'job_number', 'fee_amount',
  // ── Service mechanics ─────────────────────────────────────
  'process_type', 'service_windows', 'service_instructions',
  'server_name', 'priority',
] as const;

export type TargetField = typeof TARGET_FIELDS[number];

export interface ExtractedField { value: string; confidence: number }

export interface ExtractionResult {
  success: boolean;
  documentType: string;
  confidence: number;
  fields: Record<string, ExtractedField>;
  rawText: string;
  allDates: string[];
  model: string;
  ms: number;
  error?: string;
}

// ── Extraction prompt ────────────────────────────────────────
// Llama 3.3 follows JSON-mode constraints reliably when the schema
// is concrete and the system prompt is unambiguous. We pin the doc
// type to a closed enum that matches the client's DOCUMENT_TYPES
// list so the dropdown value lands correctly without translation.
const DOC_TYPES = [
  'court_filing', 'field_sheet', 'info_page', 'affidavit', 'summons',
  'complaint', 'subpoena', 'eviction', 'restraining_order',
  'identification', 'correspondence', 'other',
] as const;

const SYSTEM_PROMPT = `You are an extraction system for legal process-service documents.
You return STRICT JSON only — no commentary, no markdown fences.
Confidence is your own per-field self-report on a 0..1 scale:
  • 1.0 — value is unambiguously printed in the document
  • 0.7 — value is present but partially obscured or inferred from context
  • 0.4 — best guess; reader should verify
  • 0.0 — field is not present; return empty string with confidence 0
Never invent values. If unsure, return empty string with confidence 0.
For dates use ISO format (YYYY-MM-DD); for phone numbers use digits only.`;

// Llama 3.3 70B has a 128K-token context. 24K chars (~6K tokens) was
// far too conservative — a multi-document packet (e.g. a 47K-char court
// docket bundled with field sheets) got truncated mid-stream, and the
// recipient data could fall past the cut. 90K chars (~22K tokens) leaves
// generous headroom for the system prompt + JSON schema while covering
// virtually every real serve packet in one pass.
const MAX_PROMPT_CHARS = 90_000;

function buildUserPrompt(text: string): string {
  return `Extract the fields below from this process-service document.

Document text:
"""
${text.slice(0, MAX_PROMPT_CHARS)}
"""

Return JSON with EXACTLY this shape:
{
  "documentType": one of ${JSON.stringify(DOC_TYPES)},
  "confidence": overall 0..1,
  "allDates": [list of every date string you see, original format],
  "fields": {
    ${TARGET_FIELDS.map((f) => `"${f}": { "value": "...", "confidence": 0..1 }`).join(',\n    ')}
  }
}`;
}

// ── Response schema ──────────────────────────────────────────
// Workers AI accepts response_format with a JSON schema. The model
// reliably emits matching JSON; we still defensively parse.
const RESPONSE_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'serve_intake_extraction',
    schema: {
      type: 'object',
      required: ['documentType', 'confidence', 'fields'],
      additionalProperties: false,
      properties: {
        documentType: { type: 'string', enum: [...DOC_TYPES] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        allDates: { type: 'array', items: { type: 'string' } },
        fields: {
          type: 'object',
          additionalProperties: false,
          properties: Object.fromEntries(
            TARGET_FIELDS.map((f) => [f, {
              type: 'object',
              required: ['value', 'confidence'],
              additionalProperties: false,
              properties: {
                value: { type: 'string' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
              },
            }]),
          ),
        },
      },
    },
    strict: true,
  },
} as const;

function normalize(parsed: any, rawText: string, model: string, ms: number): ExtractionResult {
  const fields: Record<string, ExtractedField> = {};
  const incoming = (parsed?.fields ?? {}) as Record<string, any>;
  for (const f of TARGET_FIELDS) {
    const v = incoming[f];
    if (v && typeof v === 'object') {
      fields[f] = {
        value: typeof v.value === 'string' ? v.value : '',
        confidence: typeof v.confidence === 'number' ? Math.max(0, Math.min(1, v.confidence)) : 0,
      };
    } else {
      fields[f] = { value: '', confidence: 0 };
    }
  }
  const filled = Object.values(fields).filter((f) => f.value && f.confidence > 0.3).length;
  const fallbackConfidence = Math.min(1, filled / 8);
  const docType = DOC_TYPES.includes(parsed?.documentType) ? parsed.documentType : 'other';

  return {
    success: filled > 0,
    documentType: docType,
    confidence: typeof parsed?.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : fallbackConfidence,
    fields,
    rawText,
    allDates: Array.isArray(parsed?.allDates) ? parsed.allDates.slice(0, 50).map(String) : [],
    model,
    ms,
  };
}

function tryParseModelJson(out: any): any {
  // Workers AI returns either { response: string } or
  // { response: { … parsed JSON object … } } depending on whether
  // response_format coerced server-side. Handle both.
  const raw = out?.response;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return {};
  // Strip ```json fences if the model added them anyway.
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  // Last-ditch: pull the first {...} block out of free text.
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch { /* ignore */ }
  }
  return {};
}

export async function extractFromText(
  ai: Ai,
  rawText: string,
): Promise<ExtractionResult> {
  const trimmed = rawText.trim();
  if (trimmed.length < 20) {
    return {
      success: false, documentType: 'other', confidence: 0,
      fields: Object.fromEntries(TARGET_FIELDS.map((f) => [f, { value: '', confidence: 0 }])) as any,
      rawText, allDates: [], model: TEXT_MODEL, ms: 0,
      error: 'Insufficient text to extract',
    };
  }
  const started = Date.now();
  // Workers AI calls can fail transiently (rate limit, model cold-start,
  // gateway 5xx) — and a json_schema response occasionally comes back
  // unparseable. One retry on a failed/empty result turns most of those
  // into a clean extraction. lastErr is surfaced so the caller can store
  // it on the doc row instead of silently recording confidence=0.
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await ai.run(TEXT_MODEL, {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(trimmed) },
        ],
        response_format: RESPONSE_SCHEMA,
        temperature: 0.1,
        max_tokens: 2048,
      } as any);
      const parsed = tryParseModelJson(out);
      const result = normalize(parsed, rawText, TEXT_MODEL, Date.now() - started);
      // A 0-field result on the first pass is usually a transient parse
      // miss — retry once before giving up.
      if (result.success || attempt === 1) {
        if (!result.success && !result.error) result.error = 'Model returned no extractable fields';
        return result;
      }
      lastErr = 'First pass returned no fields; retrying';
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      // fall through to retry (or exit on second attempt)
    }
  }
  return {
    success: false, documentType: 'other', confidence: 0,
    fields: Object.fromEntries(TARGET_FIELDS.map((f) => [f, { value: '', confidence: 0 }])) as any,
    rawText, allDates: [], model: TEXT_MODEL, ms: Date.now() - started,
    error: lastErr || 'Extraction failed after retry',
  };
}

// Llama 3.2 Vision accepts the image as a number-array of bytes.
// Going over ~5 MB causes the model gateway to reject the call, so
// callers must downscale large rasters before getting here.
const MAX_VISION_BYTES = 4 * 1024 * 1024;

export async function extractFromImage(
  ai: Ai,
  imageBytes: Uint8Array,
): Promise<ExtractionResult> {
  if (imageBytes.byteLength === 0 || imageBytes.byteLength > MAX_VISION_BYTES) {
    return {
      success: false, documentType: 'other', confidence: 0,
      fields: Object.fromEntries(TARGET_FIELDS.map((f) => [f, { value: '', confidence: 0 }])) as any,
      rawText: '', allDates: [], model: VISION_MODEL, ms: 0,
      error: `Image size out of range (0 < n <= ${MAX_VISION_BYTES})`,
    };
  }
  const started = Date.now();
  try {
    const out = await ai.run(VISION_MODEL, {
      image: Array.from(imageBytes),
      prompt: `${SYSTEM_PROMPT}\n\n${buildUserPrompt('(image-only document — read text via OCR then extract)')}`,
      max_tokens: 2048,
      temperature: 0.1,
    } as any);
    const parsed = tryParseModelJson(out);
    // Vision model doesn't always echo back rawText; synthesise it
    // from whatever values it returned so the audit trail has something.
    const synthesized = Object.values<any>(parsed?.fields ?? {})
      .map((f) => f?.value).filter(Boolean).join(' | ');
    return normalize(parsed, synthesized, VISION_MODEL, Date.now() - started);
  } catch (err) {
    return {
      success: false, documentType: 'other', confidence: 0,
      fields: Object.fromEntries(TARGET_FIELDS.map((f) => [f, { value: '', confidence: 0 }])) as any,
      rawText: '', allDates: [], model: VISION_MODEL, ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Container OCR helper ──────────────────────────────────────
// Forward an in-memory buffer to the PDF Tools container's
// /extract-text endpoint. The container handles pdftotext + Tesseract
// fallback; we just wrap the multipart request.
export async function extractTextFromPdf(
  container: { fetch: (req: Request) => Promise<Response> },
  pdfBytes: Uint8Array,
  fileName: string,
): Promise<{ text: string; page_count: number; ocr_used: boolean }> {
  const form = new FormData();
  form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), fileName);
  const res = await container.fetch(new Request('http://container/extract-text', {
    method: 'POST',
    body: form,
  }));
  if (!res.ok) {
    throw new Error(`extract-text container ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const body = await res.json() as { text?: string; page_count?: number; ocr_used?: boolean };
  return {
    text: body.text ?? '',
    page_count: body.page_count ?? 0,
    ocr_used: !!body.ocr_used,
  };
}

// Map the LLM-extracted fields into the column shape serve_queue expects.
// The client's `processIntake` POST shape (IntakeResult.extracted) is
// derived from this — keep the mapping in lock-step.
// Allowed serve_queue.priority values (from migration 0030 CHECK).
// The CAD `calls_for_service.priority` ladder is P1..P4 — see
// serveIntakeRecords.cadPriority() for the mapping into that ladder.
export type ServePriority = 'routine' | 'normal' | 'rush' | 'urgent';

const SERVE_PRIORITIES: ServePriority[] = ['routine', 'normal', 'rush', 'urgent'];

export function normalizePriority(raw: string): ServePriority {
  const lower = raw.trim().toLowerCase();
  if (lower === 'hot rush' || lower === 'hot_rush') return 'urgent';
  if (SERVE_PRIORITIES.includes(lower as ServePriority)) return lower as ServePriority;
  return 'normal';
}

export interface QueueRow {
  recipient_name: string | null;
  recipient_address: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  recipient_zip: string | null;
  document_type: string | null;
  case_number: string | null;
  court_name: string | null;
  jurisdiction: string | null;
  client_name: string | null;
  attorney_name: string | null;
  priority: ServePriority;
  deadline: string | null;
  service_instructions: string | null;
  notes: string | null;
}

export function fieldsToQueueRow(fields: Record<string, ExtractedField>): QueueRow {
  const get = (k: TargetField) => (fields[k]?.value || '').trim() || null;
  const isBusiness = (get('recipient_type') || '').toLowerCase() === 'business';
  const businessName = get('recipient_business_name');
  const personName = [get('recipient_first_name'), get('recipient_middle_name'), get('recipient_last_name')]
    .filter(Boolean).join(' ').trim() || null;
  // For corporate recipients the queue's "recipient_name" is the company
  // (so the queue list reads naturally — "STEEL ENCOUNTERS, INC." not
  // "Joan Lind"). The actual person we serve (the registered agent) lives
  // on the linked persons row via recipient_person_id.
  const recipient_name = isBusiness
    ? (businessName || personName)
    : (personName || businessName);

  return {
    recipient_name,
    recipient_address: get('recipient_address'),
    recipient_city: get('recipient_city'),
    recipient_state: get('recipient_state'),
    recipient_zip: get('recipient_zip'),
    document_type: get('document_type') || get('document_subtype'),
    case_number: get('case_number'),
    court_name: get('court_name'),
    jurisdiction: get('jurisdiction'),
    client_name: get('client_name'),
    attorney_name: get('attorney_name'),
    priority: normalizePriority(get('priority') || ''),
    deadline: get('service_deadline'),
    service_instructions: get('service_instructions'),
    notes: get('service_windows'),
  };
}
