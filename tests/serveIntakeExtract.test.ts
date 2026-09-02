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
  fieldsToQueueRow, TARGET_FIELDS, normalizeAddressClass, normalizeYesNo,
  encodePsoServiceWindows, mapIntakeServeType, mapRecipientType, parseFeeAmount,
  mapTimeWindow,
  buildFamilyPrompt, needsCriticPass, familyFromFileName, buildExtractionMessages,
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
    expect(row.recipient_type).toBe('business');
    expect(row.business_name).toBe('Steel Encounters, Inc.');
    expect(row.registered_agent_name).toBe('Jane Agent');
    expect(row.serve_type).toBe('corporate');
  });
  it('does not store a relative deadline phrase', () => {
    const row = fieldsToQueueRow(fieldsFrom({ service_deadline: '30 calendar days' }));
    expect(row.deadline).toBeNull();
  });
  it('copies contact, fee, attorney, and process type onto queue columns', () => {
    const row = fieldsToQueueRow(fieldsFrom({
      recipient_type: 'business',
      recipient_business_name: 'Dirty Dough, LLC',
      registered_agent_name: 'Bennett Maxwell',
      recipient_phone: '(801) 805-6700',
      recipient_dob: '1980-03-04',
      registered_agent_address: '289 North 1580 West',
      plaintiff: 'Environmental Health Advocates, Inc.',
      attorney_name: 'Noam Glick',
      attorney_phone: '6196290527',
      attorney_email: 'noam@entornolaw.com',
      attorney_bar_number: '251582',
      fee_amount: '54.23',
      process_type: 'personal',
      service_windows: 'Anytime',
      job_number: '16717993',
    }));
    expect(row.recipient_phone).toBe('(801) 805-6700');
    expect(row.recipient_dob).toBe('1980-03-04');
    expect(row.registered_office_address).toBe('289 North 1580 West');
    expect(row.attorney_phone).toBe('6196290527');
    expect(row.attorney_email).toBe('noam@entornolaw.com');
    expect(row.attorney_bar_number).toBe('251582');
    expect(row.serve_fee).toBe(54.23);
    expect(row.serve_type).toBe('corporate');
    expect(row.time_window).toBe('anytime');
    expect(row.sm_job_id).toBe('16717993');
    expect(row.plaintiff).toBe('Environmental Health Advocates, Inc.');
  });
});

describe('intake copy helpers', () => {
  it('maps person → individual and business → business', () => {
    expect(mapRecipientType('person')).toBe('individual');
    expect(mapRecipientType('business')).toBe('business');
    expect(mapRecipientType('')).toBeNull();
  });
  it('maps process_type onto serve_type', () => {
    expect(mapIntakeServeType('personal', false)).toBe('personal');
    expect(mapIntakeServeType('personal', true)).toBe('corporate');
    expect(mapIntakeServeType('substitute', false)).toBe('substituted');
    expect(mapIntakeServeType('posted', false)).toBe('posting');
    expect(mapIntakeServeType('mail', false)).toBe('publication');
  });
  it('parses fee amounts', () => {
    expect(parseFeeAmount('$54.23')).toBe(54.23);
    expect(parseFeeAmount('1,200')).toBe(1200);
    expect(parseFeeAmount('')).toBeNull();
  });
  it('encodes Anytime as all four Dispatch window slots', () => {
    expect(JSON.parse(encodePsoServiceWindows('Anytime')!)).toEqual({
      early_morning: true, daytime: true, evening: true, weekend: true,
    });
  });
  it('encodes evenings and weekends without lighting every slot', () => {
    expect(JSON.parse(encodePsoServiceWindows('evenings and weekends')!)).toEqual({
      early_morning: false, daytime: false, evening: true, weekend: true,
    });
  });
  it('maps time_window', () => {
    expect(mapTimeWindow('Anytime')).toBe('anytime');
    expect(mapTimeWindow('evening only')).toBe('evening');
  });
});

