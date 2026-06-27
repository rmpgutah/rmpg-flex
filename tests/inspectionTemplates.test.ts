import { describe, it, expect } from 'vitest';
import {
  parseTemplateSchema,
  InvalidTemplateError,
  answerIsFail,
  answerMatchesType,
  validateAnswers,
  getEscalations,
  type InspectionTemplateSchema,
  type InspectionAnswers,
} from '../src/utils/inspectionTemplates';
import { INSPECTION_OWNERSHIP, getOwnership } from '../src/utils/fleetio/ownership';

// ─── parseTemplateSchema ────────────────────────────────────

describe('parseTemplateSchema', () => {
  const minimal = {
    items: [
      { key: 'tires', label: 'Tires', type: 'yes_no', required: true, fail_creates_issue: true },
      { key: 'headlights', label: 'Headlights', type: 'pass_fail' },
    ],
  };

  it('parses a valid schema object', () => {
    const out = parseTemplateSchema(minimal);
    expect(out.items).toHaveLength(2);
    expect(out.items[0].key).toBe('tires');
    expect(out.items[0].required).toBe(true);
    expect(out.items[0].fail_creates_issue).toBe(true);
    expect(out.items[1].required).toBe(false);
  });

  it('accepts a JSON-string payload', () => {
    const out = parseTemplateSchema(JSON.stringify(minimal));
    expect(out.items).toHaveLength(2);
  });

  it('returns InvalidTemplateError on non-object input', () => {
    expect(() => parseTemplateSchema(42 as unknown)).toThrow(InvalidTemplateError);
    expect(() => parseTemplateSchema(null as unknown)).toThrow(InvalidTemplateError);
    expect(() => parseTemplateSchema('not json{')).toThrow(InvalidTemplateError);
  });

  it('requires a non-empty items array', () => {
    expect(() => parseTemplateSchema({})).toThrow(InvalidTemplateError);
    expect(() => parseTemplateSchema({ items: [] })).toThrow(InvalidTemplateError);
    expect(() => parseTemplateSchema({ items: 'string' })).toThrow(InvalidTemplateError);
  });

  it('enforces snake_case keys + uniqueness', () => {
    expect(() => parseTemplateSchema({ items: [{ key: 'BAD', label: 'x', type: 'yes_no' }] })).toThrow(/must match/);
    expect(() => parseTemplateSchema({ items: [{ key: '1bad', label: 'x', type: 'yes_no' }] })).toThrow();
    expect(() => parseTemplateSchema({
      items: [
        { key: 'dupe', label: 'A', type: 'yes_no' },
        { key: 'dupe', label: 'B', type: 'yes_no' },
      ],
    })).toThrow(/Duplicate item key/);
  });

  it('rejects unknown types', () => {
    expect(() => parseTemplateSchema({ items: [{ key: 'tires', label: 'Tires', type: 'mystery' }] })).toThrow(/type must be one of/);
  });

  it('requires non-empty label', () => {
    expect(() => parseTemplateSchema({ items: [{ key: 'tires', label: '', type: 'yes_no' }] })).toThrow(/label is required/);
  });
});

// ─── answerMatchesType / answerIsFail ───────────────────────

describe('answerMatchesType', () => {
  const yes_no = { key: 'k', label: 'L', type: 'yes_no' as const };
  const pass_fail = { key: 'k', label: 'L', type: 'pass_fail' as const };
  const text = { key: 'k', label: 'L', type: 'text' as const };
  const photo = { key: 'k', label: 'L', type: 'photo' as const };
  const number = { key: 'k', label: 'L', type: 'number' as const };

  it('routes yes_no to yes/no/Yes/No/booleans', () => {
    expect(answerMatchesType(yes_no, 'yes')).toBe(true);
    expect(answerMatchesType(yes_no, 'no')).toBe(true);
    expect(answerMatchesType(yes_no, true)).toBe(true);
    expect(answerMatchesType(yes_no, 'maybe')).toBe(false);
  });

  it('routes pass_fail to pass/fail (case-tolerant)', () => {
    expect(answerMatchesType(pass_fail, 'pass')).toBe(true);
    expect(answerMatchesType(pass_fail, 'Fail')).toBe(true);
    expect(answerMatchesType(pass_fail, 'fine')).toBe(false);
  });

  it('text rejects empty + non-string', () => {
    expect(answerMatchesType(text, '')).toBe(false);
    expect(answerMatchesType(text, 'hello')).toBe(true);
    expect(answerMatchesType(text, 42 as unknown)).toBe(false);
  });

  it('photo requires a non-empty string (R2 key)', () => {
    expect(answerMatchesType(photo, '')).toBe(false);
    expect(answerMatchesType(photo, 'r2/inspections/abc.jpg')).toBe(true);
  });

  it('number requires finite numerics', () => {
    expect(answerMatchesType(number, 5)).toBe(true);
    expect(answerMatchesType(number, Number.NaN)).toBe(false);
    expect(answerMatchesType(number, '5' as unknown)).toBe(false);
  });
});

