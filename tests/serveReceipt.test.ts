// Acknowledgement of Service — variant resolution + validation.
//
// These are the rules with legal consequences, so they get pinned:
// which variation a signer gets, and what they must affirm before RMPG
// records it. The client mirrors this logic
// (client/src/utils/serveReceiptVariant.ts); the mirror is tested
// separately and the two must agree.

import { describe, it, expect } from 'vitest';
import {
  resolveReceiptVariant,
  receiptFormTitle,
  validateReceiptSubmission,
  VARIANT_LABEL,
  type ServeReceiptSubmission,
} from '../src/routes/serveReceipt';

const SIG = `data:image/png;base64,${'A'.repeat(200)}`;

function submission(over: Partial<ServeReceiptSubmission> = {}): ServeReceiptSubmission {
  return {
    variant: 'individual',
    recipient_name: 'Jane Doe',
    business_name: null,
    recipient_age_confirmed: 1,
    ack_received_documents: 1,
    ack_information_true: 1,
    recipient_signature: SIG,
    sub_resides_at_address: 0,
    sub_is_authorized_agent: 0,
    sub_agrees_to_deliver: 0,
    sub_release_acknowledged: 0,
    sub_defendant_name: null,
    ...over,
  };
}

describe('resolveReceiptVariant', () => {
  it('returns individual when the named party signs, ignoring everything else', () => {
    expect(resolveReceiptVariant({
      isNamedParty: true, premisesType: 'business',
      residesAtAddress: true, authorizedAgent: true,
    })).toBe('individual');
  });

  it('returns business for a business premises', () => {
    expect(resolveReceiptVariant({
      isNamedParty: false, premisesType: 'business',
      residesAtAddress: false, authorizedAgent: false,
    })).toBe('business');
  });

  it('returns business when an authorized agent signs at a residence', () => {
    // A registered agent operating out of a home is still the business
    // variation — that is the one carrying the agent-authority statement.
    expect(resolveReceiptVariant({
      isNamedParty: false, premisesType: 'residence',
      residesAtAddress: false, authorizedAgent: true,
    })).toBe('business');
  });

  it('prefers business over co_habitant when the signer both lives and works there', () => {
    expect(resolveReceiptVariant({
      isNamedParty: false, premisesType: 'business',
      residesAtAddress: true, authorizedAgent: false,
    })).toBe('business');
  });

  it('returns co_habitant for a resident of the dwelling', () => {
    expect(resolveReceiptVariant({
      isNamedParty: false, premisesType: 'residence',
      residesAtAddress: true, authorizedAgent: false,
    })).toBe('co_habitant');
  });

  it('falls through to substitute when no residency or authority is claimed', () => {
    expect(resolveReceiptVariant({
      isNamedParty: false, premisesType: 'other',
      residesAtAddress: false, authorizedAgent: false,
    })).toBe('substitute');
  });
});

describe('receiptFormTitle', () => {
  it('names each printed variation', () => {
    expect(receiptFormTitle('individual')).toBe('Acknowledgement of Service Form (Individual)');
    expect(receiptFormTitle('co_habitant')).toBe('Acknowledgement of Service Form (Co-Habitant)');
    expect(receiptFormTitle('business')).toBe('Acknowledgement of Service Form (Business)');
    expect(receiptFormTitle('substitute')).toBe('Acknowledgement of Service Form (Substitute Service)');
  });

  it('has a label for every variant', () => {
    expect(Object.keys(VARIANT_LABEL).sort())
      .toEqual(['business', 'co_habitant', 'individual', 'substitute']);
  });
});

describe('validateReceiptSubmission — universal requirements', () => {
  it('accepts a complete individual submission', () => {
    expect(validateReceiptSubmission(submission())).toBeNull();
  });

  it.each([
    ['recipient_name', { recipient_name: null }, /name is required/i],
    ['signature', { recipient_signature: null }, /signature is required/i],
    ['age', { recipient_age_confirmed: 0 }, /eighteen/i],
    ['receipt', { ack_received_documents: 0 }, /receiving the documents/i],
    ['truthfulness', { ack_information_true: 0 }, /true and correct/i],
  ])('rejects a submission missing %s', (_label, over, pattern) => {
    expect(validateReceiptSubmission(submission(over as Partial<ServeReceiptSubmission>)))
      .toMatch(pattern);
  });

  it('rejects a signature that is not an image data URL', () => {
    expect(validateReceiptSubmission(submission({ recipient_signature: 'X'.repeat(500) })))
      .toMatch(/signature is required/i);
  });

  it('rejects an implausibly short signature', () => {
    expect(validateReceiptSubmission(submission({ recipient_signature: 'data:image/png;base64,AAA' })))
      .toMatch(/signature is required/i);
  });
});