describe('normalizeAddressClass', () => {
  it('recognizes explicit business language', () => {
    expect(normalizeAddressClass('BUSINESS ADDRESS')).toBe('business');
    expect(normalizeAddressClass('place of employment')).toBe('business');
    expect(normalizeAddressClass('commercial')).toBe('small_business');
  });

  it('recognizes residential language', () => {
    expect(normalizeAddressClass('residence')).toBe('residential');
    expect(normalizeAddressClass('abode')).toBe('residential');
  });

  it('returns unknown for anything it cannot confirm', () => {
    expect(normalizeAddressClass('')).toBe('unknown');
    expect(normalizeAddressClass('see instructions')).toBe('unknown');
  });

  it('does NOT infer business from a registered-agent mention', () => {
    // Operator decision D-2: class is a property of the LOCATION, and a
    // registered agent may sit at a residence.
    expect(normalizeAddressClass('registered agent')).toBe('unknown');
  });
});

describe('new timing fields flow through normalizeFields', () => {
  it('normalizes the start-date bar to ISO', () => {
    const out = normalizeFields(fieldsFrom({ attempt_start_not_before: '6/26/2026' }));
    expect(out.attempt_start_not_before.value).toBe('2026-06-26');
  });

  it('drops an unparseable start-date rather than guessing', () => {
    const out = normalizeFields(fieldsFrom({ attempt_start_not_before: 'after the holiday' }));
    expect(out.attempt_start_not_before.value).toBe('');
    expect(out.attempt_start_not_before.confidence).toBe(0);
  });

  it('canonicalizes address_class', () => {
    const out = normalizeFields(fieldsFrom({ address_class: 'BUSINESS ADDRESS' }));
    expect(out.address_class.value).toBe('business');
  });

  it('preserves the client attempt schedule verbatim', () => {
    const out = normalizeFields(fieldsFrom({ client_attempt_schedule: '06:00-09:00;09:00-18:00' }));
    expect(out.client_attempt_schedule.value).toBe('06:00-09:00;09:00-18:00');
  });
});

describe('normalizeYesNo', () => {
  it('maps affirmative forms to yes', () => {
    expect(normalizeYesNo('Yes')).toBe('yes');
    expect(normalizeYesNo('TRUE')).toBe('yes');
    expect(normalizeYesNo('y')).toBe('yes');
  });

  it('maps negative forms to no', () => {
    expect(normalizeYesNo('No')).toBe('no');
    expect(normalizeYesNo('false')).toBe('no');
  });

  it('returns empty for anything ambiguous', () => {
    expect(normalizeYesNo('maybe')).toBe('');
    expect(normalizeYesNo('')).toBe('');
  });
});

describe('witness fee and agent address fields', () => {
  it('keeps the witness-fee instrument verbatim', () => {
    const out = normalizeFields(fieldsFrom({ witness_fee_instrument: 'Check VV787 $18.50' }));
    expect(out.witness_fee_instrument.value).toBe('Check VV787 $18.50');
  });

  it('canonicalizes the tendered flag', () => {
    const out = normalizeFields(fieldsFrom({ witness_fee_tendered: 'TRUE' }));
    expect(out.witness_fee_tendered.value).toBe('yes');
  });

  it('de-noises the registered agent address like other name fields', () => {
    const out = normalizeFields(fieldsFrom({
      registered_agent_address: '1400 West Confluence Ave Ste 310, Salt Lake City, UT 84104',
    }));
    expect(out.registered_agent_address.value).toContain('1400 West Confluence Ave');
  });

  it('canonicalizes the first-attempt sub-service authorization', () => {
    const out = normalizeFields(fieldsFrom({ sub_service_authorized_first_attempt: 'yes' }));
    expect(out.sub_service_authorized_first_attempt.value).toBe('yes');
  });
});

describe('buildFamilyPrompt', () => {
  it('gives the field sheet its own guidance', () => {
    const p = buildFamilyPrompt('field_sheet');
    expect(p).toMatch(/watermark/i);
    expect(p).toMatch(/Instructions/);
  });

  it('gives the court filing caption guidance', () => {
    const p = buildFamilyPrompt('court_filing');
    expect(p).toMatch(/caption/i);
  });

  it('returns a non-empty generic prompt for unknown families', () => {
    expect(buildFamilyPrompt('other').length).toBeGreaterThan(0);
  });
});

