import { describe, it, expect } from 'vitest';
import {
  arbitrateFields,
  reconcileIdentityConflicts,
  type DocCandidate,
  type FieldConflict,
} from '../src/utils/serveIntakeArbitrate';
import { normalizeFields } from '../src/utils/serveIntakeExtract';

const f = (value: string, confidence = 0.9) => ({ value, confidence });

const IDENTITY_GROUP = [
  'recipient_type', 'recipient_first_name', 'recipient_middle_name',
  'recipient_last_name', 'recipient_business_name', 'recipient_dob',
] as const;

describe('arbitrateFields', () => {
  it('prefers the Information Form for service mechanics', () => {
    const r = arbitrateFields([
      { docType: 'field_sheet', fields: { service_instructions: f('OLD TEXT') } },
      { docType: 'info_page', fields: { service_instructions: f('NEW TEXT') } },
    ]);
    expect(r.merged.service_instructions.value).toBe('NEW TEXT');
  });

  it('prefers the Court Docket for the case caption', () => {
    const r = arbitrateFields([
      { docType: 'info_page', fields: { case_number: f('GUESS-1') } },
      { docType: 'court_filing', fields: { case_number: f('900904528') } },
    ]);
    expect(r.merged.case_number.value).toBe('900904528');
  });

  it('records the rejected candidate so the review UI can offer it', () => {
    const r = arbitrateFields([
      { docType: 'field_sheet', fields: { recipient_phone: f('4359861200') } },
      { docType: 'info_page', fields: { recipient_phone: f('8015551234') } },
    ]);
    const conflict = r.conflicts.find((c) => c.field === 'recipient_phone');
    expect(conflict?.chosen).toBe('8015551234');
    expect(conflict?.rejected.map((x) => x.value)).toContain('4359861200');
  });

  it('does not report a conflict when documents agree', () => {
    const r = arbitrateFields([
      { docType: 'field_sheet', fields: { recipient_state: f('UT') } },
      { docType: 'info_page', fields: { recipient_state: f('UT') } },
    ]);
    expect(r.conflicts).toHaveLength(0);
  });

  it('falls back to the highest-confidence value when no source outranks another', () => {
    const r = arbitrateFields([
      { docType: 'other', fields: { plaintiff: f('LOW', 0.2) } },
      { docType: 'other', fields: { plaintiff: f('HIGH', 0.95) } },
    ]);
    expect(r.merged.plaintiff.value).toBe('HIGH');
  });

  it('ignores empty candidates entirely', () => {
    const r = arbitrateFields([
      { docType: 'info_page', fields: { case_number: f('', 0) } },
      { docType: 'court_filing', fields: { case_number: f('900904528') } },
    ]);
    expect(r.merged.case_number.value).toBe('900904528');
    expect(r.conflicts).toHaveLength(0);
  });
});