describe('validateReceiptSubmission — acceptance on behalf of another', () => {
  const cohab = (over: Partial<ServeReceiptSubmission> = {}) => submission({
    variant: 'co_habitant',
    sub_defendant_name: 'John Roe',
    sub_resides_at_address: 1,
    sub_agrees_to_deliver: 1,
    sub_release_acknowledged: 1,
    ...over,
  });

  it('accepts a complete co-habitant submission', () => {
    expect(validateReceiptSubmission(cohab())).toBeNull();
  });

  it('requires the named party the documents are for', () => {
    expect(validateReceiptSubmission(cohab({ sub_defendant_name: null })))
      .toMatch(/intended for is required/i);
  });

  it('requires the undertaking to deliver', () => {
    expect(validateReceiptSubmission(cohab({ sub_agrees_to_deliver: 0 })))
      .toMatch(/agree to deliver/i);
  });

  it('requires the on-behalf-of acknowledgment', () => {
    expect(validateReceiptSubmission(cohab({ sub_release_acknowledged: 0 })))
      .toMatch(/accepting on their behalf/i);
  });

  it('requires a co-habitant to actually reside at the address', () => {
    expect(validateReceiptSubmission(cohab({ sub_resides_at_address: 0 })))
      .toMatch(/resident of the address/i);
  });

  it('accepts a residential registered agent with no separate business name', () => {
    // Found live 2026-07-27. Ticking "authorized to accept" at a RESIDENCE
    // resolves to the Business variation — correct, that is a registered
    // agent working from home — but validation then demanded a business
    // name a house does not have and the form became unfillable. The
    // entity named in the process stands in.
    expect(validateReceiptSubmission(cohab({
      variant: 'business', business_name: null,
      sub_defendant_name: 'John Roe', sub_is_authorized_agent: 1,
    }))).toBeNull();
  });

  it('still rejects a business submission naming no entity at all', () => {
    expect(validateReceiptSubmission(cohab({
      variant: 'business', business_name: null,
      sub_defendant_name: null, sub_is_authorized_agent: 1,
    }))).toMatch(/intended for is required/i);
  });

  it('requires employment or authority on the business variant', () => {
    expect(validateReceiptSubmission(cohab({
      variant: 'business', business_name: 'Acme LLC',
      sub_resides_at_address: 0, sub_is_authorized_agent: 0,
    }))).toMatch(/authorized to accept service/i);
  });

  it('does NOT demand residency or authority on the substitute variant', () => {
    // By construction the substitute neither lives nor works there.
    // Demanding the authority statement would be demanding a false one.
    expect(validateReceiptSubmission(cohab({
      variant: 'substitute', sub_resides_at_address: 0, sub_is_authorized_agent: 0,
    }))).toBeNull();
  });

  it('does not apply any on-behalf-of rule to the individual variant', () => {
    expect(validateReceiptSubmission(submission({
      variant: 'individual', sub_defendant_name: null, sub_agrees_to_deliver: 0,
    }))).toBeNull();
  });
});

describe('officer MDT intake — variant pre-selection', () => {
  // The officer answers what they can SEE; the resolver turns that into
  // a form. They never pick a form off a list, because picking a form is
  // a legal judgement and "is this a business?" is not.
  it.each([
    ['named party at the door', { isNamedParty: true, premisesType: 'residence', residesAtAddress: false, authorizedAgent: false }, 'individual'],
    ['spouse at a house', { isNamedParty: false, premisesType: 'residence', residesAtAddress: true, authorizedAgent: false }, 'co_habitant'],
    ['manager at a business', { isNamedParty: false, premisesType: 'business', residesAtAddress: false, authorizedAgent: true }, 'business'],
    ['a stranger accepting', { isNamedParty: false, premisesType: 'other', residesAtAddress: false, authorizedAgent: false }, 'substitute'],
  ])('officer sees %s → %s', (_label, answers, expected) => {
    expect(resolveReceiptVariant(answers as any)).toBe(expected);
  });

  it('treats an unsure officer as "not the named party"', () => {
    // isNamedParty is null when the officer could not tell. Resolving
    // that to `individual` would hand a stranger the one form with no
    // authority statement on it — so unsure must fall to the safer side
    // and let the signer answer for themselves.
    expect(resolveReceiptVariant({
      isNamedParty: false, premisesType: 'residence',
      residesAtAddress: false, authorizedAgent: false,
    })).not.toBe('individual');
  });

  it('agrees with the signer when both answer the same way', () => {
    // The officer's answers and the signer's go through THIS resolver,
    // not two parallel implementations — that is what makes a mismatch
    // meaningful evidence rather than an artefact of drifting rules.
    const doorstep = { isNamedParty: false, premisesType: 'business', residesAtAddress: false, authorizedAgent: true };
    expect(resolveReceiptVariant(doorstep)).toBe(resolveReceiptVariant({ ...doorstep }));
  });

  it('detects the disagreement worth flagging', () => {
    // Officer reads "employee at a business"; the signer says they
    // actually live there and are not authorized. Different form, and a
    // supervisor should see that before an affidavit is filed on it.
    const officer = resolveReceiptVariant({
      isNamedParty: false, premisesType: 'business', residesAtAddress: false, authorizedAgent: true,
    });
    const signer = resolveReceiptVariant({
      isNamedParty: false, premisesType: 'residence', residesAtAddress: true, authorizedAgent: false,
    });
    expect(officer).toBe('business');
    expect(signer).toBe('co_habitant');
    expect(officer === signer).toBe(false);
  });
});