describe('familyFromFileName', () => {
  it('maps the three conventional packet file names to their family keys', () => {
    expect(familyFromFileName('90000123 Field Sheet.pdf')).toBe('field_sheet');
    expect(familyFromFileName('90000123 Court Docket.pdf')).toBe('court_filing');
    expect(familyFromFileName('90000123 Information Form.pdf')).toBe('info_page');
  });

  it('is case-insensitive and tolerant of punctuation/spacing variation', () => {
    expect(familyFromFileName('90000123_FIELD-SHEET.PDF')).toBe('field_sheet');
    expect(familyFromFileName('90000123  field   sheet.pdf')).toBe('field_sheet');
    expect(familyFromFileName('90000123-court_docket.pdf')).toBe('court_filing');
    expect(familyFromFileName('90000123 info form.pdf')).toBe('info_page');
    expect(familyFromFileName('90000123 INFORMATION-PAGE.pdf')).toBe('info_page');
  });

  it('returns undefined for unrelated or ambiguous file names', () => {
    expect(familyFromFileName('scan001.pdf')).toBeUndefined();
    expect(familyFromFileName('affidavit.pdf')).toBeUndefined();
    expect(familyFromFileName('')).toBeUndefined();
  });
});

describe('buildExtractionMessages — family prompt wiring', () => {
  it('appends field-sheet-specific guidance to the system message only when docType is passed', () => {
    const withFamily = buildExtractionMessages('some document text', 'field_sheet');
    const without = buildExtractionMessages('some document text');
    const systemWith = withFamily.find((m) => m.role === 'system')?.content ?? '';
    const systemWithout = without.find((m) => m.role === 'system')?.content ?? '';
    expect(systemWith).toMatch(/watermark/i);
    expect(systemWith).toMatch(/ICU Investigations FIELD SHEET/i);
    expect(systemWithout).not.toMatch(/watermark/i);
    expect(systemWithout).not.toMatch(/ICU Investigations FIELD SHEET/i);
  });
});

describe('needsCriticPass', () => {
  it('selects only low-confidence critical fields', () => {
    const fields = fieldsFrom({ case_number: 'X', recipient_address: 'Y' });
    fields.case_number.confidence = 0.3;
    fields.recipient_address.confidence = 0.95;
    expect(needsCriticPass(fields, [])).toEqual(['case_number']);
  });

  it('includes fields the validator flagged as errors', () => {
    const fields = fieldsFrom({ recipient_zip: '94304' });
    const issues = [{ field: 'recipient_zip', severity: 'error' as const, message: 'mismatch' }];
    expect(needsCriticPass(fields, issues)).toContain('recipient_zip');
  });

  it('returns an empty list when everything is confident and clean', () => {
    const fields = fieldsFrom({ case_number: 'X' });
    fields.case_number.confidence = 0.95;
    expect(needsCriticPass(fields, [])).toEqual([]);
  });

  it('never returns more than the cap, to bound neuron spend', () => {
    const fields = fieldsFrom({
      case_number: 'a', recipient_address: 'b', court_name: 'c',
      service_deadline: 'd', recipient_dob: 'e', recipient_phone: 'f',
    });
    for (const k of Object.keys(fields)) fields[k].confidence = 0.1;
    expect(needsCriticPass(fields, []).length).toBeLessThanOrEqual(5);
  });
});

// ============================================================
// R5(a) — registered_agent_address must NOT get the party-name de-noiser
// ============================================================
describe('normalizeFields — address fields bypass scrubPartyNoise', () => {
  it('keeps an address with two short adjacent number tokens intact', () => {
    // scrubPartyNoise strips runs of 2+ short number tokens as California
    // pleading margin line-numbers. On an address that rule deletes the unit
    // number AND the house number: "Apt 5 210 Main St" → "Apt Main St", which
    // is a wrong-building dispatch. The old fixture survived only because its
    // house number happened to be four digits.
    const out = normalizeFields(fieldsFrom({ registered_agent_address: 'Apt 5 210 Main St' }));
    expect(out.registered_agent_address.value).toBe('Apt 5 210 Main St');
  });

  it('keeps a Ste + house-number address intact', () => {
    const out = normalizeFields(fieldsFrom({ registered_agent_address: 'Ste 12 90 W Center St' }));
    expect(out.registered_agent_address.value).toBe('Ste 12 90 W Center St');
  });

  it('still scrubs party-name noise from actual name fields', () => {
    // The de-noiser is not weakened — it just no longer touches addresses.
    const out = normalizeFields(fieldsFrom({ plaintiff: 'Attorney for Plaintiff Sample Bank, N.A.' }));
    expect(out.plaintiff.value).toBe('Sample Bank, N.A.');
  });
});

