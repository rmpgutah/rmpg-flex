import { describe, it, expect } from 'vitest';
import { synthesizeCaseNarrative } from '../caseNarrative';

const baseInput = {
  plaintiff: 'Capital One, N.A.',
  defendantFirst: 'Daisy',
  defendantMiddle: '',
  defendantLast: 'Doe',
  defendantEntityType: 'individual' as const,
  attorney: { name: 'Heather Valerga', firm: 'Guglielmo & Associates', barNumber: '14431', addressLine1: 'PO Box 41688', addressLine2: 'Tucson, AZ 85717', tel: '(877)325-5700', fax: '', email: 'Utah@guglielmolaw.com' },
  court: 'Third Judicial District Court',
  courtAddress: '450 South State St, Salt Lake City UT 84114',
  county: 'Salt Lake',
  courtCaseNumber: '26CV12345',
  signedDate: 'March 25, 2026',
  responseDeadlineDays: 21,
  documents: 'Summons; Complaint',
  category: 'debt_collection' as const,
  moneyAtStake: '$14,500',
};

describe('synthesizeCaseNarrative', () => {
  it('produces all 5 sections with WHO/WHAT/WHERE/WHEN/WHY headers', () => {
    const r = synthesizeCaseNarrative({
      ...baseInput,
      courtDocket: 'COMPLAINT FOR DAMAGES — Capital One alleges Daisy Doe owes $14,500.',
    });
    expect(r.fullText).toContain('📝 CASE NARRATIVE');
    expect(r.fullText).toContain('▸ WHO');
    expect(r.fullText).toContain('▸ WHAT');
    expect(r.fullText).toContain('▸ WHERE');
    expect(r.fullText).toContain('▸ WHEN');
    expect(r.fullText).toContain('▸ WHY');
  });

  it('WHO section names plaintiff, defendant, counsel with bar #, court', () => {
    const r = synthesizeCaseNarrative({
      ...baseInput,
      courtDocket: 'Test docket',
    });
    expect(r.who).toContain('PLAINTIFF: Capital One');
    expect(r.who).toContain('DEFENDANT BEING SERVED: Daisy Doe');
    expect(r.who).toContain('PLAINTIFF\'S COUNSEL: Heather Valerga');
    expect(r.who).toContain('Guglielmo & Associates');
    expect(r.who).toContain('Bar #14431');
    expect(r.who).toContain('Case No. 26CV12345');
  });

  it('WHEN section pulls "DATED this Nth day of [Month] [YYYY]" filing date and incident date', () => {
    const r = synthesizeCaseNarrative({
      ...baseInput,
      courtDocket: 'On or about February 14, 2026, the defendant breached the agreement. DATED this 25th day of March, 2026.',
    });
    expect(r.when).toContain('March 25, 2026');
    expect(r.when).toContain('February 14, 2026');
    expect(r.when).toContain('21 day(s)');
  });

  it('WHAT section quotes the first allegation extracted from the Complaint', () => {
    const r = synthesizeCaseNarrative({
      ...baseInput,
      courtDocket: 'Plaintiff alleges that Defendant failed to make required payments on a credit-card account from January 2024 through December 2025.',
    });
    expect(r.what).toContain('Allegation excerpt');
    expect(r.what).toContain('failed to make required payments');
  });

  it('WHY section is category-specific (debt collection mentions garnishment)', () => {
    const r = synthesizeCaseNarrative({
      ...baseInput,
      courtDocket: 'FIRST CAUSE OF ACTION\n(BREACH OF CONTRACT)',
      category: 'debt_collection',
    });
    expect(r.why).toMatch(/garnish|levy|seize/i);
    expect(r.why).toContain('breach of contract');
  });

  it('WHERE section includes court address + extracted incident location', () => {
    const r = synthesizeCaseNarrative({
      ...baseInput,
      courtDocket: 'The collision occurred at the property located at 1234 Main Street, suite 5.',
    });
    expect(r.where).toContain('Court of filing: Third Judicial District Court');
    expect(r.where).toContain('Salt Lake County');
    expect(r.where).toContain('1234 Main Street');
  });

  it('lists co-defendants when caption contains them, capped at 6', () => {
    const r = synthesizeCaseNarrative({
      ...baseInput,
      courtDocket: 'JANE DOE, Plaintiff v. ACME CORP; BAR LLC; FOO INC; QUUX HOLDINGS; XYZ COMPANY; PARTY SIX; PARTY SEVEN; SOMEONE ELSE; DOES 1 through 100, inclusive, Defendants.',
    });
    expect(r.who).toContain('CO-DEFENDANTS:');
    expect(r.who).toContain('ACME CORP');
    // Cap at 6
    expect((r.who.match(/CO-DEFENDANTS:.*$/m) || [''])[0].split(';').length).toBeLessThanOrEqual(7);
  });

  it('degrades gracefully when courtDocket is empty', () => {
    const r = synthesizeCaseNarrative({
      ...baseInput,
      courtDocket: '',
    });
    expect(r.fullText).toContain('CASE NARRATIVE');
    expect(r.who).toContain('PLAINTIFF: Capital One');
    // Filing date falls back to signedDate
    expect(r.when).toContain('March 25, 2026');
  });

  it('eviction category produces eviction-specific WHY language', () => {
    const r = synthesizeCaseNarrative({
      ...baseInput,
      courtDocket: 'COMPLAINT FOR UNLAWFUL DETAINER',
      category: 'eviction',
    });
    expect(r.why).toMatch(/possession of the premises|writ of restitution|constable/i);
  });

  it('subpoena category mentions appearance / production', () => {
    const r = synthesizeCaseNarrative({
      ...baseInput,
      courtDocket: 'SUBPOENA DUCES TECUM',
      category: 'subpoena',
    });
    expect(r.why).toMatch(/appear|produce|contempt/i);
  });
});
