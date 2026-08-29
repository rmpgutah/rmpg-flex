import { describe, it, expect } from 'vitest';
import {
  clientWindowText, assessOfficerSafety, buildPsoBriefing, recipientPartyStatus,
  clientServiceRuleText, firstAttemptDirective, diligenceCadenceText, allDaysAuthorized,
} from '../src/utils/serveIntakeBriefing';
import type { BriefingInput } from '../src/utils/serveIntakeBriefing';
import type { QueueRow } from '../src/utils/serveIntakeExtract';
import { computeScheduleImpossible } from '../src/utils/serveIntakeRecords';

const baseRow: QueueRow = {
  recipient_name: 'DANA WHITFIELD', recipient_address: '1180 E VINE ST',
  recipient_city: 'SALT LAKE CITY', recipient_state: 'UT', recipient_zip: '84121',
  document_type: 'subpoena', case_number: '900904528', court_name: 'THIRD DISTRICT',
  jurisdiction: 'UT', client_name: 'ICU', attorney_name: null,
  priority: 'rush', deadline: '2026-06-30', service_instructions: null,
  notes: null, plaintiff: 'AVERY HOLT', defendant: 'NORTHGATE LOGISTICS, LLC',
  court_date: null, sm_job_id: null,
  recipient_phone: null, recipient_dob: null, recipient_type: null,
  business_name: null, registered_agent_name: null, registered_office_address: null,
  attorney_phone: null, attorney_email: null, attorney_bar_number: null,
  serve_type: null, serve_fee: null, time_window: null,
};

// Builds a minimal BriefingInput around a queueRow override, and returns the
// text of the INTAKE note (the structured briefing body) so fix-round-1
// regression tests can assert on what the officer actually reads.
function intakeNoteText(queueRowOverrides: Partial<QueueRow>): string {
  const input: BriefingInput = {
    fields: {},
    queueRow: { ...baseRow, ...queueRowOverrides },
    isBusiness: false,
    agentName: '',
    fullLocation: '1180 E Vine St, Salt Lake City, UT 84121',
    docCount: 1,
  };
  const briefing = buildPsoBriefing(input, '2026-06-20T12:00:00Z');
  const note = briefing.notes.find((n) => n.author === 'INTAKE');
  if (!note) throw new Error('INTAKE note not found');
  return note.text;
}

describe('D2: client windows are read from service_instructions, not just notes', () => {
  it('finds a client restriction stated in service_instructions', () => {
    const row = { ...baseRow, service_instructions: 'Diligence is 1 between 6AM-9AM, 1 between 9AM-6PM.' };
    expect(clientWindowText(row)).toContain('6AM-9AM');
  });

  it('still finds one stated in notes', () => {
    const row = { ...baseRow, notes: 'SERVE ON FRIDAY BETWEEN 9AM AND 3:30PM' };
    expect(clientWindowText(row)).toContain('FRIDAY');
  });

  it('ignores the OCR provenance line that notes carries', () => {
    const row = { ...baseRow, notes: '[OCR intake 2026-07-27: 3/3 docs read, 92% confidence]' };
    expect(clientWindowText(row)).toBeNull();
  });

  it('returns null when the client genuinely specified nothing', () => {
    expect(clientWindowText(baseRow)).toBeNull();
  });
});

describe('officer safety remains unchanged by this task', () => {
  it('still returns a baseline caution for a routine civil paper', () => {
    const a = assessOfficerSafety({}, baseRow);
    expect(a.caution).toBe(true);
    expect(a.severity).toBe('baseline');
  });
});

// ── Fix round 1: unsubstantiated assertions ──────────────────────────────

