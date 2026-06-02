// ============================================================
// Serve Intake extraction — deterministic-layer tests
// ============================================================
// The LLM extraction itself runs on Workers AI (not unit-testable
// offline), but everything AROUND it — date/phone/state/zip
// normalization, DOB recovery, placeholder scrubbing, and the
// fields→serve_queue mapping — is pure and is what protects typed/
// CHECK-constrained columns from bad OCR. These tests pin that
// behavior using SYNTHETIC fixtures that mirror the real ServeManager
// Information-Form and court-form (SUM-100) layouts. No real case data.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  toIsoDate, normalizeBirthDate, recoverDob, normalizeState, normalizePhone,
  normalizeZip, normalizePriority, normalizeDeadline, normalizeFields,
  fieldsToQueueRow, TARGET_FIELDS,
  type ExtractedField, type TargetField,
} from '../src/utils/serveIntakeExtract';

// Build a full field map from a sparse {field: value} input (conf 1).
function fieldsFrom(values: Record<string, string>): Record<string, ExtractedField> {
  const out: Record<string, ExtractedField> = {};
  for (const f of TARGET_FIELDS) out[f] = { value: values[f] ?? '', confidence: values[f] ? 1 : 0 };
  return out;
}

describe('toIsoDate', () => {
  it('parses ISO and US forms to ISO', () => {
    expect(toIsoDate('2026-05-11')).toBe('2026-05-11');
    expect(toIsoDate('5/11/2026')).toBe('2026-05-11');
    expect(toIsoDate('05/11/26')).toBe('2026-05-11');   // due-date: 2-digit → 20xx
    expect(toIsoDate('3-4-1985')).toBe('1985-03-04');
  });
  it('rejects non-dates and impossible months/days', () => {
    expect(toIsoDate('21 days')).toBeNull();
    expect(toIsoDate('upon service')).toBeNull();
    expect(toIsoDate('13/45/2026')).toBeNull();
    expect(toIsoDate('')).toBeNull();
  });
});

describe('normalizeBirthDate', () => {
  it('keeps 4-digit birth years (the real-packet form)', () => {
    expect(normalizeBirthDate('11/16/2000')).toBe('2000-11-16');
    expect(normalizeBirthDate('1992-05-17')).toBe('1992-05-17');
  });
  it('rolls a 2-digit future year back a century (births are never future)', () => {
    // refYear pinned for determinism: "3/4/85" → 2085 (toIsoDate) → 1985.
    expect(normalizeBirthDate('3/4/85', 2026)).toBe('1985-03-04');
    expect(normalizeBirthDate('12/8/02', 2026)).toBe('2002-12-08'); // 2002 ≤ 2026 → unchanged
  });
  it('returns null for non-dates', () => {
    expect(normalizeBirthDate('see ID')).toBeNull();
  });
});

describe('recoverDob (ServeManager DOB-in-description)', () => {
  it('finds a labeled DOB', () => {
    expect(recoverDob('Recipient: John Q Sample\nDOB: 11/16/2000\n742 W ...')).toBe('2000-11-16');
    expect(recoverDob('Date of Birth 03/04/1985')).toBe('1985-03-04');
  });
  it('finds a DOB that sits alone inside a description field', () => {
    expect(recoverDob('"recipient_description": "11/16/2000",')).toBe('2000-11-16');
  });
  it('returns null when no birthdate present', () => {
    expect(recoverDob('Recipient: Jane Doe, no birthdate on file')).toBeNull();
  });
});

describe('normalizeState', () => {
  it('maps names and codes to 2-letter', () => {
    expect(normalizeState('Utah')).toBe('UT');
    expect(normalizeState('ut')).toBe('UT');
    expect(normalizeState('California')).toBe('CA');
    expect(normalizeState('U.T.')).toBe('UT');
  });
});

