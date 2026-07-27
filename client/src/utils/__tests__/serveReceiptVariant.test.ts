// Client mirror of the Acknowledgement of Service variant rules.
//
// The worker owns the authoritative copy (src/routes/serveReceipt.ts,
// tested in tests/serveReceipt.test.ts). This suite pins the client
// mirror so the two cannot drift apart silently — a drift would show
// the signer one set of statements and store a different variant.

import { describe, it, expect } from 'vitest';
import {
  resolveReceiptVariant, receiptFormTitle, attestationsFor, VARIANT_LABEL,
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