describe('Finding 1: UIDDA out-of-state check requires a RELIABLE state code', () => {
  it('does NOT fire when jurisdiction is a county/court descriptor, not a state code (routine in-state job)', () => {
    // This is exactly the shape the extraction few-shot teaches for
    // `jurisdiction` (serveIntakeExtract.ts ~line 294: 'Salt Lake') — a
    // county name, not a state. Comparing it to recipient_state used to
    // fabricate a UIDDA domestication warning on a routine Utah job.
    const text = intakeNoteText({ jurisdiction: 'Salt Lake', recipient_state: 'UT' });
    expect(text).not.toContain('Uniform Interstate Depositions and Discovery Act');
    expect(text).not.toContain('OUT-OF-STATE PROCESS');
  });

  it('does NOT fire on a full state name either — only an unambiguous two-letter code counts', () => {
    const text = intakeNoteText({ jurisdiction: 'California', recipient_state: 'UT' });
    expect(text).not.toContain('Uniform Interstate Depositions and Discovery Act');
    expect(text).not.toContain('OUT-OF-STATE PROCESS');
  });

  it('fires for a genuinely out-of-state issuing court (reliable two-letter codes that differ)', () => {
    const text = intakeNoteText({ jurisdiction: 'CA', recipient_state: 'UT' });
    expect(text).toContain('OUT-OF-STATE PROCESS');
    expect(text).toContain('Uniform Interstate Depositions and Discovery Act');
  });

  it('does not fire when the codes are reliable and match (same-state job)', () => {
    const text = intakeNoteText({ jurisdiction: 'UT', recipient_state: 'UT' });
    expect(text).not.toContain('OUT-OF-STATE PROCESS');
  });
});

describe('Finding 2: client-window detection requires real evidence of a time restriction', () => {
  it('does NOT treat a bare weekday-range mention as an attempt restriction', () => {
    const row = { ...baseRow, service_instructions: 'Attorney available Monday-Friday for questions' };
    expect(clientWindowText(row)).toBeNull();
  });

  it('does NOT treat a bare date/weekday mention (no clock range, no service language) as a restriction', () => {
    const row = { ...baseRow, service_instructions: 'Hearing set for Friday, 6/20' };
    expect(clientWindowText(row)).toBeNull();
  });

  // Existing true-positive coverage (must keep passing, unchanged contract):
  it('still finds a genuine clock-time range', () => {
    const row = { ...baseRow, service_instructions: 'Diligence is 1 between 6AM-9AM, 1 between 9AM-6PM.' };
    expect(clientWindowText(row)).toContain('6AM-9AM');
  });

  it('still finds explicit service/attempt-timing language paired with clock times', () => {
    const row = { ...baseRow, notes: 'SERVE ON FRIDAY BETWEEN 9AM AND 3:30PM' };
    expect(clientWindowText(row)).toContain('FRIDAY');
  });
});

describe('Finding 3: schedule-impossible check uses the real planned window count', () => {
  it('does not falsely flag a business job (2 default windows) with 2 days remaining as impossible', () => {
    // Old bug: `clientBands.length || 3` used 3 (the RESIDENTIAL default
    // count) even for a business job, whose real default is 2 windows.
    // 2 windows fit in 2 days; the old hardcoded-3 logic wrongly said no.
    expect(computeScheduleImpossible(2, 2)).toBe(false);
  });

  it('still flags a genuinely impossible client-driven schedule', () => {
    // 3 distinct client-dictated bands cannot fit in 1 remaining day.
    expect(computeScheduleImpossible(3, 1)).toBe(true);
  });

  it('treats a null deadline (no days-remaining constraint) as always fitting', () => {
    expect(computeScheduleImpossible(3, null)).toBe(false);
  });

  it('the briefing blames the client only when a client schedule actually exists', () => {
    const input: BriefingInput = {
      fields: {},
      queueRow: baseRow,
      isBusiness: false,
      agentName: '',
      fullLocation: '1180 E Vine St, Salt Lake City, UT 84121',
      docCount: 1,
      attemptPlan: [
        { attempt: 1, date: '2026-06-21', weekday: 'Sunday', window: '09:30-11:30', focus: 'x', authority: 'business default' },
      ],
      scheduleImpossible: true,
      hasClientSchedule: false,
    };
    // The impossible-schedule warning lives in the ATTEMPT PLAN note
    // (author DISPATCH) now that the briefing is split into six topical
    // notes — check the full note feed rather than a single author.
    const text = buildPsoBriefing(input, '2026-06-20T12:00:00Z').notes.map((n) => n.text).join('\n');
    expect(text).toContain('standard diligence sequence cannot fit');
    expect(text).not.toContain("client's own attempt schedule");
  });

  it('the briefing blames the client\'s schedule when one was actually specified', () => {
    const input: BriefingInput = {
      fields: {},
      queueRow: baseRow,
      isBusiness: false,
      agentName: '',
      fullLocation: '1180 E Vine St, Salt Lake City, UT 84121',
      docCount: 1,
      attemptPlan: [
        { attempt: 1, date: '2026-06-21', weekday: 'Sunday', window: '06:00-09:00', focus: 'x', authority: 'client-specified' },
      ],
      scheduleImpossible: true,
      hasClientSchedule: true,
    };
    // Same note-feed rationale as the previous test.
    const text = buildPsoBriefing(input, '2026-06-20T12:00:00Z').notes.map((n) => n.text).join('\n');
    expect(text).toContain("client's own attempt schedule");
  });
});