describe('reconcileIdentityConflicts', () => {
  // recipient_last_name is not a caption field, so arbitrateFields() ranks
  // it by MECHANICS_RANK (info_page beats court_filing) — the guard in
  // serveIntake.ts can pick a different document ("strongest recipient
  // signal") than arbitration did, which is exactly the case this
  // reconciliation exists to keep in sync.
  const docCandidates: DocCandidate[] = [
    { docType: 'info_page', fields: { recipient_last_name: f('SMITH') } },
    { docType: 'court_filing', fields: { recipient_last_name: f('SMYTHE') } },
  ];

  it('overrides an arbitrated identity field: conflicts.chosen matches the final value, and the previously-chosen value appears in rejected', () => {
    const arbitration = arbitrateFields(docCandidates);
    expect(arbitration.merged.recipient_last_name.value).toBe('SMITH'); // arbitration's own pick

    // The guard decided court_filing has the strongest recipient signal.
    const winnerDoc = { documentType: 'court_filing', fields: { recipient_last_name: f('SMYTHE') } };
    const merged = { ...arbitration.merged };
    const conflicts = reconcileIdentityConflicts(
      arbitration.conflicts, merged, docCandidates, winnerDoc, IDENTITY_GROUP,
    );

    expect(merged.recipient_last_name.value).toBe('SMYTHE');
    const conflict = conflicts.find((c) => c.field === 'recipient_last_name');
    expect(conflict?.chosen).toBe('SMYTHE');
    expect(conflict?.chosenSource).toBe('court_filing');
    expect(conflict?.rejected.map((r) => r.value)).toContain('SMITH');
  });

  it('leaves a field alone (single-source behavior preserved) when the guard doc supplied no value for it', () => {
    const singleSourceCandidates: DocCandidate[] = [
      { docType: 'info_page', fields: { recipient_first_name: f('JANE') } },
    ];
    const merged: Record<string, ReturnType<typeof f>> = { recipient_first_name: f('JANE') };
    const initialConflicts: FieldConflict[] = [];
    // winnerDoc has no recipient_first_name at all.
    const winnerDoc = { documentType: 'court_filing', fields: {} };

    const conflicts = reconcileIdentityConflicts(
      initialConflicts, merged, singleSourceCandidates, winnerDoc, IDENTITY_GROUP,
    );

    expect(merged.recipient_first_name.value).toBe('JANE'); // untouched
    expect(conflicts).toHaveLength(0);
  });

  it('emits no conflict entry when all documents agree after the override', () => {
    const agreeingCandidates: DocCandidate[] = [
      { docType: 'info_page', fields: { recipient_last_name: f('SMITH') } },
      { docType: 'court_filing', fields: { recipient_last_name: f('SMITH') } },
    ];
    const merged = { recipient_last_name: f('SMITH') };
    const winnerDoc = { documentType: 'court_filing', fields: { recipient_last_name: f('SMITH') } };

    const conflicts = reconcileIdentityConflicts(
      [{ field: 'recipient_last_name', chosen: 'STALE', chosenSource: 'other', rejected: [] }],
      merged, agreeingCandidates, winnerDoc, IDENTITY_GROUP,
    );

    expect(conflicts.find((c) => c.field === 'recipient_last_name')).toBeUndefined();
  });

  it('never touches a non-identity field conflict record', () => {
    const nonIdentityConflict: FieldConflict = {
      field: 'case_number', chosen: '900904528', chosenSource: 'court_filing',
      rejected: [{ value: 'GUESS-1', source: 'info_page' }],
    };
    const merged = { recipient_last_name: f('SMITH') };
    const winnerDoc = { documentType: 'court_filing', fields: { recipient_last_name: f('SMYTHE') } };

    const conflicts = reconcileIdentityConflicts(
      [nonIdentityConflict], merged, docCandidates, winnerDoc, IDENTITY_GROUP,
    );

    const preserved = conflicts.find((c) => c.field === 'case_number');
    expect(preserved).toEqual(nonIdentityConflict);
  });

  it('does not list the winning value in its own rejected entries when it carries incidental whitespace (regression: dedup seed must be trimmed like the comparison side)', () => {
    const whitespaceCandidates: DocCandidate[] = [
      { docType: 'info_page', fields: { recipient_last_name: f('  SMITH  ') } },
      { docType: 'court_filing', fields: { recipient_last_name: f('SMITH') } },
    ];
    const merged = { recipient_last_name: f('SMITH') };
    // Winning value has surrounding whitespace, as an OCR/model artifact would.
    const winnerDoc = { documentType: 'info_page', fields: { recipient_last_name: f('  SMITH  ') } };

    const conflicts = reconcileIdentityConflicts(
      [], merged, whitespaceCandidates, winnerDoc, IDENTITY_GROUP,
    );

    const conflict = conflicts.find((c) => c.field === 'recipient_last_name');
    // Both documents genuinely agree (once trimmed) — no conflict should
    // exist at all, and in particular the winner's own value must never
    // appear in `rejected`.
    expect(conflict).toBeUndefined();
  });
});

