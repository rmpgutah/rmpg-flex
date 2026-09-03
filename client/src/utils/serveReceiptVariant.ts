// ============================================================
// Acknowledgement of Service — form variant resolution
//
// One form, four printed variations. Which one a recipient signs is
// DERIVED from what they tell us, never picked from a dropdown:
//
//   (Individual)         the named party is signing for themselves
//   (Co-Habitant)        an adult who lives at the dwelling is accepting
//   (Business)           an employee / agent is accepting at a business
//   (Substitute Service) anyone else accepting on the party's behalf
//
// Why derived: a signer asked to self-classify will pick wrong, and the
// variant is the thing that decides which attestations are legally
// required. Deriving it from concrete facts ("do you live here?", "is
// this a business?") keeps the person answering questions they actually
// know the answer to.
//
// Why the attestation TEXT lives here and is stored with the receipt:
// the sentences below are what the signer agreed to. If this copy is
// ever edited, previously-signed receipts must still print their
// original wording — so the page captures these strings verbatim into
// serve_receipts.attestations_json rather than re-deriving them at
// render time. Treat edits to ATTESTATIONS as a versioned change.
//
// The worker mirrors this resolution in src/routes/serveReceipt.ts
// (resolveReceiptVariant). The two must agree; the server's answer wins
// and is what gets stored. There is no shared build between /src and
// /client/src, which is why it is duplicated rather than imported.
// ============================================================

export type ReceiptVariant = 'individual' | 'co_habitant' | 'business' | 'substitute';

export interface VariantInputs {
  /** True when the person signing IS the party named in the documents. */
  isNamedParty: boolean;
  premisesType: 'residence' | 'business' | 'other';
  /** Signer states they live at the address of service. */
  residesAtAddress: boolean;
  /** Signer states they are authorized to accept service here. */
  authorizedAgent: boolean;
}

/**
 * Does this party name denote a legal ENTITY rather than a human?
 *
 * Matters because "Are you <party>?" can never truthfully be answered yes
 * when the party is a company. Observed live on a real service: the named
 * party was "Chase Partners Ltd, Fontana Business Center 2, SDP REIT LLC,
 * ISAOA" and a registered agent answered yes, producing an (Individual)
 * form that recorded him as the party himself. The capacity line read
 * "PARTY NAMED" and had to be corrected in pen to "Registered Agent".
 *
 * Suffix matching, not an exhaustive registry: a false negative just
 * leaves the question as it is today, while a false positive on a human
 * is essentially impossible — people are not named "Inc".
 */
const ENTITY_MARKERS = [
  'llc', 'l.l.c', 'inc', 'incorporated', 'corp', 'corporation', 'ltd', 'limited',
  'lp', 'llp', 'l.p', 'pllc', 'pc', 'company', 'co.', 'trust', 'partners',
  'partnership', 'associates', 'holdings', 'group', 'isaoa', 'atima', 'n.a.',
  'bank', 'foundation', 'institute', 'authority', 'district', 'university',
];

export function isEntityName(name: string | null | undefined): boolean {
  if (!name) return false;
  const t = ` ${name.toLowerCase().replace(/[,]/g, ' ')} `;
  return ENTITY_MARKERS.some((m) => t.includes(` ${m} `) || t.includes(` ${m}. `));
}

export function resolveReceiptVariant(i: VariantInputs, partyName?: string | null): ReceiptVariant {
  // A human signer can never BE a legal entity. Force isNamedParty false when
  // the party name is a company, trust, etc., so "are you Chase Partners LLC?"
  // cannot produce an (Individual) form. Mirrors server-side resolveReceiptVariant.
  const isNamedParty = i.isNamedParty && !isEntityName(partyName);
  if (isNamedParty) return 'individual';
  // Business is checked before co-habitant: someone can both work and
  // live at an address (a live-in manager, a home business), and when
  // the papers are directed at a business entity the business variant
  // is the one that carries the agent-authority attestation.
  if (i.premisesType === 'business' || i.authorizedAgent) return 'business';
  if (i.residesAtAddress) return 'co_habitant';
  return 'substitute';
}

export const VARIANT_LABEL: Record<ReceiptVariant, string> = {
  individual: 'Individual',
  co_habitant: 'Co-Habitant',
  business: 'Business',
  substitute: 'Substitute Service',
};

export function receiptFormTitle(variant: ReceiptVariant): string {
  return `Acknowledgement of Service Form (${VARIANT_LABEL[variant]})`;
}

export interface Attestation {
  id: string;
  text: string;
  /** Required attestations block submission when unchecked. */
  required: boolean;
}

/**
 * The attestation statements for a variant, in signing order.
 *
 * `{party}` is substituted with the named individual or business. The
 * placeholder is resolved at render time so the stored text and the
 * printed text are identical strings.
 */
export function attestationsFor(variant: ReceiptVariant, party: string): Attestation[] {
  const p = party || 'the named party';

  const adult: Attestation = {
    id: 'adult',
    text: 'I am an adult over the age of eighteen.',
    required: true,
  };

  const authority: Attestation = {
    id: 'authority',
    text:
      'I am a resident, or employee of the current address for service, and am '
      + 'authorized to accept service, on behalf of the individual, or business in question.',
    required: true,
  };

  const acceptance = (label: string): Attestation => ({
    id: 'acceptance',
    text: `I acknowledge that I am accepting on behalf of ${label}, and accept any control moving forwards from this interaction.`,
    required: true,
  });

  const received: Attestation = {
    id: 'received',
    text: 'I received the documents listed on this form on today’s date.',
    required: true,
  };

  const truthful: Attestation = {
    id: 'truthful',
    text: 'The information I have provided on this form is true and correct.',
    required: true,
  };

  const explained: Attestation = {
    id: 'explained',
    text: 'The process server identified themselves and explained what these documents are.',
    required: false,
  };

  const deliver = (label: string): Attestation => ({
    id: 'deliver',
    text: `I agree to deliver these documents to ${label} as soon as reasonably possible, and I understand that they are official court documents which may contain a response deadline.`,
    required: true,
  });

  switch (variant) {
    case 'individual':
      // The named party signing for themselves attests to receipt and
      // accuracy only. Asking them to affirm they are "authorized to
      // accept on behalf of" themselves is nonsense and reads as a trap.
      return [adult, received, explained, truthful];

    case 'co_habitant':
      return [adult, authority, acceptance(p), deliver(p), received, explained, truthful];

    case 'business':
      return [adult, authority, acceptance(p), deliver(p), received, explained, truthful];

    case 'substitute':
      // No residency or employment claim is available here, so the
      // authority statement is omitted rather than presented as
      // something the signer must falsely affirm. The undertaking to
      // deliver carries the weight instead.
      return [adult, acceptance(p), deliver(p), received, explained, truthful];
  }
}

export { formatServiceAddress, flattenServiceAddress } from './formatServiceAddress';