describe('Finding 4: recipient-vs-party matching is token-based and confidence-aware', () => {
  it('recipient IS a named party (exact match) — no non-party note', () => {
    expect(recipientPartyStatus('NORTHGATE LOGISTICS, LLC', ['AVERY HOLT', 'NORTHGATE LOGISTICS, LLC'])).toBe('party');
    const text = intakeNoteText({ recipient_name: 'NORTHGATE LOGISTICS, LLC' });
    expect(text).not.toContain('is NOT a named party');
  });

  it('a surname appearing inside an unrelated company defendant is correctly treated as non-party', () => {
    // "WHITFIELD" is a token inside "WHITFIELD ENTERPRISES, LLC", but the
    // recipient "DANA WHITFIELD" is a different, unrelated individual — a
    // partial token overlap must NOT be read as a party match.
    const status = recipientPartyStatus('DANA WHITFIELD', ['AVERY HOLT', 'WHITFIELD ENTERPRISES, LLC']);
    expect(status).toBe('non-party');
    const text = intakeNoteText({ recipient_name: 'DANA WHITFIELD', defendant: 'WHITFIELD ENTERPRISES, LLC' });
    expect(text).toContain('DANA WHITFIELD is NOT a named party');
  });

  it('formatting variance ("SMITH, JOHN" vs "JOHN SMITH") is still recognized as a match', () => {
    const status = recipientPartyStatus('SMITH, JOHN', ['JOHN SMITH', 'SOME CO LLC']);
    expect(status).toBe('party');
    const text = intakeNoteText({ recipient_name: 'SMITH, JOHN', plaintiff: 'JOHN SMITH', defendant: 'SOME CO LLC' });
    expect(text).not.toContain('is NOT a named party');
  });

  it('stays silent (does not assert non-party) when there is not enough recipient-name evidence', () => {
    // A single-token recipient name can't be confidently compared.
    expect(recipientPartyStatus('WHITFIELD', ['AVERY HOLT', 'NORTHGATE LOGISTICS, LLC'])).toBe('unknown');
  });
});

describe('briefing decomposition (spec §3.3)', () => {
  const input: BriefingInput = {
    fields: {} as any,
    queueRow: baseRow,
    isBusiness: false,
    agentName: '',
    fullLocation: '1180 E VINE ST, SALT LAKE CITY, UT 84121',
    docCount: 3,
    attemptPlan: [
      { attempt: 1, date: '2026-06-27', weekday: 'Saturday', window: '07:00-09:00', focus: 'early morning', authority: 'residential default' as const },
    ],
  };

  it('emits six notes, one per topic', () => {
    const b = buildPsoBriefing(input, '2026-06-26T12:00:00Z');
    expect(b.notes).toHaveLength(6);
  });

  it('the safety note comes first so it sits at the top of the feed', () => {
    const b = buildPsoBriefing(input, '2026-06-26T12:00:00Z');
    expect(b.notes[0].author).toBe('OFFICER SAFETY');
  });

  it('assigns the documented author tags in order', () => {
    const b = buildPsoBriefing(input, '2026-06-26T12:00:00Z');
    expect(b.notes.map((n) => n.author)).toEqual([
      'OFFICER SAFETY', 'INTAKE', 'DISPATCH', 'DISPATCH', 'DISPATCH', 'DISPATCH',
    ]);
  });

  it('every note has non-empty body text', () => {
    const b = buildPsoBriefing(input, '2026-06-26T12:00:00Z');
    expect(b.notes.every((n) => n.text.trim().length > 0)).toBe(true);
  });

  it('note ids are unique so the renderer cannot collapse two entries', () => {
    const b = buildPsoBriefing(input, '2026-06-26T12:00:00Z');
    expect(new Set(b.notes.map((n) => n.id)).size).toBe(b.notes.length);
  });

  it('the attempt-plan note carries the window authority', () => {
    const b = buildPsoBriefing(input, '2026-06-26T12:00:00Z');
    const planNote = b.notes.find((n) => n.text.includes('ATTEMPT PLAN') || n.text.includes('Attempt 1'));
    expect(planNote?.text).toContain('residential default');
  });
});

