// ============================================================
// RMPG Flex — Inspection template helpers (Fleet.io PR 6)
// ============================================================
// Pure functions extracted from the inspection route + template CRUD so
// they're trivially unit testable. The routes compose these with D1 +
// the emit helper.
//
// Concerns owned here:
//   * Template schema validation — what counts as a well-formed
//     inspection_templates.schema_json blob.
//   * Item-answer validation — given a template + a submitted answer set,
//     decide which items were answered, which failed, which are missing.
//   * Auto-escalation discovery — among the failed items, which carry
//     fail_creates_issue=true (must trigger a fleet_maintenance row +
//     fleetio_events emit).
//   * Photo enforcement — given a failed item + the submitted answer,
//     check whether photo_required_on_fail was satisfied.
// ============================================================

export type InspectionItemType = 'yes_no' | 'pass_fail' | 'text' | 'photo' | 'number';

export interface InspectionItem {
  key: string;
  label: string;
  type: InspectionItemType;
  required?: boolean;
  fail_creates_issue?: boolean;
  photo_required_on_fail?: boolean;
  /** Optional per-item help text, surfaced under the label in the mobile UI. */
  help?: string;
}

export interface InspectionTemplateSchema {
  items: InspectionItem[];
}

export interface InspectionItemAnswer {
  answer?: unknown;          // 'yes' | 'no' | 'pass' | 'fail' | string | number — depends on type
  photo_key?: string | null; // R2 key when the operator attached one
  notes?: string | null;
}

export type InspectionAnswers = Record<string, InspectionItemAnswer>;

// ─── Pure validators ──────────────────────────────────────

const ITEM_TYPES: ReadonlySet<string> = new Set<InspectionItemType>(['yes_no', 'pass_fail', 'text', 'photo', 'number']);

/** Parse + validate a `schema_json` payload from the DB or admin form. */
export function parseTemplateSchema(raw: unknown): InspectionTemplateSchema {
  const parsed = typeof raw === 'string' ? safeJsonParse(raw) : raw;
  if (!parsed || typeof parsed !== 'object') {
    throw new InvalidTemplateError('schema_json must be a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.items) || obj.items.length === 0) {
    throw new InvalidTemplateError('schema_json.items must be a non-empty array');
  }
  const items: InspectionItem[] = [];
  const seenKeys = new Set<string>();
  for (let i = 0; i < obj.items.length; i++) {
    const raw = obj.items[i] as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') {
      throw new InvalidTemplateError(`schema_json.items[${i}] must be an object`);
    }
    const key = raw.key;
    if (typeof key !== 'string' || key.length === 0 || key.length > 64) {
      throw new InvalidTemplateError(`schema_json.items[${i}].key must be a non-empty string (≤64 chars)`);
    }
    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      throw new InvalidTemplateError(`schema_json.items[${i}].key '${key}' must match /^[a-z][a-z0-9_]*$/`);
    }
    if (seenKeys.has(key)) {
      throw new InvalidTemplateError(`Duplicate item key '${key}'`);
    }
    seenKeys.add(key);
    const label = raw.label;
    if (typeof label !== 'string' || label.length === 0) {
      throw new InvalidTemplateError(`schema_json.items[${i}].label is required`);
    }
    const type = raw.type;
    if (typeof type !== 'string' || !ITEM_TYPES.has(type)) {
      throw new InvalidTemplateError(`schema_json.items[${i}].type must be one of: ${Array.from(ITEM_TYPES).join(', ')}`);
    }
    items.push({
      key, label, type: type as InspectionItemType,
      required: raw.required === true,
      fail_creates_issue: raw.fail_creates_issue === true,
      photo_required_on_fail: raw.photo_required_on_fail === true,
      help: typeof raw.help === 'string' ? raw.help : undefined,
    });
  }
  return { items };
}

export class InvalidTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTemplateError';
  }
}

// ─── Answer-set validation ────────────────────────────────

