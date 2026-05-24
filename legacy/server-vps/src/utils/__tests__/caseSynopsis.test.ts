import { describe, it, expect } from 'vitest';
import { synthesizeCaseSynopsis } from '../caseSynopsis';

const baseInput = {
  plaintiff: 'Capital One, N.A.',
  defendantFirst: 'Daisy',
  defendantLast: 'Doe',
  primaryDoc: 'SUMMONS',
  documents: 'Summons; Complaint',
  responseDeadlineDays: 21,
  court: 'Third Judicial District Court',
};

describe('synthesizeCaseSynopsis', () => {
  it('classifies a debt-collection lawsuit and extracts amount in controversy', () => {
    const r = synthesizeCaseSynopsis({
      ...baseInput,
      courtDocket: 'COMPLAINT FOR DAMAGES — Capital One alleges Daisy Doe owes $14,500.00 on a credit card account.',
    });
    expect(r.category).toBe('debt_collection');
    expect(r.moneyAtStake).toBe('$14,500');
    expect(r.oneLineSummary).toContain('Capital One');
    expect(r.oneLineSummary).toContain('Daisy Doe');
    expect(r.oneLineSummary).toContain('debt-collection');
    expect(r.fullText).toContain('WHAT YOU ARE SERVING');
    expect(r.fullText).toContain('WHAT THIS MEANS FOR THE DEFENDANT');
    expect(r.fullText).toContain('AMOUNT IN CONTROVERSY');
  });

  it('classifies eviction (unlawful detainer) with high-urgency line', () => {
    const r = synthesizeCaseSynopsis({
      ...baseInput,
      courtDocket: 'COMPLAINT FOR UNLAWFUL DETAINER — Plaintiff seeks possession of premises.',
      documents: 'Eviction summons; Unlawful detainer complaint',
    });
    expect(r.category).toBe('eviction');
    expect(r.urgencyLine).toContain('HIGH URGENCY');
    expect(r.defendantAction).toContain('writ of restitution');
  });

  it('classifies subpoena with appearance/production action', () => {
    const r = synthesizeCaseSynopsis({
      ...baseInput,
      courtDocket: 'SUBPOENA DUCES TECUM — You are commanded to appear and produce documents.',
      documents: 'Subpoena',
    });
    expect(r.category).toBe('subpoena');
    expect(r.defendantAction).toContain('appear');
    expect(r.urgencyLine).toContain('TIME-BOUND');
  });

  it('classifies divorce / dissolution', () => {
    const r = synthesizeCaseSynopsis({
      ...baseInput,
      courtDocket: 'PETITION FOR DISSOLUTION OF MARRIAGE',
      documents: 'Divorce petition; Summons',
    });
    expect(r.category).toBe('divorce_family');
    expect(r.oneLineSummary).toContain('divorce');
  });

  it('classifies protective order with immediate-effect action', () => {
    const r = synthesizeCaseSynopsis({
      ...baseInput,
      courtDocket: 'TEMPORARY PROTECTIVE ORDER ISSUED AGAINST RESPONDENT',
      documents: 'Protective order',
    });
    expect(r.category).toBe('protective_order');
    expect(r.defendantAction).toMatch(/immediately|criminal/i);
  });

  it('returns unknown gracefully when no patterns match', () => {
    const r = synthesizeCaseSynopsis({
      ...baseInput,
      courtDocket: 'A document containing no recognizable case-type keywords.',
      documents: 'Mystery doc',
    });
    expect(r.category).toBe('unknown');
    expect(r.fullText).toContain('refer to court docket');
  });

  it('ignores trivial dollar amounts under $50 (filing fees, postage)', () => {
    const r = synthesizeCaseSynopsis({
      ...baseInput,
      courtDocket: 'Filing fee $35.00 paid. Service fee $25.',
    });
    expect(r.moneyAtStake).toBeNull();
  });

  it('picks the largest dollar amount when multiple are present', () => {
    const r = synthesizeCaseSynopsis({
      ...baseInput,
      courtDocket: 'Damages of $1,250 sought, plus $25,750.50 in punitive damages, plus $35 filing fee.',
    });
    expect(r.moneyAtStake).toBe('$25,750.50');
  });

  it('produces full text with all four sections', () => {
    const r = synthesizeCaseSynopsis({
      ...baseInput,
      courtDocket: 'Breach of contract claim for $5,000.',
    });
    expect(r.fullText).toContain('WHAT YOU ARE SERVING');
    expect(r.fullText).toContain('WHAT THIS MEANS FOR THE DEFENDANT');
    expect(r.fullText).toContain('AMOUNT IN CONTROVERSY');
    expect(r.fullText).toMatch(/HIGH URGENCY|SHORT WINDOW|STANDARD WINDOW|TIME-BOUND/);
  });
});
