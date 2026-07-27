import { describe, it, expect } from 'vitest';
import {
  clientWindowText, assessOfficerSafety, buildPsoBriefing, recipientPartyStatus,
} from '../src/utils/serveIntakeBriefing';
import type { BriefingInput } from '../src/utils/serveIntakeBriefing';
import { computeScheduleImpossible } from '../src/utils/serveIntakeRecords';

const baseRow = {
  recipient_name: 'DANA WHITFIELD', recipient_address: '1180 E VINE ST',
  recipient_city: 'SALT LAKE CITY', recipient_state: 'UT', recipient_zip: '84121',
  document_type: 'subpoena', case_number: '900904528', court_name: 'THIRD DISTRICT',
  jurisdiction: 'UT', client_name: 'ICU', attorney_name: null,
  priority: 'rush' as const, deadline: '2026-06-30', service_instructions: null,
  notes: null, plaintiff: 'AVERY HOLT', defendant: 'NORTHGATE LOGISTICS, LLC',
  court_date: null,
};

// Builds a minimal BriefingInput around a queueRow override, and returns the
// text of the INTAKE note (the structured briefing body) so fix-round-1
// regression tests can assert on what the officer actually reads.
function intakeNoteText(queueRowOverrides: Partial<typeof baseRow>): string {
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