// ============================================================
// Fix round 2 (whole-branch review of PR 2)
// ============================================================

// Builds a BriefingInput and returns the FULL note feed as one string, so a
// test can assert on what the officer actually reads across all six entries.
function fullBriefingText(overrides: Partial<BriefingInput> & { queueRow?: any }): string {
  const input: BriefingInput = {
    fields: {},
    queueRow: baseRow,
    isBusiness: false,
    agentName: '',
    fullLocation: '1180 E VINE ST, SALT LAKE CITY, UT 84121',
    docCount: 1,
    ...overrides,
  };
  return buildPsoBriefing(input, '2026-06-20T12:00:00Z').notes.map((n) => n.text).join('\n');
}

describe('R1: the briefing must not fabricate a client hours restriction', () => {
  it('a routine instruction containing the word "serve" but NO clock range is not a restriction', () => {
    // The exact production string from the review. Under the old OR this
    // printed "__Client restriction (verbatim):__ Please serve defendant at
    // the residence. Gate code 4412." followed by "Do NOT attempt outside
    // these hours" — an hours restriction containing no hours, plus an
    // instruction to log a restriction that does not exist.
    const row = {
      ...baseRow,
      service_instructions: 'Please serve defendant at the residence. Gate code 4412.',
    };
    expect(clientWindowText(row)).toBeNull();
  });

  it('and the report does not tell the officer to log a non-existent restriction', () => {
    const text = fullBriefingText({
      queueRow: { ...baseRow, service_instructions: 'Please serve defendant at the residence. Gate code 4412.' },
    });
    expect(text).not.toContain('Client restriction (verbatim)');
    expect(text).not.toContain('client-imposed restriction — departed without contact');
    expect(text).toContain('No client restriction on file');
    // The same text still appears once, under CLIENT INSTRUCTIONS — the
    // report must not contradict itself about what it is.
    expect(text).toContain('CLIENT INSTRUCTIONS');
  });

  it('a clock range with NO service/attempt/diligence language is also not a restriction', () => {
    const row = { ...baseRow, service_instructions: 'Office open 9AM-5PM for document pickup' };
    expect(clientWindowText(row)).toBeNull();
  });

  it('both signals together ARE a restriction (the AND is not over-broad)', () => {
    const row = { ...baseRow, service_instructions: 'Do not attempt service before 8AM or after 6PM.' };
    expect(clientWindowText(row)).toContain('8AM');
  });
});

