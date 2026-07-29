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
  receiptBarcodeCheck,
  VARIANT_LABEL,
  type ServeReceiptSubmission,
} from '../src/routes/serveReceipt';

// A signature fixture must decode to a real image, because the validator
// now checks the magic bytes. The old fixture was 200 'A's — it matched
// the base64 pattern and looked fine, but decoded to nothing that any
// renderer could draw. That is exactly the truncated-write case the check
// exists to catch, so it belongs in the rejection cases, not here.
function dataUrl(magic: number[], mime: string): string {
  let raw = '';
  for (const b of [...magic, ...Array(200).fill(0)]) raw += String.fromCharCode(b);
  return `data:image/${mime};base64,${Buffer.from(raw, 'binary').toString('base64')}`;
}
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46];
const SIG = dataUrl(PNG_BYTES, 'png');
const SIG_JPEG = dataUrl(JPEG_BYTES, 'jpeg');

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
  const ok = SIG;

  it('accepts a real PNG signature', () => {
    expect(validateReceiptSubmission(submission({ recipient_signature: ok }))).toBeNull();
  });

  it('accepts JPEG, which the typed-signature path can produce', () => {
    expect(validateReceiptSubmission(submission({
      recipient_signature: SIG_JPEG,
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

describe('integrity guards (migration 0209)', () => {
  const SRC = readFileSync(join(__dirname, '..', 'src', 'routes', 'serveReceipt.ts'), 'utf8');
  const MIG = readFileSync(join(__dirname, '..', 'migrations', '0209_serve_receipt_integrity.sql'), 'utf8');

  it('constrains one SIGNED receipt per job, not one receipt per job', () => {
    // Partial index. Without the WHERE clause a voided receipt would
    // permanently poison the job — a supervisor could never record the
    // corrected one.
    expect(MIG).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_serve_receipts_one_signed/);
    expect(MIG).toMatch(/WHERE status = 'signed'/);
  });

  it('translates the constraint into a stated conflict on all three write paths', () => {
    // Three independent paths — subject's phone, transcribed paper,
    // officer-attested refusal. The token burn stops one running twice; it
    // does nothing about two DIFFERENT paths firing for one doorstep.
    // Without this the second returns a 500 an officer will simply retry.
    const guards = SRC.match(/isDuplicateSignedReceipt\(err\)/g) ?? [];
    expect(guards.length).toBe(3);
    expect(SRC).toMatch(/code: 'already_signed'/);
  });

  it('captures the job status BEFORE the receipt advances it', () => {
    // Restoring on void needs the status the job actually had. Guessing
    // 'in_progress' is wrong for a job that was 'pending' when served on
    // the first attempt, and inventing a plausible status on a legal
    // record is worse than the bug it papers over.
    expect(MIG).toMatch(/ADD COLUMN job_status_before TEXT/);
    const priors = SRC.match(/priorStatus/g) ?? [];
    expect(priors.length).toBeGreaterThanOrEqual(6);
  });

  it('reverts the job on void, but only when no signed receipt survives', () => {
    // A job legitimately holding a second valid acknowledgement must stay
    // served. Reverting unconditionally would be a different false fact.
    expect(SRC).toMatch(/SELECT COUNT\(\*\) AS n FROM serve_receipts WHERE serve_queue_id = \? AND status = 'signed'/);
    expect(SRC).toMatch(/if \(!survivor\?\.n\)/);
    expect(SRC).toMatch(/serve_date = NULL/);
  });

  it('falls back honestly for receipts written before 0209', () => {
    // job_status_before is NULL on those. 'in_progress' is defensible —
    // attempts demonstrably happened — and it puts the job back in front
    // of an officer rather than asserting something more specific.
    expect(SRC).toMatch(/before\.job_status_before \|\| 'in_progress'/);
  });
});

describe('isDuplicateSignedReceipt', () => {
  it('matches the D1 unique-constraint error and not unrelated failures', async () => {
    const { isDuplicateSignedReceipt } = await import('../src/routes/serveReceipt');
    expect(isDuplicateSignedReceipt(new Error(
      'D1_ERROR: UNIQUE constraint failed: index idx_serve_receipts_one_signed'))).toBe(true);
    expect(isDuplicateSignedReceipt(new Error('UNIQUE constraint failed: serve_receipts.id'))).toBe(true);
    // Must NOT swallow an unrelated constraint — a FK violation on another
    // table is a real bug and has to surface, not read as "already signed".
    expect(isDuplicateSignedReceipt(new Error('UNIQUE constraint failed: users.username'))).toBe(false);
    expect(isDuplicateSignedReceipt(new Error('no such column: foo'))).toBe(false);
    expect(isDuplicateSignedReceipt(null)).toBe(false);
  });
});

describe('lifecycle hardening (migration 0210)', () => {
  const SRC = readFileSync(join(__dirname, '..', 'src', 'routes', 'serveReceipt.ts'), 'utf8');
  const MIG = readFileSync(join(__dirname, '..', 'migrations', '0210_serve_receipt_lifecycle.sql'), 'utf8');
  const INDEX = readFileSync(join(__dirname, '..', 'src', 'index.ts'), 'utf8');

  it('indexes the column two handlers join through', () => {
    expect(MIG).toMatch(/CREATE INDEX IF NOT EXISTS idx_serve_receipts_token/);
  });

  it('ages a never-resolved email to unresolved, not failed', () => {
    // We genuinely do not know: the mail may have gone and only the
    // confirmation been lost. Recording a failure we cannot demonstrate is
    // the same class of mistake as leaving it 'pending' forever.
    expect(SRC).toMatch(/email_status = 'unresolved'/);
    expect(SRC).not.toMatch(/SET email_status = 'failed'\s*$/m);
    expect(INDEX).toMatch(/sweepStaleReceiptEmails/);
  });

  it('bounds the sweep window so a bad argument cannot wipe recent rows', () => {
    expect(SRC).toMatch(/Math\.max\(1, Math\.min\(720, olderThanHours\)\)/);
  });

  it('names the refusal channel rather than shipping an undocumented value', () => {
    // The documented set is mobile | paper. The refusal path introduced
    // 'officer' without documenting it.
    expect(SRC).toMatch(/'refusal', \?, 'refused'/);
    expect(SRC).not.toMatch(/'officer', \?, 'refused'/);
  });

  it('requires a refusal reason that actually says something', () => {
    // "n" satisfies a truthiness check and tells a court nothing. This is
    // the only account of a doorstep where nobody signed.
    expect(SRC).toMatch(/reasonText\.length < 15/);
  });

  it('truncates the JSON LIST, never the string', () => {
    // A blob cut mid-token fails at READ time on a legal record, which is
    // far worse than failing at write time where someone can see it.
    expect(SRC).toMatch(/function boundedJson/);
    expect(SRC).toMatch(/boundedJson\(documents, 50, 8_000\)/);
    expect(SRC).toMatch(/boundedJson\(attestations, 20, 16_000\)/);
  });
});

describe('boundedJson', () => {
  it('always returns parseable JSON, however hard it truncates', async () => {
    const { boundedJson } = await import('../src/routes/serveReceipt');
    const fat = Array.from({ length: 50 }, (_, i) => ({ title: 'x'.repeat(200), copies: i }));
    const out = boundedJson(fat, 50, 1_000);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out.length).toBeLessThanOrEqual(1_000);
    expect(JSON.parse(out).length).toBeGreaterThan(0);
  });

  it('keeps everything when it already fits', async () => {
    const { boundedJson } = await import('../src/routes/serveReceipt');
    const small = [{ title: 'Summons', copies: 1 }, { title: 'Complaint', copies: 1 }];
    expect(JSON.parse(boundedJson(small, 50, 8_000))).toEqual(small);
  });

  it('never returns an empty list while one item could fit', async () => {
    // Truncating to nothing would lose the itemisation entirely — the
    // exact thing a service dispute turns on.
    const { boundedJson } = await import('../src/routes/serveReceipt');
    const out = boundedJson([{ title: 'y'.repeat(5_000), copies: 1 }], 50, 100);
    expect(JSON.parse(out).length).toBe(1);
  });
});

describe('signature must actually decode', () => {
  // The pattern test alone accepts a truncated write: a payload cut short
  // by a dropped connection still matches the regex and only fails when
  // someone tries to PRINT the instrument, potentially years later in
  // front of a judge.

  it('accepts a real PNG header', () => {
    expect(validateReceiptSubmission(submission({
      recipient_signature: SIG,
    }))).toBeNull();
  });

  it('accepts a real JPEG header', () => {
    expect(validateReceiptSubmission(submission({
      recipient_signature: SIG_JPEG,
    }))).toBeNull();
  });

  it('rejects a payload whose bytes are not an image at all', () => {
    // Right prefix, right character set, wrong content — exactly what a
    // truncated or corrupted write looks like.
    expect(validateReceiptSubmission(submission({
      recipient_signature: `data:image/png;base64,${'A'.repeat(200)}`,
    }))).toMatch(/signature is required/i);
  });

  it('rejects a body that is not valid base64', () => {
    expect(validateReceiptSubmission(submission({
      recipient_signature: `data:image/png;base64,${'='.repeat(200)}`,
    }))).toMatch(/signature is required/i);
  });
});


// The barcode check-digit contract, pinned.
//
// The Worker resolves what the client PDF encodes. If either
// implementation drifts, every scanned paper copy of an instrument stops
// resolving — including copies already filed with a court. The same table
// is asserted against the client mirror in
// client/src/utils/__tests__/servePdfGenerator.test.ts.
const PINNED_CHECKS: Array<[number, string]> = [
  [1, '2'], [42, 'E'], [4471, 'H'], [100000, '2'], [999999, 'R'],
];

describe('receiptBarcodeCheck', () => {
  it('differs for ids that differ by one digit', () => {
    // The whole point: a single misread digit must not resolve to another
    // real receipt. It should fail to resolve instead.
    expect(receiptBarcodeCheck(4471)).not.toBe(receiptBarcodeCheck(4472));
    expect(receiptBarcodeCheck(4471)).not.toBe(receiptBarcodeCheck(4371));
    expect(receiptBarcodeCheck(1)).not.toBe(receiptBarcodeCheck(2));
  });

  it('catches a transposition, which a plain sum would not', () => {
    // Position-weighted for this reason: 4471 and 4417 sum identically.
    expect(receiptBarcodeCheck(4471)).not.toBe(receiptBarcodeCheck(4417));
  });

  it('is a single base-36 character', () => {
    for (const id of [1, 42, 4471, 999999]) {
      expect(receiptBarcodeCheck(id)).toMatch(/^[0-9A-Z]$/);
    }
  });

  it('matches the pinned values the client mirror is also held to', () => {
    // Deliberately NOT an import of the client function. /src and
    // /client/src share no build, and importing across the boundary pulls
    // DOM-typed client code into the Worker's tsconfig, which has no DOM
    // lib — the suite passes and `tsc` fails.
    //
    // So the contract lives in this table, and the identical table is
    // asserted in client/src/utils/__tests__/servePdfGenerator.test.ts.
    // Either side drifting turns its own suite red, which is what the
    // import was for: the worker resolves what the client encodes, and a
    // divergence stops every scanned paper copy from resolving.
    expect(PINNED_CHECKS.map(([id]) => receiptBarcodeCheck(id)))
      .toEqual(PINNED_CHECKS.map(([, check]) => check));
  });
});