// ============================================================
// R5(b) — spec decision D-2: unconfirmed must never yield business timing
// ============================================================
describe('normalizeAddressClass — residential wins a both-hints string', () => {
  it("classifies 'HOME ADDRESS ... use the leasing office entrance' as residential", () => {
    // Contains 'office' (a business hint) AND 'HOME ADDRESS'/'apartment'.
    // Returning 'business' here would schedule weekday-only business windows
    // at a residence and miss every evening and weekend attempt.
    expect(normalizeAddressClass(
      'SERVE AT HOME ADDRESS — apartment complex, use the leasing office entrance',
    )).toBe('residential');
  });

  it('classifies an apartment with a suite-numbered leasing office as residential', () => {
    expect(normalizeAddressClass('Apt 4B, leasing office Suite 100')).toBe('residential');
  });

  it('still classifies an unambiguous business address as business', () => {
    expect(normalizeAddressClass('service at his place of employment')).toBe('business');
    expect(normalizeAddressClass('corporate address, 5th floor')).toBe('corporate');
  });
});

// ============================================================
// P1 — "et al" appears with and without the period after "et"
// ============================================================
describe('normalizeFields — et al. stripping covers both spellings', () => {
  it("strips 'et al.'", () => {
    expect(normalizeFields(fieldsFrom({ defendant: 'John Q Sample, et al.' })).defendant.value)
      .toBe('John Q Sample');
  });

  it("strips 'et. al.' (period after 'et' — the spelling seen on real captions)", () => {
    expect(normalizeFields(fieldsFrom({ defendant: 'John Q Sample, et. al.' })).defendant.value)
      .toBe('John Q Sample');
  });

  it("strips a bare 'et al' with no periods", () => {
    expect(normalizeFields(fieldsFrom({ defendant: 'John Q Sample et al' })).defendant.value)
      .toBe('John Q Sample');
  });

  it("does not eat a name that merely starts with 'et'", () => {
    expect(normalizeFields(fieldsFrom({ defendant: 'Ethan Alvarez' })).defendant.value)
      .toBe('Ethan Alvarez');
  });

  it("does not truncate a name where 'et' lands mid-word before 'Al' (regression: missing leading \\b)", () => {
    expect(normalizeFields(fieldsFrom({ defendant: 'Comet. Al Ventures' })).defendant.value)
      .toBe('Comet. Al Ventures');
  });
});

// ============================================================
// P2/P3 — the one-shot and rules must TEACH service_deadline and priority
// ============================================================
describe('extraction prompt — service_deadline and priority are taught', () => {
  it("the few-shot output populates service_deadline from the header due date", () => {
    const msgs = buildExtractionMessages('irrelevant document text for prompt shape', undefined);
    const user = msgs.find((m) => m.role === 'user')!.content;
    // The few-shot INPUT carries a header due date of 6/15/26. Omitting
    // service_deadline from the few-shot OUTPUT actively taught the model
    // that a header due date does not populate it.
    expect(user).toContain('6/15/26');
    expect(user).toMatch(/"service_deadline":\{"value":"2026-06-15"/);
  });

  it('the extraction rules enumerate the priority values', () => {
    const system = buildExtractionMessages('irrelevant', undefined).find((m) => m.role === 'system')!.content;
    expect(system).toMatch(/priority/);
    expect(system).toMatch(/'routine'/);
    expect(system).toMatch(/'rush'/);
    expect(system).toMatch(/'urgent'/);
  });

  it('the info_page family prompt names the JOB-header due date as the deadline', () => {
    expect(buildFamilyPrompt('info_page')).toMatch(/service_deadline/);
  });
});