describe('R2: SERVICE WINDOWS is driven by the timing engine, not a regex over prose', () => {
  it('a parsed 24-hour client schedule is never described as "no client restriction"', () => {
    // The canonical form ('06:00-09:00;18:00-21:00') carries no am/pm, so the
    // old prose detector never matched it — the note said "No client
    // restriction — standard diligence windows apply" directly beneath three
    // [client-specified] windows.
    const text = fullBriefingText({
      attemptPlan: [
        { attempt: 1, date: '2026-06-21', weekday: 'Sunday', window: '06:00-09:00', focus: 'x', authority: 'client-specified' },
        { attempt: 2, date: '2026-06-22', weekday: 'Monday', window: '18:00-21:00', focus: 'x', authority: 'client-specified' },
      ],
      hasClientSchedule: true,
    });
    expect(text).not.toContain('No client restriction');
    expect(text).toContain('The client dictated the attempt hours');
    expect(text).toContain('Do NOT attempt outside these hours');
  });

  it('the standard business hours it prints are the hours the planner actually uses', () => {
    const text = fullBriefingText({
      attemptPlan: [
        { attempt: 1, date: '2026-06-22', weekday: 'Monday', window: '09:30-11:30', focus: 'x', authority: 'business default' },
      ],
    });
    expect(text).toContain('09:30–11:30');
    expect(text).toContain('13:30–15:30');
    // The stale figures must be gone — one report cannot state two different
    // sets of business hours.
    expect(text).not.toContain('09:00–11:00');
    expect(text).not.toContain('13:00–16:00');
  });

  it('restriction language present but NOT parsed into bands is labelled as unapplied', () => {
    const text = fullBriefingText({
      queueRow: { ...baseRow, service_instructions: 'Do not attempt service before 8AM or after 6PM.' },
      hasClientSchedule: false,
      attemptPlan: [
        { attempt: 1, date: '2026-06-21', weekday: 'Sunday', window: '07:00-09:00', focus: 'x', authority: 'residential default' },
      ],
    });
    expect(text).toContain('NOT parsed into structured attempt bands');
    expect(text).not.toContain('No client restriction on file');
  });
});

describe('R3: an unparseable client restriction is disclosed, not silently defaulted away', () => {
  it('names the unreadable day restriction and tells the officer not to attempt on it', () => {
    const text = fullBriefingText({
      unparsedAllowedDays: 'no service on sunday',
      attemptPlan: [
        { attempt: 1, date: '2026-06-21', weekday: 'Sunday', window: '07:00-09:00', focus: 'x', authority: 'residential default' },
      ],
    });
    expect(text).toContain('COULD NOT BE PARSED');
    expect(text).toContain('VERIFY WITH THE HIRING PARTY');
    expect(text).toContain('no service on sunday');
  });

  it('names an unreadable attempt-hours value too', () => {
    const text = fullBriefingText({ unparsedClientSchedule: 'mornings only pls' });
    expect(text).toContain('COULD NOT BE PARSED');
    expect(text).toContain('mornings only pls');
  });

  it('says nothing when the client genuinely dictated nothing', () => {
    expect(fullBriefingText({})).not.toContain('COULD NOT BE PARSED');
  });
});

describe('R7: the briefing only claims site-note compliance when the plan actually applied it', () => {
  const note = {
    id: 1, note_text: 'Gate locked after 3pm', note_type: 'access',
    cutoff_time: '15:00', hours_start: null, hours_end: null, days_available: null,
  } as any;

  it('does NOT claim compliance when client bands took precedence over the note', () => {
    const text = fullBriefingText({
      locationNote: note,
      hasClientSchedule: true,
      attemptPlan: [
        { attempt: 1, date: '2026-06-22', weekday: 'Monday', window: '18:00-21:00', focus: 'x', authority: 'client-specified' },
      ],
    });
    expect(text).not.toContain('have been adjusted to comply with these constraints');
    expect(text).toContain('CONFLICT');
    expect(text).toContain('OUTRANK');
  });

  it('does NOT claim compliance when the windows came from the class defaults', () => {
    const text = fullBriefingText({
      locationNote: note,
      attemptPlan: [
        { attempt: 1, date: '2026-06-21', weekday: 'Sunday', window: '07:00-09:00', focus: 'x', authority: 'residential default' },
      ],
    });
    expect(text).not.toContain('have been adjusted to comply with these constraints');
    expect(text).toContain('did NOT shape the attempt windows');
  });

  it('DOES claim compliance when a window actually carries the site-note authority', () => {
    const text = fullBriefingText({
      locationNote: note,
      attemptPlan: [
        { attempt: 1, date: '2026-06-22', weekday: 'Monday', window: '08:00-15:00', focus: 'x', authority: 'site note' },
      ],
    });
    expect(text).toContain('have been adjusted to comply with these constraints');
  });
});

