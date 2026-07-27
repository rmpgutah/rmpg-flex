// Acknowledgement of Service — variant resolution + validation.
//
// These are the rules with legal consequences, so they get pinned:
// which variation a signer gets, and what they must affirm before RMPG
// records it. The client mirrors this logic
// (client/src/utils/serveReceiptVariant.ts); the mirror is tested
// separately and the two must agree.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveReceiptVariant,
  isEntityName,
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
    recipient_phone: '(801) 555-0142',
    recipient_email: 'jane@example.com',
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

describe('contact details are required', () => {
  // Operator instruction from the 2026-07-27 service: "Require subject to
  // enter their phone number and email when entering information." A proof
  // of service whose signer cannot be reached afterwards is hard to stand
  // behind if the service is ever contested.
  it('rejects a submission with no phone', () => {
    expect(validateReceiptSubmission(submission({ recipient_phone: null })))
      .toMatch(/phone number is required/i);
  });

  it('rejects a submission with no email', () => {
    expect(validateReceiptSubmission(submission({ recipient_email: null })))
      .toMatch(/email address is required/i);
  });

  it('rejects a malformed email rather than storing an unreachable address', () => {
    for (const bad of ['notanemail', 'a@b', 'a b@c.com', '@example.com']) {
      expect(validateReceiptSubmission(submission({ recipient_email: bad })))
        .toMatch(/email address is required/i);
    }
  });
});

describe('an entity can never be the signer', () => {
  // Found on a real service 2026-07-27: a registered agent answered "yes,
  // I am the named party" for "Chase Partners Ltd, Fontana Business
  // Center 2, SDP REIT LLC, ISAOA". The form printed capacity "PARTY
  // NAMED" and had to be corrected in pen to "Registered Agent".
  it.each([
    'Chase Partners Ltd, Fontana Business Center 2, SDP REIT LLC, ISAOA',
    'KPRS Construction Services, LLC',
    'Acme Inc.',
    'Wasatch Property Holdings, LLC',
    'Zions Bank',
    'The Smith Family Trust',
  ])('recognises %s as an entity', (name) => {
    expect(isEntityName(name)).toBe(true);
  });

  it.each(['Marcus T. Whitfield', 'Angela R. Whitfield', 'Andrew Scott Peterson', ''])(
    'does not mistake %s for an entity', (name) => {
      expect(isEntityName(name)).toBe(false);
    },
  );

  it('refuses the individual variant when the party is a company', () => {
    // The client withholds the question entirely, but the client is public
    // and its POST body is attacker-controlled — the server decides.
    expect(resolveReceiptVariant({
      isNamedParty: true, premisesType: 'business',
      residesAtAddress: false, authorizedAgent: true,
      namedParty: 'Chase Partners Ltd, SDP REIT LLC, ISAOA',
    })).toBe('business');
  });

  it('still allows the individual variant for a human party', () => {
    expect(resolveReceiptVariant({
      isNamedParty: true, premisesType: 'residence',
      residesAtAddress: true, authorizedAgent: false,
      namedParty: 'Andrew Scott Peterson',
    })).toBe('individual');
  });
});

describe('signature payload hardening', () => {
  // `data:image/*` treated an SVG as a signature. SVG can carry script,
  // and this value is rendered back into an officer's DOM and embedded in
  // a PDF — the permissive test was a stored-XSS vector wearing a
  // signature's clothes.
  const ok = `data:image/png;base64,${'A'.repeat(200)}`;

  it('accepts a real PNG signature', () => {
    expect(validateReceiptSubmission(submission({ recipient_signature: ok }))).toBeNull();
  });

  it('accepts JPEG, which the typed-signature path can produce', () => {
    expect(validateReceiptSubmission(submission({
      recipient_signature: `data:image/jpeg;base64,${'A'.repeat(200)}`,
    }))).toBeNull();
  });

  it.each([
    ['svg', `data:image/svg+xml;base64,${'A'.repeat(200)}`],
    ['svg with inline script', 'data:image/svg+xml,<svg onload="alert(1)">' + 'x'.repeat(200)],
    ['gif', `data:image/gif;base64,${'A'.repeat(200)}`],
    ['html masquerading', `data:text/html;base64,${'A'.repeat(200)}`],
    ['non-base64 body', `data:image/png;base64,${'<'.repeat(200)}`],
  ])('rejects %s', (_label, value) => {
    expect(validateReceiptSubmission(submission({ recipient_signature: value })))
      .toMatch(/signature is required/i);
  });
});

describe('every officer-side route is gated', () => {
  // src/middleware/auth.ts carries readOnlyRoleGuard as a default-deny
  // backstop for MUTATIONS — its own comment notes that a handler which
  // forgets requireRole is "open to every authenticated role". Reads have
  // no such backstop, which is precisely how GET /receipt/:id and
  // /receipt/:id/document shipped ungated, returning a member of the
  // public's signature image, phone, email and physical description to
  // any account with a login, client_viewer included.
  //
  // A ratchet rather than a test of one route: the failure mode is a
  // FUTURE route added without a gate, and that is what this catches.
  const SRC = readFileSync(join(__dirname, '..', 'src', 'routes', 'serveReceipt.ts'), 'utf8');

  it('declares requireRole on every serveReceiptAdmin handler', () => {
    // Three lines of lookahead: the multi-line form puts the path on line
    // two and requireRole on line three.
    const handlers = SRC.match(/serveReceiptAdmin\.(get|post|put|delete)\((?:[^\n]*\n){0,2}[^\n]*/g) ?? [];
    expect(handlers.length).toBeGreaterThan(4);
    const ungated = handlers.filter((h) => !h.includes('requireRole') && !h.includes('RECEIPT_READ_ROLES'));
    expect(
      ungated,
      'every officer-side route must name the roles that may reach it — reads '
      + 'have no default-deny backstop, only mutations do',
    ).toEqual([]);
  });

  it('does not let a read-only client role reach a signature', () => {
    expect(SRC).toMatch(/RECEIPT_READ_ROLES/);
    const decl = SRC.slice(SRC.indexOf('const RECEIPT_READ_ROLES'), SRC.indexOf('const RECEIPT_READ_ROLES') + 200);
    expect(decl).not.toContain('client_viewer');
  });
});
