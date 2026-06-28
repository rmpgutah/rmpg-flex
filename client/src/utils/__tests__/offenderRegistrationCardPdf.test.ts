import { describe, it, expect } from 'vitest';
import {
  formatSubjectName,
  formatAddress,
  classificationBanner,
  wrapText,
  generateOffenderRegistrationCardPdf,
  type OffenderPdfInput,
} from '../offenderRegistrationCardPdf';

describe('formatSubjectName', () => {
  it('renders LAST, FIRST MIDDLE with last name upper-cased', () => {
    expect(
      formatSubjectName({ lastName: 'Doe', firstName: 'John', middleName: 'A' }),
    ).toBe('DOE, John A');
  });
  it('omits middle name when blank', () => {
    expect(formatSubjectName({ lastName: 'Doe', firstName: 'John' })).toBe('DOE, John');
  });
  it('returns just the last name when no first/middle', () => {
    expect(formatSubjectName({ lastName: 'Doe' })).toBe('DOE');
  });
  it('returns em-dash when no name parts are present', () => {
    expect(formatSubjectName({})).toBe('—');
  });
  it('trims whitespace on inputs', () => {
    expect(
      formatSubjectName({ lastName: '  Doe ', firstName: 'John ', middleName: '' }),
    ).toBe('DOE, John');
  });
});

describe('formatAddress', () => {
  it('joins address, city, "STATE ZIP"', () => {
    expect(
      formatAddress({ address: '123 Main', city: 'SLC', state: 'UT', zip: '84101' }),
    ).toBe('123 Main, SLC, UT 84101');
  });
  it('omits empty components', () => {
    expect(formatAddress({ address: '123 Main', state: 'UT' })).toBe('123 Main, UT');
  });
  it('returns em-dash when every component is blank', () => {
    expect(formatAddress({})).toBe('—');
    expect(formatAddress({ address: '', city: '', state: '' })).toBe('—');
  });
  it('handles zip-only / state-only as a single component', () => {
    expect(formatAddress({ state: 'UT', zip: '84101' })).toBe('UT 84101');
    expect(formatAddress({ zip: '84101' })).toBe('84101');
  });
});

describe('classificationBanner', () => {
  it('returns the red CONFIRMED banner for confirmed', () => {
    const b = classificationBanner('confirmed');
    expect(b.label).toMatch(/CONFIRMED/);
    expect(b.fg.toLowerCase()).toBe('#b91c1c');
  });
  it('returns the amber POSSIBLE banner for possible', () => {
    const b = classificationBanner('possible');
    expect(b.label).toMatch(/POSSIBLE/);
    expect(b.label).toMatch(/REVIEW/);
  });
  it('returns the grey EXCLUDED banner for excluded', () => {
    const b = classificationBanner('excluded');
    expect(b.label).toMatch(/EXCLUDED/);
  });
  it('falls back to a neutral OFFENDER RECORD banner for null/unknown', () => {
    expect(classificationBanner(null).label).toBe('OFFENDER RECORD');
    expect(classificationBanner(undefined as any).label).toBe('OFFENDER RECORD');
  });
});

describe('wrapText', () => {
  it('returns [""] for empty input', () => {
    expect(wrapText('', 40)).toEqual(['']);
  });
  it('keeps short text on a single line', () => {
    expect(wrapText('Hello world', 40)).toEqual(['Hello world']);
  });
  it('wraps long text without splitting words', () => {
    const lines = wrapText('one two three four five six', 10);
    // Each line should be ≤ 10 chars and no word should be split.
    lines.forEach((l) => expect(l.length).toBeLessThanOrEqual(10));
    expect(lines.join(' ')).toBe('one two three four five six');
  });
  it('preserves explicit line breaks', () => {
    expect(wrapText('A\nB', 40)).toEqual(['A', 'B']);
  });
});

describe('generateOffenderRegistrationCardPdf', () => {
  // jsPDF is a real library that runs in jsdom — these are smoke tests that
  // confirm the generator doesn't throw on the common shapes the panel hands
  // it. The actual visual layout is verified by the operator opening the PDF.
  const baseOffender: OffenderPdfInput['offender'] = {
    nsopwOffenderId: 'UT-12345',
    jurisdiction: 'UT',
    jurisdictionLabel: 'Utah BCI',
    firstName: 'John',
    middleName: 'A',
    lastName: 'Doe',
    dateOfBirth: '1985-06-12',
    sex: 'M',
    address: '123 Main St',
    city: 'Salt Lake City',
    state: 'UT',
    zip: '84101',
    offense: 'Sexual abuse of a child (3rd degree felony)',
    riskLevel: 'High',
    tier: 3,
    registrationStatus: 'compliant',
    detailUrl: 'https://example.test/offender/12345',
    rowId: 42,
    personId: 1001,
    linkedProperties: [
      { propertyId: 7, locationType: 'RESIDENCE', locationName: null },
      { propertyId: 8, locationType: 'WORK', locationName: 'ACME Co.' },
    ],
  };
  const input: OffenderPdfInput = {
    offender: baseOffender,
    classification: 'confirmed',
    score: 0.97,
    matchedFields: ['surname', 'forename', 'dob'],
    reason: 'name + DOB exact match',
    preparedBy: 'Officer Z. Test',
    queryContext: { surname: 'Doe', forename: 'John', dob: '1985-06-12' },
  };

  it('produces a jsPDF document with at least one page', () => {
    const doc = generateOffenderRegistrationCardPdf(input);
    expect(doc).toBeTruthy();
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('does not throw when classification / score / reason are absent', () => {
    expect(() => generateOffenderRegistrationCardPdf({ offender: baseOffender })).not.toThrow();
  });

  it('does not throw when every offender field is null/empty', () => {
    const empty: OffenderPdfInput = {
      offender: {
        firstName: null, lastName: null, dateOfBirth: null, sex: null,
        address: null, city: null, state: null, zip: null,
        offense: null, registrationStatus: null,
      },
    };
    expect(() => generateOffenderRegistrationCardPdf(empty)).not.toThrow();
  });

  it('does not throw when photoDataUrl is a broken data URL (falls back to placeholder)', () => {
    expect(() => generateOffenderRegistrationCardPdf({
      ...input,
      photoDataUrl: 'data:image/png;base64,not-real-bytes',
    })).not.toThrow();
  });
});