describe('normalizePhone', () => {
  it('strips to 10 digits and drops the US country code', () => {
    expect(normalizePhone('(435) 986-1200')).toBe('4359861200');
    expect(normalizePhone('1-435-986-1200')).toBe('4359861200');
  });
});

describe('normalizeZip', () => {
  it('extracts 5 or 5+4 from noisy input', () => {
    expect(normalizeZip('UT 84117')).toBe('84117');
    expect(normalizeZip('84123-4101')).toBe('84123-4101');
    expect(normalizeZip('no zip here')).toBe('');
  });
});

describe('normalizePriority', () => {
  it('maps to the serve_queue CHECK enum', () => {
    expect(normalizePriority('rush')).toBe('rush');
    expect(normalizePriority('HOT RUSH')).toBe('urgent');
    expect(normalizePriority('whatever')).toBe('normal');
  });
});

describe('normalizeDeadline', () => {
  it('accepts a real calendar date, rejects a relative answer window', () => {
    expect(normalizeDeadline('2026-05-11')).toBe('2026-05-11');
    expect(normalizeDeadline('5/11/2026')).toBe('2026-05-11');
    expect(normalizeDeadline('30 calendar days')).toBeNull(); // SUM-100 answer window
    expect(normalizeDeadline('21 days')).toBeNull();           // UT summons window
  });
});

describe('normalizeFields', () => {
  it('scrubs pre-filing placeholders to empty (case_number "[not provided]")', () => {
    const out = normalizeFields(fieldsFrom({ case_number: '[not provided]', plaintiff: 'Capital One, N.A.' }));
    expect(out.case_number.value).toBe('');
    expect(out.case_number.confidence).toBe(0);
    // Does NOT clip a real value that merely contains a token.
    expect(out.plaintiff.value).toBe('Capital One, N.A.');
  });
  it('birth-aware DOB + ISO for other dates', () => {
    const out = normalizeFields(fieldsFrom({ recipient_dob: '3/4/85', filing_date: '5/11/26' }));
    // recipient_dob uses normalizeBirthDate (runtime year ≥ 2025 → 1985).
    expect(out.recipient_dob.value).toBe('1985-03-04');
    expect(out.filing_date.value).toBe('2026-05-11');
  });
  it('drops an unparseable date instead of guessing', () => {
    const out = normalizeFields(fieldsFrom({ service_deadline: 'within 30 days' }));
    expect(out.service_deadline.value).toBe('');
    expect(out.service_deadline.confidence).toBe(0);
  });
});

describe('fieldsToQueueRow', () => {
  it('joins a person name (first/middle/last) and maps the deadline', () => {
    const row = fieldsToQueueRow(fieldsFrom({
      recipient_type: 'person',
      recipient_first_name: 'John', recipient_middle_name: 'Q', recipient_last_name: 'Sample',
      recipient_address: '742 W Sample Loop APT 3', recipient_city: 'Midvale',
      recipient_state: 'UT', recipient_zip: '84047',
      service_deadline: '2026-05-11', document_type: 'summons',
      service_instructions: 'Sub-serve on 1st attempt to any occupant 16+.',
    }));
    expect(row.recipient_name).toBe('John Q Sample');
    expect(row.recipient_city).toBe('Midvale');
    expect(row.deadline).toBe('2026-05-11');
    expect(row.document_type).toBe('summons');
    expect(row.priority).toBe('normal');
  });
  it('uses the company name for a business recipient', () => {
    const row = fieldsToQueueRow(fieldsFrom({
      recipient_type: 'business',
      recipient_business_name: 'Steel Encounters, Inc.',
      registered_agent_name: 'Jane Agent',
    }));
    expect(row.recipient_name).toBe('Steel Encounters, Inc.');
  });
  it('does not store a relative deadline phrase', () => {
    const row = fieldsToQueueRow(fieldsFrom({ service_deadline: '30 calendar days' }));
    expect(row.deadline).toBeNull();
  });
});
