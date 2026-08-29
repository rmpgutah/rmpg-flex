// Client mirror of the Acknowledgement of Service variant rules.
//
// The worker owns the authoritative copy (src/routes/serveReceipt.ts,
// tested in tests/serveReceipt.test.ts). This suite pins the client
// mirror so the two cannot drift apart silently — a drift would show
// the signer one set of statements and store a different variant.

import { describe, it, expect } from 'vitest';
import {
  resolveReceiptVariant, receiptFormTitle, attestationsFor, isEntityName, formatServiceAddress, VARIANT_LABEL,
  type ReceiptVariant,
} from '../serveReceiptVariant';

const ALL: ReceiptVariant[] = ['individual', 'co_habitant', 'business', 'substitute'];

describe('resolveReceiptVariant', () => {
  it('short-circuits to individual for the named party', () => {
    expect(resolveReceiptVariant({
      isNamedParty: true, premisesType: 'business',
      residesAtAddress: true, authorizedAgent: true,
    })).toBe('individual');
  });

  it('resolves business from premises OR agent authority', () => {
    expect(resolveReceiptVariant({
      isNamedParty: false, premisesType: 'business',
      residesAtAddress: false, authorizedAgent: false,
    })).toBe('business');
    expect(resolveReceiptVariant({
      isNamedParty: false, premisesType: 'residence',
      residesAtAddress: false, authorizedAgent: true,
    })).toBe('business');
  });

  it('resolves co_habitant only when residency is the sole claim', () => {
    expect(resolveReceiptVariant({
      isNamedParty: false, premisesType: 'residence',
      residesAtAddress: true, authorizedAgent: false,
    })).toBe('co_habitant');
  });

  it('falls through to substitute with no claim at all', () => {
    expect(resolveReceiptVariant({
      isNamedParty: false, premisesType: 'other',
      residesAtAddress: false, authorizedAgent: false,
    })).toBe('substitute');
  });
});

describe('receiptFormTitle', () => {
  it('produces the four printed titles', () => {
    expect(ALL.map(receiptFormTitle)).toEqual([
      'Acknowledgement of Service Form (Individual)',
      'Acknowledgement of Service Form (Co-Habitant)',
      'Acknowledgement of Service Form (Business)',
      'Acknowledgement of Service Form (Substitute Service)',
    ]);
  });

  it('labels every variant', () => {
    for (const v of ALL) expect(VARIANT_LABEL[v]).toBeTruthy();
  });
});

describe('attestationsFor', () => {
  it('gives every variant the adult, receipt and truthfulness statements', () => {
    for (const v of ALL) {
      const ids = attestationsFor(v, 'John Roe').map((a) => a.id);
      expect(ids).toContain('adult');
      expect(ids).toContain('received');
      expect(ids).toContain('truthful');
    }
  });

  it('uses the exact adult wording the operator specified', () => {
    const adult = attestationsFor('individual', 'John Roe').find((a) => a.id === 'adult');
    expect(adult?.text).toBe('I am an adult over the age of eighteen.');
  });

  it('uses the exact authority wording on co-habitant and business', () => {
    const expected =
      'I am a resident, or employee of the current address for service, and am '
      + 'authorized to accept service, on behalf of the individual, or business in question.';
    for (const v of ['co_habitant', 'business'] as ReceiptVariant[]) {
      expect(attestationsFor(v, 'John Roe').find((a) => a.id === 'authority')?.text).toBe(expected);
    }
  });

  it('omits the authority statement where it could not truthfully be made', () => {
    // Individual: affirming you are authorized to accept on behalf of
    // yourself is nonsense. Substitute: by construction the signer
    // neither resides nor works at the address.
    for (const v of ['individual', 'substitute'] as ReceiptVariant[]) {
      expect(attestationsFor(v, 'John Roe').map((a) => a.id)).not.toContain('authority');
    }
  });

  it('names the party in the acceptance statement', () => {
    const a = attestationsFor('business', 'Acme LLC').find((x) => x.id === 'acceptance');
    expect(a?.text).toContain('accepting on behalf of Acme LLC');
    expect(a?.text).toContain('accept any control moving forwards from this interaction');
  });

  it('never asks the named party to accept on their own behalf', () => {
    const ids = attestationsFor('individual', 'John Roe').map((a) => a.id);
    expect(ids).not.toContain('acceptance');
    expect(ids).not.toContain('deliver');
  });

  it('falls back to a neutral label when no party is known', () => {
    expect(attestationsFor('substitute', '').find((a) => a.id === 'acceptance')?.text)
      .toContain('the named party');
  });

  it('marks only the optional explanation statement as non-required', () => {
    const optional = attestationsFor('co_habitant', 'John Roe').filter((a) => !a.required);
    expect(optional.map((a) => a.id)).toEqual(['explained']);
  });
});