export interface ValidationProblem {
  key: string;
  reason: 'missing_required' | 'wrong_type' | 'photo_required_on_fail';
  detail?: string;
}

export interface ValidationResult {
  problems: ValidationProblem[];
  answered: string[];   // keys present in the answer set
  failed: string[];     // keys whose answer counts as a fail
  ok: boolean;          // shortcut: problems.length === 0
}

/** Decide whether a given answer counts as a "fail" for the item's type. */
export function answerIsFail(item: InspectionItem, answer: unknown): boolean {
  switch (item.type) {
    case 'yes_no':    return answer === 'no' || answer === false || answer === 'No';
    case 'pass_fail': return answer === 'fail' || answer === 'Fail';
    case 'text':      return false; // text answers can't fail by themselves
    case 'photo':     return false; // missing photos surface as missing_required instead
    case 'number':    return false; // number ranges aren't part of the v1 schema
    default:          return false;
  }
}

/** Decide whether a submitted answer matches the item's declared type. */
export function answerMatchesType(item: InspectionItem, answer: unknown): boolean {
  if (answer === undefined || answer === null || answer === '') return false;
  switch (item.type) {
    case 'yes_no':    return answer === 'yes' || answer === 'no' || answer === true || answer === false || answer === 'Yes' || answer === 'No';
    case 'pass_fail': return answer === 'pass' || answer === 'fail' || answer === 'Pass' || answer === 'Fail';
    case 'text':      return typeof answer === 'string';
    case 'photo':     return typeof answer === 'string' && answer.length > 0; // R2 key
    case 'number':    return typeof answer === 'number' && Number.isFinite(answer);
    default:          return false;
  }
}

/** Validate an answer set against a template; surface problems for the route layer. */
export function validateAnswers(
  template: InspectionTemplateSchema,
  answers: InspectionAnswers,
): ValidationResult {
  const problems: ValidationProblem[] = [];
  const answered: string[] = [];
  const failed: string[] = [];
  for (const item of template.items) {
    const ans = answers[item.key];
    const has = ans !== undefined && ans !== null;
    if (!has) {
      if (item.required) {
        problems.push({ key: item.key, reason: 'missing_required' });
      }
      continue;
    }
    answered.push(item.key);
    if (ans.answer !== undefined && ans.answer !== null && !answerMatchesType(item, ans.answer)) {
      problems.push({
        key: item.key, reason: 'wrong_type',
        detail: `expected ${item.type}, got ${JSON.stringify(ans.answer)}`,
      });
    }
    if (answerIsFail(item, ans.answer)) {
      failed.push(item.key);
      if (item.photo_required_on_fail && (typeof ans.photo_key !== 'string' || ans.photo_key.length === 0)) {
        problems.push({ key: item.key, reason: 'photo_required_on_fail' });
      }
    }
  }
  return { problems, answered, failed, ok: problems.length === 0 };
}

// ─── Auto-escalation ──────────────────────────────────────

export interface EscalationItem {
  key: string;
  label: string;
  photo_key: string | null;
  notes: string | null;
}

/** Among the failed items, which should auto-create a fleet_maintenance row? */
export function getEscalations(
  template: InspectionTemplateSchema,
  answers: InspectionAnswers,
  failedKeys: string[],
): EscalationItem[] {
  const out: EscalationItem[] = [];
  const failedSet = new Set(failedKeys);
  for (const item of template.items) {
    if (!failedSet.has(item.key)) continue;
    if (!item.fail_creates_issue) continue;
    const ans = answers[item.key];
    out.push({
      key: item.key,
      label: item.label,
      photo_key: (ans && typeof ans.photo_key === 'string') ? ans.photo_key : null,
      notes: (ans && typeof ans.notes === 'string') ? ans.notes : null,
    });
  }
  return out;
}

// ─── Helpers ──────────────────────────────────────────────

function safeJsonParse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}
