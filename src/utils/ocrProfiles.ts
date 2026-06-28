// ocrProfiles — document-type profiles for the dynamic Claude-vision OCR engine.
// Each profile is a field schema + extraction prompt. The engine (extractVision
// in serveIntakeExtract) runs ONE Claude vision call per upload; with profile
// 'auto' Claude classifies the document AND extracts in the same call, so a mixed
// Serve-Intake upload (a plate photo, a driver license, a summons) is handled
// without the user pre-tagging each file.
//
// Output is coerced into the same ExtractionResult shape the serve-intake path
// already returns, so downstream commit/render code is unchanged.

import { TARGET_FIELDS, type ExtractionResult } from './serveIntakeExtract';

export interface OcrField { key: string; desc: string }

// ── ID cards / driver licenses (front photo — no barcode needed) ──────────
export const ID_CARD_FIELDS: OcrField[] = [
  { key: 'id_type', desc: "driver_license | state_id | passport | military_id | other" },
  { key: 'id_number', desc: 'license/ID number (AAMVA field 4d DLN)' },
  { key: 'first_name', desc: 'given name' },
  { key: 'middle_name', desc: 'middle name(s) if shown' },
  { key: 'last_name', desc: 'family name' },
  { key: 'dob', desc: 'date of birth, normalize to YYYY-MM-DD' },
  { key: 'address', desc: 'street address line' },
  { key: 'city', desc: '' },
  { key: 'state', desc: '2-letter state of residence' },
  { key: 'zip', desc: '' },
  { key: 'issuing_state', desc: 'the state/authority that issued the card (e.g. UTAH)' },
  { key: 'issue_date', desc: 'normalize to YYYY-MM-DD' },
  { key: 'expiry_date', desc: 'normalize to YYYY-MM-DD' },
  { key: 'class', desc: 'license class (e.g. D)' },
  { key: 'endorsements', desc: '' },
  { key: 'restrictions', desc: '' },
  { key: 'sex', desc: 'M | F | X' },
  { key: 'height', desc: 'e.g. 5-08 or 5\'8"' },
  { key: 'weight', desc: 'pounds' },
  { key: 'eyes', desc: 'eye color (e.g. BRO)' },
  { key: 'hair', desc: 'hair color (e.g. BLK)' },
  { key: 'donor', desc: 'organ donor Y/N' },
  { key: 'dd', desc: 'document discriminator (AAMVA field 5 DD)' },
];

// ── License plates / vehicles (ALPR from a photo) ─────────────────────────
export const PLATE_FIELDS: OcrField[] = [
  { key: 'plate_number', desc: 'the plate characters, uppercase, no spaces' },
  { key: 'plate_state', desc: '2-letter issuing state (read the plate banner)' },
  { key: 'plate_type', desc: 'passenger | commercial | temporary | dealer | government | disabled | other' },
  { key: 'registration_expiry', desc: 'month/year from the validation sticker if visible' },
  { key: 'vehicle_make', desc: 'manufacturer brand name ONLY — uppercase, no trim/sub-brand (e.g. TOYOTA, FORD, CHEVROLET, HONDA, NISSAN, BMW, MERCEDES-BENZ, KIA, HYUNDAI, SUBARU); identify from hood badge or body badge; empty if not visible' },
  { key: 'vehicle_model', desc: 'model name only, no trim/year (e.g. CAMRY, F-150, SILVERADO, CIVIC, ALTIMA, 3-SERIES, C-CLASS); uppercase; empty if not visible' },
  { key: 'vehicle_color', desc: 'dominant exterior color as a single standard English word, uppercase: WHITE, BLACK, SILVER, GRAY, RED, BLUE, DARK BLUE, GREEN, DARK GREEN, BROWN, TAN, BEIGE, GOLD, YELLOW, ORANGE, MAROON, PURPLE; if two-tone write the body color; empty if not discernible' },
  { key: 'vehicle_year', desc: 'single 4-digit model year (e.g. 2019); if the exact year is uncertain, estimate the midpoint of the visible generation (e.g. a 2018-2022 generation → 2020); empty if truly indeterminate' },
  { key: 'vehicle_body', desc: 'sedan | suv | pickup | van | motorcycle | truck | other' },
  { key: 'vehicle_condition', desc: 'overall body condition: clean | minor | moderate | heavy | salvage (clean = no visible damage)' },
  { key: 'vehicle_damage', desc: 'brief note of any VISIBLE damage and where (e.g. "dented rear bumper", "cracked windshield"); empty if none visible' },
];

export type OcrProfileId = 'id_card' | 'license_plate' | 'serve_document';
export type OcrProfileSelector = OcrProfileId | 'auto';

export interface OcrProfile {
  id: OcrProfileId;
  label: string;
  hint: string;          // one-line description used in the prompt
  fields: OcrField[];
}

// serve_document reuses the established serve-intake field set.
const SERVE_FIELDS: OcrField[] = TARGET_FIELDS.map((key) => ({ key, desc: '' }));

export const OCR_PROFILES: Record<OcrProfileId, OcrProfile> = {
  id_card: {
    id: 'id_card', label: 'ID Card / Driver License',
    hint: 'a government photo ID — driver license, state ID, passport, or military ID',
    fields: ID_CARD_FIELDS,
  },
  license_plate: {
    id: 'license_plate', label: 'License Plate / Vehicle',
    hint: 'a photo of a vehicle license plate — read the plate text precisely AND identify the vehicle (make, model, color, year) from any visible badges, body panels, or design cues',
    fields: PLATE_FIELDS,
  },
  serve_document: {
    id: 'serve_document', label: 'Serve Document',
    hint: 'a legal process-service document — summons, complaint, subpoena, field sheet, court docket, or information form',
    fields: SERVE_FIELDS,
  },
};