// ============================================================
// Doc-family normalization (R1) — the model classifies the LEAD
// document, not the packet family. "Court Docket.pdf" is reasonably
// classified 'subpoena', which is not one of the three names the rank
// tables carry. Before normalization that fell to rank 0 and LOST the
// caption fields to the field sheet — whose Case/Court cells are the
// known-blank, watermark-corrupted ones. That is the exact inversion
// arbitration exists to prevent, firing on the modal packet.
// ============================================================
describe('arbitrateFields — court-form enum members rank as court_filing', () => {
  const CAPTION_FIELDS = ['case_number', 'court_name', 'plaintiff', 'defendant'] as const;

  for (const specific of ['subpoena', 'summons', 'complaint', 'affidavit', 'eviction', 'restraining_order']) {
    it(`a docket classified '${specific}' still outranks a field sheet for caption fields`, () => {
      const candidates: DocCandidate[] = [
        {
          docType: 'field_sheet',
          fields: {
            case_number: f('WATERMARK JUNK', 0.95),
            court_name: f('WRONG COURT', 0.95),
            plaintiff: f('WRONG PLAINTIFF', 0.95),
            defendant: f('WRONG DEFENDANT', 0.95),
          },
        },
        {
          docType: specific,
          fields: {
            case_number: f('240901234', 0.5),
            court_name: f('Third Judicial District Court, State of Utah - Matheson', 0.5),
            plaintiff: f('Sample Bank, N.A.', 0.5),
            defendant: f('John Q Sample', 0.5),
          },
        },
      ];
      const r = arbitrateFields(candidates);
      // Note the confidences are deliberately INVERTED against the desired
      // outcome: source precedence must beat the field sheet's (optimistic,
      // self-reported) 0.95, or this passes for the wrong reason.
      expect(r.merged.case_number.value).toBe('240901234');
      expect(r.merged.court_name.value).toBe('Third Judicial District Court, State of Utah - Matheson');
      expect(r.merged.plaintiff.value).toBe('Sample Bank, N.A.');
      expect(r.merged.defendant.value).toBe('John Q Sample');
      for (const field of CAPTION_FIELDS) {
        expect(r.conflicts.find((c) => c.field === field)?.chosenSource).toBe(specific);
      }
    });
  }

  it('does NOT promote a non-court-form enum member to court_filing', () => {
    // 'correspondence' has no claim on the caption; the field sheet (rank 1)
    // must still beat it (rank 0). Guards against a blanket "anything
    // unknown is a court filing" over-correction.
    const r = arbitrateFields([
      { docType: 'field_sheet', fields: { case_number: f('FS-1', 0.2) } },
      { docType: 'correspondence', fields: { case_number: f('CORR-1', 0.99) } },
    ]);
    expect(r.merged.case_number.value).toBe('FS-1');
  });

  it('leaves service mechanics with the Information Form even against a court form', () => {
    const r = arbitrateFields([
      { docType: 'subpoena', fields: { service_instructions: f('FROM THE SUBPOENA', 0.99) } },
      { docType: 'info_page', fields: { service_instructions: f('FROM THE INFO FORM', 0.1) } },
    ]);
    expect(r.merged.service_instructions.value).toBe('FROM THE INFO FORM');
  });

  it('the filename-derived family beats a WRONG model classification', () => {
    // What the route now supplies: docType comes from familyFromFileName
    // ("Court Docket.pdf" → 'court_filing') even though this document's
    // model classification was the wrong family entirely. Passing the
    // filename family is what makes the caption resolve correctly.
    const modelSaidFieldSheet = arbitrateFields([
      { docType: 'field_sheet', fields: { case_number: f('BLANK-ISH JUNK', 0.95) } },
      { docType: 'field_sheet', fields: { case_number: f('240901234', 0.5) } },
    ]);
    // Both at the same rank → confidence decides, and the junk wins.
    expect(modelSaidFieldSheet.merged.case_number.value).toBe('BLANK-ISH JUNK');

    const filenameFamily = arbitrateFields([
      { docType: 'field_sheet', fields: { case_number: f('BLANK-ISH JUNK', 0.95) } },
      { docType: 'court_filing', fields: { case_number: f('240901234', 0.5) } },
    ]);
    expect(filenameFamily.merged.case_number.value).toBe('240901234');
  });
});