describe('R10: party matching is bidirectional', () => {
  it('a suffixed recipient name still matches the defendant it belongs to', () => {
    // "JOHN SMITH JR" vs defendant "SMITH, JOHN": the suffix has no
    // counterpart, so party-superset-of-recipient failed and the report told
    // the officer the ACTUAL defendant was not a named party.
    expect(recipientPartyStatus('JOHN SMITH JR', ['ACME CORP', 'SMITH, JOHN'])).toBe('party');
    const text = intakeNoteText({
      recipient_name: 'JOHN SMITH JR', plaintiff: 'ACME CORP', defendant: 'SMITH, JOHN',
    });
    expect(text).not.toContain('is NOT a named party');
  });

  it('a middle name on the recipient side does not break the match either', () => {
    expect(recipientPartyStatus('DANA MARIE WHITFIELD', ['AVERY HOLT', 'DANA WHITFIELD'])).toBe('party');
  });

  it('a single-token party cannot swallow an unrelated recipient', () => {
    // Reverse containment requires >= 2 party tokens, so bare "SMITH" must
    // not match "DANA SMITHERS" — nor any two-token recipient it merely
    // shares one token with.
    expect(recipientPartyStatus('DANA WHITFIELD', ['WHITFIELD'])).toBe('non-party');
  });

  it('genuinely unrelated names are still non-party (the fix is not over-broad)', () => {
    expect(recipientPartyStatus('DANA WHITFIELD', ['AVERY HOLT', 'WHITFIELD ENTERPRISES, LLC'])).toBe('non-party');
  });

  it('R10b: both sides carrying one extra token still matches (symmetric divergence)', () => {
    // "JOHN SMITH JR" vs "JOHN DAVID SMITH": shared core {JOHN, SMITH} >= 2,
    // each side has exactly 1 diverging token (suffix vs middle name).
    expect(recipientPartyStatus('JOHN SMITH JR', ['JOHN DAVID SMITH'])).toBe('party');
    // "DANA MARIE WHITFIELD" vs "DANA WHITFIELD JR": shared {DANA, WHITFIELD}.
    expect(recipientPartyStatus('DANA MARIE WHITFIELD', ['DANA WHITFIELD JR'])).toBe('party');
    // Guard: two diverging tokens on one side must not match (too many unknowns).
    expect(recipientPartyStatus('JOHN SMITH JR III', ['JOHN DAVID SMITH'])).toBe('non-party');
    // Guard: only 1 shared token between otherwise unrelated names — no match.
    expect(recipientPartyStatus('JOHN ADAMS JR', ['JOHN KENNEDY SR'])).toBe('non-party');
  });
});

// ── Dynamic dispatch-notation extraction (hardening pass) ───────────────
const RUSH_INSTRUCTIONS =
  'RUSH - START ATTEMPTS ON TONIGHT OR LATEST WED MORNING. UTAH SUBPOENA. ' +
  'Rule: Attempt personal; if unable, 1st-attempt abode subservice to resident 18+; employment personal only. ' +
  'Service Days: 7 days/week. Diligence: 6-9AM, 9AM-6PM, 6-9PM; one Sat/Sun';

describe('dynamic instruction extraction', () => {
  it('extracts the manner-of-service rule sentences verbatim', () => {
    const rule = clientServiceRuleText({ ...baseRow, service_instructions: RUSH_INSTRUCTIONS });
    expect(rule).toContain('Attempt personal');
    expect(rule).toContain('abode subservice to resident 18+');
    expect(rule).not.toContain('RUSH - START');
  });

  it('returns null when no manner-of-service language exists', () => {
    expect(clientServiceRuleText({ ...baseRow, service_instructions: 'Gate code 4412.' })).toBeNull();
    expect(clientServiceRuleText({ ...baseRow, service_instructions: null })).toBeNull();
  });

  it('extracts the first-attempt directive sentence', () => {
    const d = firstAttemptDirective({ ...baseRow, service_instructions: RUSH_INSTRUCTIONS });
    expect(d).toBe('RUSH - START ATTEMPTS ON TONIGHT OR LATEST WED MORNING.');
  });

  it('does not fabricate a first-attempt directive from unrelated text', () => {
    expect(firstAttemptDirective({ ...baseRow, service_instructions: 'Please serve promptly.' })).toBeNull();
  });

  it('extracts a diligence cadence only with a real clock range', () => {
    const c = diligenceCadenceText({ ...baseRow, service_instructions: RUSH_INSTRUCTIONS });
    expect(c).toContain('6-9AM');
    // Prose "diligence" without clock times stays silent (R1 discipline).
    expect(diligenceCadenceText({ ...baseRow, service_instructions: 'Diligence is expected per county norms.' })).toBeNull();
  });

  it('detects all-7-days authorization but not narrower day scopes', () => {
    expect(allDaysAuthorized({ ...baseRow, service_instructions: 'Service Days: 7 days/week.' })).toBe(true);
    expect(allDaysAuthorized({ ...baseRow, service_instructions: 'Service days: Monday-Friday only.' })).toBe(false);
  });

  it('surfaces the client rule and 7-day authorization in the INTAKE note SERVICE AUTHORITY section', () => {
    const t = intakeNoteText({ service_instructions: RUSH_INSTRUCTIONS });
    expect(t).toContain('CLIENT SERVICE RULE (verbatim)');
    expect(t).toContain('ALL 7 DAYS');
  });
});