/** Field keys for a selector. 'auto' unions every profile's keys so any field
 *  Claude returns survives normalization regardless of detected type. */
export function profileFieldKeys(sel: OcrProfileSelector): string[] {
  if (sel === 'auto') {
    const set = new Set<string>();
    for (const p of Object.values(OCR_PROFILES)) for (const f of p.fields) set.add(f.key);
    return [...set];
  }
  return OCR_PROFILES[sel].fields.map((f) => f.key);
}

const SYSTEM = `You are a precise OCR extraction engine for a police / legal process-service records system. Read the image and transcribe exactly what is printed — never invent, guess, or fill values that are not legible. For any field you cannot read, return an empty string. Dates normalize to YYYY-MM-DD. Output ONLY a single JSON object, no prose, no markdown fences.`;

export function visionSystemPrompt(): string { return SYSTEM; }

function fieldLines(fields: OcrField[]): string {
  return fields.map((f) => (f.desc ? `  "${f.key}": ""   // ${f.desc}` : `  "${f.key}": ""`)).join('\n');
}

/** Build the user prompt for a selector (pure — unit-tested). */
export function buildVisionUserPrompt(sel: OcrProfileSelector): string {
  if (sel === 'auto') {
    const menu = (Object.keys(OCR_PROFILES) as OcrProfileId[])
      .map((id) => `- "${id}": ${OCR_PROFILES[id].hint}`).join('\n');
    return [
      'Identify the document type, then extract its fields.',
      'documentType MUST be one of: id_card, license_plate, serve_document, other —',
      menu,
      '',
      'Return JSON: { "documentType": "<type>", "confidence": 0-1, "rawText": "<all visible text>", "fields": { "<field>": { "value": "<text|empty>", "confidence": 0-1 } } }',
      'Use the field names appropriate to the detected type:',
      `  id_card → ${ID_CARD_FIELDS.map((f) => f.key).join(', ')}`,
      `  license_plate → ${PLATE_FIELDS.map((f) => f.key).join(', ')}`,
      `  serve_document → ${SERVE_FIELDS.map((f) => f.key).join(', ')}`,
    ].join('\n');
  }
  const p = OCR_PROFILES[sel];
  const extra =
    sel === 'license_plate'
      ? '\nVehicle identification: use every visual cue — hood/trunk/pillar badges for make, body-line/tail-light shape for model generation, body-panel color for color, headlight/grille design for year generation (estimate midpoint). Do NOT leave make/model/color/year empty if the vehicle is visible in the frame — apply your automotive knowledge to identify it.'
      : '';
  return [
    `This is ${p.hint}. Extract these fields:`,
    '{',
    fieldLines(p.fields),
    '}',
    extra,
    `Return JSON: { "documentType": "${sel}", "confidence": 0-1, "rawText": "<all visible text>", "fields": { "<field>": { "value": "<text|empty>", "confidence": 0-1 } } } using exactly the field names above.`,
  ].join('\n');
}

const DEFAULT_CONF = 0.8;
function clamp01(n: number): number { return n < 0 ? 0 : n > 1 ? 1 : n; }

function coerceField(raw: any): { value: string; confidence: number } {
  if (raw == null) return { value: '', confidence: 0 };
  if (typeof raw === 'string' || typeof raw === 'number') {
    const value = String(raw).trim();
    return { value, confidence: value ? DEFAULT_CONF : 0 };
  }
  const value = String(raw.value ?? '').trim();
  const conf = typeof raw.confidence === 'number' ? clamp01(raw.confidence) : (value ? DEFAULT_CONF : 0);
  return { value, confidence: value ? conf : 0 };
}

const DATE_RE = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/g;

/**
 * Coerce a Claude vision response into the shared ExtractionResult shape.
 * Pure — no I/O. Fills every expected field (empty when omitted), clamps
 * confidence, picks the documentType, and harvests date-looking values.
 */
export function normalizeVision(
  parsed: any, sel: OcrProfileSelector, model: string, ms: number,
): ExtractionResult {
  const inFields = (parsed && typeof parsed === 'object' && parsed.fields && typeof parsed.fields === 'object')
    ? parsed.fields : {};
  // For 'auto', honor Claude's detected type and use that type's field set
  // (falling back to the union so an unexpected key still lands).
  const detected: string = (parsed && typeof parsed.documentType === 'string' && parsed.documentType)
    || (sel === 'auto' ? 'other' : sel);
  const keySource: OcrProfileSelector =
    detected === 'id_card' || detected === 'license_plate' || detected === 'serve_document'
      ? detected : sel;
  const keys = profileFieldKeys(keySource);

  const fields: Record<string, { value: string; confidence: number }> = {};
  for (const k of keys) fields[k] = coerceField(inFields[k]);
  // Keep any extra keys Claude returned that aren't in the schema.
  for (const k of Object.keys(inFields)) if (!(k in fields)) fields[k] = coerceField(inFields[k]);

  const values = Object.values(fields).map((f) => f.value).filter(Boolean);
  const success = values.length > 0;
  const rawText = (typeof parsed?.rawText === 'string' && parsed.rawText.trim())
    || values.join(' | ');
  const confidence = typeof parsed?.confidence === 'number'
    ? clamp01(parsed.confidence)
    : (success ? DEFAULT_CONF : 0);

  const allDates = Array.from(new Set(
    [rawText, ...values].join(' ').match(DATE_RE) ?? [],
  ));

  return { success, documentType: detected, confidence, fields, rawText, allDates, model, ms };
}