describe('conflicts reflect POST-normalization values', () => {
  it('chosen matches what would actually be committed', () => {
    // Two documents disagree on the deadline, in different date formats.
    // The values differ, so a conflict IS produced — assert on it
    // unconditionally. A conditional assertion here would silently pass
    // if arbitration stopped recording the conflict at all, which is
    // exactly the regression this test exists to catch.
    const a = { docType: 'field_sheet', fields: normalizeFields({ service_deadline: { value: '6/26/2026', confidence: 0.8 } } as any) };
    const b = { docType: 'info_page', fields: normalizeFields({ service_deadline: { value: '6/30/2026', confidence: 0.9 } } as any) };
    const r = arbitrateFields([a, b]);

    // info_page outranks field_sheet for service mechanics, so it wins.
    expect(r.merged.service_deadline.value).toBe('2026-06-30');

    const c = r.conflicts.find((x) => x.field === 'service_deadline');
    expect(c).toBeDefined();
    // `chosen` must be the ISO form that lands in the DB — not the raw
    // model string, which is what PR 4's resolver would otherwise show.
    expect(c!.chosen).toBe('2026-06-30');
    expect(c!.rejected.map((x) => x.value)).toContain('2026-06-26');
  });
});

describe('reconcileIdentityConflicts — the name-coherence guard must also see normalized values', () => {
  it('an identity field the guard overrides persists the NORMALIZED (committed) form, not raw model output', () => {
    // Raw model output for two documents that disagree on the recipient's
    // DOB, in the same M/D/YYYY shape the extractor actually returns.
    const rawCandidates = [
      { docType: 'field_sheet', fields: { recipient_last_name: f('SMITH'), recipient_dob: f('6/26/1980') } },
      { docType: 'court_filing', fields: { recipient_last_name: f('SMYTHE', 0.95), recipient_dob: f('6/30/1980', 0.95) } },
    ];
    // Mirrors src/routes/serveIntake.ts's `docCandidates`: every candidate
    // is normalized BEFORE arbitration and BEFORE the name-coherence guard
    // ever sees it — this is what the guard's `winnerDoc` must be built
    // from too, not the raw `rawCandidates` above.
    const docCandidates: DocCandidate[] = rawCandidates.map((c) => ({
      docType: c.docType,
      fields: normalizeFields(c.fields),
    }));
    const arbitration = arbitrateFields(docCandidates);

    // The guard decided court_filing has the strongest recipient signal
    // (higher confidence on both name-defining fields) and selects the
    // WHOLE identity group from it — mirroring serveIntake.ts's `bestDoc`,
    // which is now built from the already-normalized `docCandidates`
    // entry (index 1), not from raw `rawCandidates[1].fields`.
    const winnerDoc = { documentType: 'court_filing', fields: docCandidates[1].fields };
    const merged = { ...arbitration.merged };
    const conflicts = reconcileIdentityConflicts(
      arbitration.conflicts, merged, docCandidates, winnerDoc, IDENTITY_GROUP,
    );

    const conflict = conflicts.find((x) => x.field === 'recipient_dob');
    expect(conflict).toBeDefined();
    // Must be the normalized ISO form finalizeFields will (idempotently)
    // commit downstream — not the raw "6/30/1980" the model produced.
    // Regression source: serveIntake.ts previously built `bestDoc` (the
    // winnerDoc feeding this function) from raw c2.ex fields instead of
    // the normalized docCandidates, so `chosen` here would read the raw
    // string while the actual committed row held the ISO date.
    expect(conflict!.chosen).toBe('1980-06-30');
    expect(conflict!.rejected.map((x) => x.value)).toContain('1980-06-26');
    expect(merged.recipient_dob.value).toBe('1980-06-30');
  });
});