describe('answerIsFail', () => {
  it('treats no / fail (case-tolerant) and false as a fail on yes_no / pass_fail', () => {
    expect(answerIsFail({ key: 'k', label: 'L', type: 'yes_no' }, 'no')).toBe(true);
    expect(answerIsFail({ key: 'k', label: 'L', type: 'yes_no' }, false)).toBe(true);
    expect(answerIsFail({ key: 'k', label: 'L', type: 'pass_fail' }, 'Fail')).toBe(true);
  });

  it('returns false for affirmative answers + non-binary types', () => {
    expect(answerIsFail({ key: 'k', label: 'L', type: 'yes_no' }, 'yes')).toBe(false);
    expect(answerIsFail({ key: 'k', label: 'L', type: 'pass_fail' }, 'pass')).toBe(false);
    expect(answerIsFail({ key: 'k', label: 'L', type: 'text' }, 'anything')).toBe(false);
    expect(answerIsFail({ key: 'k', label: 'L', type: 'number' }, 0)).toBe(false);
  });
});

// ─── validateAnswers ────────────────────────────────────────

const TPL: InspectionTemplateSchema = {
  items: [
    { key: 'tires', label: 'Tires', type: 'yes_no', required: true, fail_creates_issue: true, photo_required_on_fail: true },
    { key: 'headlights', label: 'Headlights', type: 'pass_fail', required: true, fail_creates_issue: true },
    { key: 'odometer_in', label: 'Starting Odo', type: 'number', required: false, fail_creates_issue: false },
    { key: 'remarks', label: 'Remarks', type: 'text', required: false, fail_creates_issue: false },
  ],
};

describe('validateAnswers', () => {
  it('returns ok=true when every required item has a valid answer', () => {
    const answers: InspectionAnswers = {
      tires: { answer: 'yes' },
      headlights: { answer: 'pass' },
    };
    const out = validateAnswers(TPL, answers);
    expect(out.ok).toBe(true);
    expect(out.problems).toEqual([]);
    expect(out.failed).toEqual([]);
    expect(out.answered.sort()).toEqual(['headlights', 'tires']);
  });

  it('flags missing required items', () => {
    const out = validateAnswers(TPL, { tires: { answer: 'yes' } });
    expect(out.ok).toBe(false);
    expect(out.problems).toEqual([{ key: 'headlights', reason: 'missing_required' }]);
  });

  it('flags wrong types', () => {
    const out = validateAnswers(TPL, {
      tires: { answer: 'maybe' },
      headlights: { answer: 'pass' },
    });
    expect(out.problems.find(p => p.key === 'tires' && p.reason === 'wrong_type')).toBeDefined();
  });

  it('flags failed items missing a required photo', () => {
    const out = validateAnswers(TPL, {
      tires: { answer: 'no' /* no photo_key */ },
      headlights: { answer: 'pass' },
    });
    expect(out.failed).toContain('tires');
    expect(out.problems.find(p => p.key === 'tires' && p.reason === 'photo_required_on_fail')).toBeDefined();
  });

  it('passes when failed item has photo and ALL required answers present', () => {
    const out = validateAnswers(TPL, {
      tires: { answer: 'no', photo_key: 'r2/inspections/abc.jpg' },
      headlights: { answer: 'pass' },
    });
    expect(out.ok).toBe(true);
    expect(out.failed).toContain('tires');
  });

  it('ignores optional missing items', () => {
    const out = validateAnswers(TPL, {
      tires: { answer: 'yes' },
      headlights: { answer: 'pass' },
    });
    expect(out.ok).toBe(true);
    expect(out.answered).not.toContain('odometer_in');
    expect(out.answered).not.toContain('remarks');
  });
});

// ─── getEscalations ────────────────────────────────────────

describe('getEscalations', () => {
  it('returns only items that BOTH failed AND have fail_creates_issue=true', () => {
    const answers: InspectionAnswers = {
      tires: { answer: 'no', photo_key: 'r2/tires.jpg', notes: 'low tread on rear-driver' },
      headlights: { answer: 'fail' },
    };
    const { failed } = validateAnswers(TPL, answers);
    const out = getEscalations(TPL, answers, failed);
    expect(out).toHaveLength(2);
    expect(out.find(e => e.key === 'tires')?.photo_key).toBe('r2/tires.jpg');
    expect(out.find(e => e.key === 'tires')?.notes).toBe('low tread on rear-driver');
  });

  it('drops failed items that DON\'T have fail_creates_issue', () => {
    const tpl: InspectionTemplateSchema = {
      items: [
        { key: 'a', label: 'A', type: 'pass_fail', fail_creates_issue: true },
        { key: 'b', label: 'B', type: 'pass_fail', fail_creates_issue: false },
      ],
    };
    const out = getEscalations(tpl, { a: { answer: 'fail' }, b: { answer: 'fail' } }, ['a', 'b']);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('a');
  });

  it('returns empty when no failures', () => {
    const out = getEscalations(TPL, { tires: { answer: 'yes' }, headlights: { answer: 'pass' } }, []);
    expect(out).toEqual([]);
  });
});

// ─── INSPECTION_OWNERSHIP integration ─────────────────────

describe('INSPECTION_OWNERSHIP', () => {
  it('routes through getOwnership for the inspection resource', () => {
    expect(getOwnership('inspection', 'template_id')).toBe('rmpg');
    expect(getOwnership('inspection', 'items_json')).toBe('rmpg');
    expect(getOwnership('inspection', 'escalated_issue_id')).toBe('rmpg');
    expect(getOwnership('inspection', 'phase')).toBe('rmpg');
  });

  it('returns null for unknown fields', () => {
    expect(getOwnership('inspection', 'something_else')).toBeNull();
  });

  it('every value in INSPECTION_OWNERSHIP is a valid class', () => {
    for (const v of Object.values(INSPECTION_OWNERSHIP)) {
      expect(['rmpg', 'fleetio', 'shared']).toContain(v);
    }
  });
});