describe('isEntityName', () => {
  // From a real service on 2026-07-27: a registered agent answered "yes, I
  // am the named party" for a list of LLCs, and the form printed his
  // capacity as "PARTY NAMED". The question is now withheld for an entity.
  it.each([
    'Chase Partners Ltd, Fontana Business Center 2, SDP REIT LLC, ISAOA',
    'KPRS Construction Services, LLC',
    'Acme Inc.',
    'Zions Bank',
    'The Smith Family Trust',
    'Redwood Associates LLP',
  ])('recognises %s', (n) => expect(isEntityName(n)).toBe(true));

  it.each(['Andrew Scott Peterson', 'Marcus T. Whitfield', 'Jo Lee', '', null, undefined])(
    'does not mistake %s for an entity', (n) => expect(isEntityName(n as string)).toBe(false),
  );

  it('matches on whole words so a person is never caught by a substring', () => {
    // "Vincent" contains "inc"; "Lincoln" contains "inc"; "Scorpio"
    // contains "corp". Substring matching would classify all three as
    // companies and withhold a question the person must answer.
    expect(isEntityName('Vincent Marsh')).toBe(false);
    expect(isEntityName('Abraham Lincoln')).toBe(false);
    expect(isEntityName('Corporal Dan Scorpio')).toBe(false);
  });
});

describe('formatServiceAddress', () => {
  it('renders the conventional three-line block', () => {
    expect(formatServiceAddress({
      address: '1234 Wisconsin Street', city: 'South Salt Lake', state: 'UT', zip: '85194',
      county: 'Salt Lake',
    })).toBe('1234 Wisconsin Street\nSouth Salt Lake, UT 85194\nSalt Lake County, USA');
  });

  it('uses the caller-specified layout even from a jammed one-liner', () => {
    expect(formatServiceAddress({
      address: '123 Apple Cherry Lane, South Bend, Ampsterdam 84950, King County, USA',
    })).toBe('123 Apple Cherry Lane\nSouth Bend, Ampsterdam 84950\nKing County, USA');
  });

  it('splits a comma-joined street/city/state/zip without a county', () => {
    expect(formatServiceAddress({
      address: '5264 South Rome Beauty Park, Murray, UT 84123',
    })).toBe('5264 South Rome Beauty Park\nMurray, UT 84123\nUSA');
  });

  it('puts no comma between the state and the ZIP', () => {
    const out = formatServiceAddress({
      address: '1240 East 2100 South', city: 'Salt Lake City', state: 'UT', zip: '84106',
    });
    expect(out).toContain('UT 84106');
    expect(out).not.toContain('UT, 84106');
  });

  it('keeps the street whole on its own line', () => {
    const [street] = formatServiceAddress({
      address: '1240 East 2100 South', city: 'Salt Lake City', state: 'UT', zip: '84106',
    }).split('\n');
    expect(street).toBe('1240 East 2100 South');
  });

  it('is idempotent on its own output', () => {
    const once = formatServiceAddress({
      address: '1240 East 2100 South, Salt Lake City, UT, 84106',
    });
    expect(formatServiceAddress({ address: once })).toBe(once);
  });

  it.each([
    [{ address: '5 Elm St', city: '', state: '', zip: '' }, '5 Elm St'],
    [{ address: '', city: 'Provo', state: 'UT', zip: '84601' }, 'Provo, UT 84601\nUSA'],
    [{ address: '5 Elm St', city: 'Provo', state: '', zip: '' }, '5 Elm St\nProvo'],
    [{ address: '', city: '', state: '', zip: '' }, ''],
  ])('drops missing parts without leaving stray punctuation', (parts, expected) => {
    expect(formatServiceAddress(parts)).toBe(expected);
  });
});
