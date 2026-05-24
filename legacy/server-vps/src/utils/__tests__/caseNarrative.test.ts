import { describe, it, expect } from 'vitest';
import { synthesizeCaseNarrative, extractAllCausesOfAction } from '../caseNarrative';

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
    expect(r.fullText).toContain('CASE NARRATIVE');
    expect(r.fullText).toContain('WHO:');
    expect(r.fullText).toContain('WHAT:');
    expect(r.fullText).toContain('WHERE:');
    expect(r.fullText).toContain('WHEN:');
    expect(r.fullText).toContain('WHY:');
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
    expect(r.who).toMatch(/CO-DEFENDANTS\s*\(\d+\+?\):/);
    expect(r.who).toContain('ACME CORP');
    // Cap at 6
    expect((r.who.match(/CO-DEFENDANTS\s*\(\d+\+?\):.*$/m) || [''])[0].split(';').length).toBeLessThanOrEqual(7);
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

describe('synthesizeCaseNarrative — enhanced extractions', () => {
  const fixtureDocket = `
SUPERIOR COURT OF THE STATE OF CALIFORNIA, COUNTY OF SAN DIEGO
Case No.: 26CU014094N
COMPLAINT FOR DAMAGES

PARTIES
Plaintiff GILBERTO ROCHA serves as the co-president of the Referees Association.
Defendant JORDAN ALLEN is an individual and manager of the Youth team.

JURISDICTION AND VENUE
This Court has jurisdiction pursuant to California Code of Civil Procedure section 410.10.

FACTUAL ALLEGATIONS
On or about July 21, 2024, at approximately 12:45 p.m., at Surf Sports Park, Plaintiff was
serving as the referee for a soccer match. DORANTES grabbed Plaintiff by the neck and began
choking him. One bystander, Jose Robles, sustained a possible broken finger while trying to
separate the Plaintiff from the mob. Another bystander, Rigoberto Anguino, was struck multiple
times in the head. Plaintiff suffered injuries to his head, side, and legs.

CAUSES OF ACTION
FIRST CAUSE OF ACTION
(Negligence)
SECOND CAUSE OF ACTION
(Assault)
THIRD CAUSE OF ACTION
(Battery)
FOURTH CAUSE OF ACTION
(Intentional Infliction of Emotional Distress)
FIFTH CAUSE OF ACTION
(Negligent Hiring, Supervision, and Retention)

Plaintiff contends DEFENDANTS' conduct amounted to malice, oppression and fraud under
Civil Code section 3294, with a total, willing, and conscious disregard.

PRAYER FOR RELIEF
WHEREFORE, Plaintiff prays as follows:
1. For general damages in an amount within the jurisdiction of this court;
2. For special damages, according to proof;
3. For any prejudgment interest according to law;
4. For costs of suit;
5. Punitive and exemplary damages, in a sum sufficient to punish and deter said Defendants;
6. Any other and further relief that the Court considers proper.

DATED: March 11, 2026

DEMAND FOR JURY TRIAL
Plaintiff hereby demands trial by jury.
`;

  const enhInput = {
    ...{
      plaintiff: 'Gilberto Rocha',
      defendantFirst: 'Jordan',
      defendantMiddle: '',
      defendantLast: 'Allen',
      defendantEntityType: 'individual' as const,
      attorney: { name: 'Bradley G. Hayes', firm: 'The Hayes Law Firm, APC', barNumber: '287552', addressLine1: '2648 Durfee Ave., Ste. 101', addressLine2: 'El Monte, CA 91732', tel: '(323) 477-1415', fax: '', email: 'e-service@thehayeslawfirmapc.com' },
      court: 'Superior Court of California, County of San Diego',
      courtAddress: '325 South Melrose Drive, Vista, CA 92081',
      county: 'San Diego',
      courtCaseNumber: '26CU014094N',
      signedDate: 'March 11, 2026',
      responseDeadlineDays: 30,
      documents: 'Summons; Complaint; CCCS',
      category: 'civil_suit_general' as const,
      moneyAtStake: null,
    },
    courtDocket: fixtureDocket,
  };

  it('extracts all 5 causes of action and lists them in WHAT', () => {
    const r = synthesizeCaseNarrative(enhInput);
    expect(r.what).toContain('5 causes of action');
    expect(r.what).toMatch(/NEGLIGENCE/i);
    expect(r.what).toMatch(/ASSAULT/i);
    expect(r.what).toMatch(/BATTERY/i);
    expect(r.what).toMatch(/INTENTIONAL INFLICTION OF EMOTIONAL DISTRESS/i);
    expect(r.what).toMatch(/NEGLIGENT HIRING/i);
  });

  it('extracts plaintiff role and defendant pleaded role', () => {
    const r = synthesizeCaseNarrative(enhInput);
    expect(r.who).toMatch(/co-president of the Referees Association/i);
    expect(r.who).toMatch(/manager of the Youth team/i);
  });

  it('lists witnesses/bystanders named in the Complaint', () => {
    const r = synthesizeCaseNarrative(enhInput);
    expect(r.who).toContain('Jose Robles');
    expect(r.who).toContain('Rigoberto Anguino');
  });

  it('includes the operative facts block from the Factual Allegations section', () => {
    const r = synthesizeCaseNarrative(enhInput);
    expect(r.what).toMatch(/Operative facts/i);
    expect(r.what).toMatch(/July 21, 2024/);
    expect(r.what).toMatch(/Surf Sports Park/);
  });

  it('extracts injuries when "injuries to his head, side, and legs" appears', () => {
    const r = synthesizeCaseNarrative(enhInput);
    expect(r.what).toMatch(/Injuries.*head|head.*side|legs/i);
  });

  it('extracts statutory citations (Civil Code §, CCP §)', () => {
    const r = synthesizeCaseNarrative(enhInput);
    // Output preserves literal docket spelling: "section" word OR § symbol both accepted.
    expect(r.what).toMatch(/Civil Code\s+(?:§|section)\s*3294/i);
    expect(r.what).toMatch(/Code of Civil Procedure\s+(?:§|section)\s*410\.10/i);
  });

  it('flags VERIFIED, JURY, and PUNITIVE damages when present', () => {
    const r = synthesizeCaseNarrative(enhInput);
    expect(r.what).toMatch(/JURY TRIAL DEMANDED/);
    expect(r.what).toMatch(/PUNITIVE DAMAGES PRAYED/);
    expect(r.why).toMatch(/PUNITIVE DAMAGES/);
  });

  it('extracts numbered prayer-for-relief items', () => {
    const r = synthesizeCaseNarrative(enhInput);
    expect(r.what).toMatch(/Plaintiff prays for:/);
    expect(r.what).toMatch(/general damages/i);
    expect(r.what).toMatch(/punitive/i);
  });

  it('computes statute-of-limitations age (~1.6 years here, flags >600 days)', () => {
    const r = synthesizeCaseNarrative(enhInput);
    expect(r.when).toMatch(/Time from incident to filing/);
    expect(r.when).toMatch(/approaching typical 2-year personal-injury statute/);
  });

  it('WHY section names the defendant\'s specific role from the Complaint', () => {
    const r = synthesizeCaseNarrative(enhInput);
    expect(r.why).toMatch(/Jordan\s+Allen/);
    expect(r.why).toMatch(/manager of the Youth team/i);
  });
});

describe('extractAllCausesOfAction', () => {
  it('returns ordered list of all CAUSE OF ACTION headers', () => {
    const text = `
FIRST CAUSE OF ACTION
(Negligence)
SECOND CAUSE OF ACTION
(Breach of Contract)
THIRD CAUSE OF ACTION
(Conversion)
`;
    expect(extractAllCausesOfAction(text)).toEqual(['Negligence', 'Breach of Contract', 'Conversion']);
  });

  it('falls back to COUNT I/II/III pattern', () => {
    const text = `
COUNT I (Fraud)
COUNT II (Breach of Fiduciary Duty)
`;
    const result = extractAllCausesOfAction(text);
    expect(result).toContain('Fraud');
    expect(result).toContain('Breach of Fiduciary Duty');
  });

  it('returns empty array when no causes of action found', () => {
    expect(extractAllCausesOfAction('Some random text with no causes')).toEqual([]);
  });
});