describe('hardening pass 2: self-explaining notes', () => {
  it('plan note explains itself when no attempt plan was generated', () => {
    const input: BriefingInput = {
      fields: {},
      queueRow: { ...baseRow, recipient_address: '' },
      isBusiness: false, agentName: '', fullLocation: '', docCount: 1,
    };
    const briefing = buildPsoBriefing(input, '2026-06-20T12:00:00Z');
    const plan = briefing.notes.find((n) => n.author === 'DISPATCH' && n.text.includes('ATTEMPT PLAN'))!;
    expect(plan).toBeTruthy();
    expect(plan.text).toContain('No attempt plan could be generated');
  });

  it('contacts note explains the missing hiring party instead of going empty', () => {
    const input: BriefingInput = {
      fields: {},
      queueRow: { ...baseRow, client_name: null, attorney_name: null },
      isBusiness: false, agentName: '', fullLocation: '1180 E Vine St', docCount: 1,
    };
    const briefing = buildPsoBriefing(input, '2026-06-20T12:00:00Z');
    const contacts = briefing.notes.find((n) => n.author === 'DISPATCH' && n.text.includes('CONTACTS'))!;
    expect(contacts).toBeTruthy();
    expect(contacts.text).toContain('No hiring party on file');
    expect(contacts.text).toContain('DANA WHITFIELD');
  });
});

describe('location-class briefing copy', () => {
  it('does not print residential default windows on a corporate LLC suite job', () => {
    const input: BriefingInput = {
      fields: {
        documents_to_serve: { value: '20 DAY SUMMONS; VERIFIED COMPLAINT', confidence: 1 },
        recipient_county: { value: 'Salt Lake', confidence: 1 },
      },
      queueRow: {
        ...baseRow,
        recipient_name: 'BRISTOL HOSPICE LLC',
        recipient_type: 'business',
        recipient_address: '2005 East 2700 South Suite 200',
        document_type: 'summons',
      },
      isBusiness: true,
      agentName: 'REGISTERED AGENT SOLUTIONS INC',
      fullLocation: '2005 East 2700 South Suite 200, Salt Lake City, UT 84109',
      docCount: 3,
      addressClass: 'corporate',
      addressClassConfirmed: false,
      attemptPlan: [
        { attempt: 1, date: '2026-08-12', weekday: 'Wednesday', window: '09:30-11:30', focus: 'mid-morning', authority: 'corporate default' },
        { attempt: 2, date: '2026-08-12', weekday: 'Wednesday', window: '13:30-16:00', focus: 'afternoon', authority: 'corporate default' },
      ],
    };
    const briefing = buildPsoBriefing(input, '2026-08-12T08:26:06Z');
    const joined = briefing.notes.map((n) => n.text).join('\n');
    expect(joined).toContain('Location type: Corporate / Large Business');
    expect(joined).toContain('corporate default');
    expect(joined).not.toContain('[residential default]');
    expect(joined).not.toContain('evening — highest residential hit rate');
    expect(joined).toContain('Documents to Serve:');
    expect(joined).toContain('1. 20 DAY SUMMONS');
    expect(joined).toContain('CONTRACT DETAILS AND CONTACTS');
    expect(joined).toContain('Ask for the registered agent or a manager by name');
  });
});
