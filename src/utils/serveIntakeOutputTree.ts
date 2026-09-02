// ============================================================
// RMPG Flex — Serve Intake operational output tree
// ============================================================
// Evidence-gated playbook. Each catalog entry is a named dynamic that
// ONLY fires when the packet/location actually matches. The officer sees
// a tree of fired branches — not a dump of every possible rule.
//
// Venue is an OVERLAY on address class. It does not replace D-2 timing
// for a generic unconfirmed business at a residence. School/warehouse/
// hotel window overlays apply only when office-hour timing already won.
// ============================================================

import type { ExtractedField, QueueRow } from './serveIntakeExtract';
import type { AddressClass } from './serveAddressClass';
import { addressClassLabel } from './serveAddressClass';

export const VENUE_KINDS = [
  'none',
  'medical_hospice',
  'hospital',
  'nursing_home',
  'financial',
  'law_office',
  'school',
  'hotel',
  'warehouse',
  'church',
  'storage',
  'apartment_complex',
  'high_rise',
  'military',
  'construction',
  'rural',
] as const;

export type VenueKind = (typeof VENUE_KINDS)[number];

export type TreeBranch =
  | 'venue'
  | 'paper'
  | 'packet'
  | 'legal'
  | 'access'
  | 'timeline'
  | 'identity'
  | 'safety';

export interface TreeFeature {
  id: string;
  branch: TreeBranch;
  label: string;
  playbook: string[];
}

export interface OutputTree {
  locationClass: AddressClass;
  locationLabel: string;
  venue: VenueKind;
  venueLabel: string;
  catalogSize: number;
  firedIds: string[];
  features: TreeFeature[];
}

export const VENUE_LABELS: Record<VenueKind, string> = {
  none: 'None (use location class only)',
  medical_hospice: 'Medical / Hospice',
  hospital: 'Hospital',
  nursing_home: 'Nursing / Assisted Living',
  financial: 'Bank / Financial Institution',
  law_office: 'Law Office',
  school: 'School / Campus',
  hotel: 'Hotel / Lodging',
  warehouse: 'Warehouse / Industrial',
  church: 'House of Worship',
  storage: 'Self-Storage',
  apartment_complex: 'Apartment Complex',
  high_rise: 'High-Rise / Multi-Tenant Office',
  military: 'Military / Restricted Installation',
  construction: 'Construction Site',
  rural: 'Rural / Farm / Acreage',
};

const VENUE_DETECTORS: Array<{ kind: VenueKind; re: RegExp }> = [
  { kind: 'military', re: /\b(military|air force|army (?:base|post)|navy base|national guard|hill afb|camp williams)\b/i },
  { kind: 'hospital', re: /\b(hospital|medical center|emergency (?:dept|department)|trauma center)\b/i },
  { kind: 'medical_hospice', re: /\b(hospice|home health|dialysis|clinic|urgent care)\b/i },
  { kind: 'nursing_home', re: /\b(nursing home|assisted living|memory care|rehab(?:ilitation)? center)\b/i },
  { kind: 'school', re: /\b(elementary|middle school|high school|school district|university|college campus|charter school)\b/i },
  { kind: 'financial', re: /\b(bank|credit union|wells fargo|chase bank|financial (?:svc|services)|title company)\b/i },
  { kind: 'law_office', re: /\b(law (?:office|firm)|attorneys? at law|\bllp\b.*law|esq\.)\b/i },
  { kind: 'hotel', re: /\b(hotel|motel|inn\b|extended stay|marriott|hilton|holiday inn)\b/i },
  { kind: 'warehouse', re: /\b(warehouse|distribution center|industrial park|loading dock|fulfillment)\b/i },
  { kind: 'church', re: /\b(church|temple|mosque|synagogue|ward house|lds chapel)\b/i },
  { kind: 'storage', re: /\b(self[- ]?storage|public storage|storage unit)\b/i },
  { kind: 'construction', re: /\b(construction site|jobsite|hard hat|trailer office)\b/i },
  { kind: 'apartment_complex', re: /\b(apartment(?:s| complex)?|apartments|leasing office|townhome community)\b/i },
  { kind: 'high_rise', re: /\b(high[- ]rise|office tower|plaza\b|tower\b.*suite)\b/i },
  { kind: 'rural', re: /\b(rural route|acreage|farm\b|ranch\b|county road)\b/i },
];

export function inferVenueKind(
  address: string | null | undefined,
  entityName?: string | null,
  instructions?: string | null,
): VenueKind {
  const hay = `${address || ''} ${entityName || ''} ${instructions || ''}`;
  for (const d of VENUE_DETECTORS) {
    if (d.re.test(hay)) return d.kind;
  }
  return 'none';
}

export interface TreeBuildInput {
  addressClass: AddressClass;
  addressClassConfirmed?: boolean;
  isBusiness: boolean;
  fields: Record<string, ExtractedField>;
  queueRow: QueueRow;
  agentName: string;
  fullLocation: string;
  docCount: number;
  nowIso: string;
  gateCode?: string | null;
  hazardNotes?: string | null;
  /** Operator override. `undefined` infers. `'none'` forces no overlay. */
  venueOverride?: VenueKind | null;
  dogsOnSite?: boolean;
  camerasOnSite?: boolean;
  noSunday?: boolean;
  authorizedAcceptor?: string | null;
  languageNeeded?: string | null;
  physicalDescription?: string | null;
}

const get = (fields: Record<string, ExtractedField>, k: string) =>
  (fields[k]?.value || '').trim();

function haystack(input: TreeBuildInput): string {
  return [
    input.fullLocation, input.queueRow.recipient_name, input.queueRow.business_name,
    get(input.fields, 'recipient_business_name'), input.agentName,
    input.queueRow.document_type, get(input.fields, 'document_subtype'),
    get(input.fields, 'documents_to_serve'), input.queueRow.service_instructions,
    input.queueRow.notes, get(input.fields, 'process_type'),
    input.noSunday ? 'do not serve on sunday' : '',
    input.authorizedAcceptor ? 'anyone authorized to accept' : '',
    input.languageNeeded ? `bilingual ${input.languageNeeded}` : '',
    input.dogsOnSite ? 'dog aggressive animal' : '',
    input.gateCode ? `gate code ${input.gateCode}` : '',
    input.camerasOnSite ? 'cameras on site' : '',
  ].filter(Boolean).join(' ').toLowerCase();
}

function includesAny(h: string, needles: string[]): boolean {
  return needles.some((n) => h.includes(n));
}

function daysUntil(deadlineIso: string, nowIso: string): number {
  const dl = new Date(deadlineIso + 'T00:00:00Z').getTime();
  const now = new Date(nowIso).getTime();
  return Math.ceil((dl - now) / 86_400_000);
}

type Detector = (ctx: { h: string; input: TreeBuildInput; venue: VenueKind }) => TreeFeature | null;

const DETECTORS: Detector[] = [
  ({ venue }) => venue === 'medical_hospice' ? feat('venue.medical_hospice', 'venue', 'Medical / Hospice', [
    'Check in at reception / nursing station. Do not enter patient rooms or care areas unescorted.',
    'Ask for the administrator, DON, or person authorized to accept legal papers — not a random caregiver.',
    'HIPAA: do not discuss the case with staff or family in a public waiting area. Quote the summons caption only.',
  ]) : null,
  ({ venue }) => venue === 'hospital' ? feat('venue.hospital', 'venue', 'Hospital', [
    'Serve at Administration / Risk Management / Legal, not at the ER desk or a nurse station.',
    'Expect a security checkpoint and visitor badge. After-hours drop at security is not personal service unless they are authorized to accept.',
  ]) : null,
  ({ venue }) => venue === 'nursing_home' ? feat('venue.nursing_home', 'venue', 'Nursing / Assisted Living', [
    'Ask for the administrator or authorized agent. A resident may be the named party — confirm identity against the packet, not the wristband alone.',
    'Do not serve in a shared dining room if it would disclose the nature of the papers to other residents.',
  ]) : null,
  ({ venue }) => venue === 'financial' ? feat('venue.financial', 'venue', 'Bank / Financial', [
    'Ask for the branch manager or operations officer authorized to accept. Tellers are not automatically authorized.',
    'Garnishment / levy papers: record exact time — interrogatory clocks run from service.',
  ]) : null,
  ({ venue }) => venue === 'law_office' ? feat('venue.law_office', 'venue', 'Law Office', [
    'Front-desk receptionists at a law firm are often authorized to accept. Note full name and title.',
    'If the firm is counsel of record, still serve the named recipient unless the packet directs service on counsel.',
  ]) : null,
  ({ venue }) => venue === 'school' ? feat('venue.school', 'venue', 'School / Campus', [
    'Serve at the main office during posted school hours. Do not approach classrooms or playgrounds.',
    'If serving an employee, ask for the principal / HR. If serving a student/parent, confirm you are not on campus during a lockdown or event.',
  ]) : null,
  ({ venue }) => venue === 'hotel' ? feat('venue.hotel', 'venue', 'Hotel / Lodging', [
    'Ask the front desk whether the named person is registered. Do not disclose the nature of the documents to desk staff.',
    'A guest-room slide-under is not personal service. If they refuse to come down, document the desk conversation and re-attempt.',
  ]) : null,
  ({ venue }) => venue === 'warehouse' ? feat('venue.warehouse', 'venue', 'Warehouse / Industrial', [
    'Attempt at receiving / the shipping office, not the locked yard. Hard-hat areas: stay in the office unless escorted.',
    'Early receiving hours often beat mid-morning office hours at distribution sites.',
  ]) : null,
  ({ venue }) => venue === 'church' ? feat('venue.church', 'venue', 'House of Worship', [
    'Serve the office / clerk during posted office hours — not during a worship service unless the client expressly authorizes it.',
    'A Sunday-service approach can be treated as harassment; document office-hour attempts first.',
  ]) : null,
  ({ venue }) => venue === 'storage' ? feat('venue.storage', 'venue', 'Self-Storage', [
    'The facility office can confirm whether the unit renter matches. They are not the recipient unless named.',
    'Do not wait at a locked gate for a renter to punch a code — that is not a completed attempt at the unit.',
  ]) : null,
  ({ venue }) => venue === 'apartment_complex' ? feat('venue.apartment_complex', 'venue', 'Apartment Complex', [
    'If the packet is a UNIT: go to the unit, not the leasing office, unless the named party is management.',
    'Leasing office may confirm occupancy ONLY — never disclose case details. Gate/call-box codes go in the attempt log.',
  ]) : null,
  ({ venue }) => venue === 'high_rise' ? feat('venue.high_rise', 'venue', 'High-Rise / Multi-Tenant', [
    'Use the suite directory. Photograph the directory if the entity is missing — that supports skip trace / vacated.',
    'Lobby security is not an authorized recipient. Ask them to call the suite; note the name of whoever comes down.',
  ]) : null,
  ({ venue }) => venue === 'military' ? feat('venue.military', 'venue', 'Military / Restricted', [
    'Do not enter a restricted installation without sponsorship. Coordinate with the visitor center / JAG / command legal.',
    'On-post service of civil papers is often coordinated — report a gate refusal as diligence, do not force entry.',
  ]) : null,
  ({ venue }) => venue === 'construction' ? feat('venue.construction', 'venue', 'Construction Site', [
    'Serve at the job-site trailer / GC office. A worker on a roof is not a safe or lawful service contact.',
    'PPE and site rules: stay in the office. Photograph posted contractor signage for the affidavit.',
  ]) : null,
  ({ venue }) => venue === 'rural' ? feat('venue.rural', 'venue', 'Rural / Farm / Acreage', [
    'Long driveways and dogs are common. Announce from the vehicle if a gate is closed; do not climb fences.',
    'GPS + a photograph of the mailbox/gate are the diligence record when the house is not visible from the road.',
  ]) : null,

  ({ h }) => includesAny(h, ['summons', 'complaint']) ? feat('paper.summons_complaint', 'paper', 'Summons / Complaint', [
    'Answer clock: 21 days if served in Utah, 30 days if served out of state (URCP 12(a)). Clock starts on the date of service.',
    'Do not advise the recipient beyond what is printed on the summons.',
  ]) : null,
  ({ h }) => h.includes('subpoena') ? feat('paper.subpoena', 'paper', 'Subpoena', [
    'URCP 45: confirm whether witness fees must be tendered at service. Arriving without a listed fee fails the attempt.',
  ]) : null,
  ({ h }) => includesAny(h, ['evict', 'unlawful detainer', 'notice to quit', 'notice to vacate']) ? feat('paper.eviction', 'paper', 'Eviction / UD', [
    'Occupant may be distressed or mid-move. De-escalate; do not discuss case merits.',
    'Post-and-mail ONLY if the court authorized alternative service — verify the order before posting.',
  ]) : null,
  ({ h }) => includesAny(h, ['restrain', 'protective order', 'protection order', 'no contact', 'stalking injunction']) ? feat('paper.protective_order', 'paper', 'Protective / Restraining Order', [
    'Do NOT stage or serve in the presence of the protected party. Time the approach to avoid contact between parties.',
    'HIGH caution: two-officer when available. The paper is not worth an escalation.',
  ]) : null,
  ({ h }) => h.includes('garnish') ? feat('paper.garnishment', 'paper', 'Garnishment', [
    'Serve the garnishee (employer/bank) through its authorized agent. Record exact time — interrogatory deadlines run from service.',
  ]) : null,
  ({ h }) => includesAny(h, ['injunction', 'temporary restraining', 'tro', 'ex-parte', 'ex parte']) ? feat('paper.injunction', 'paper', 'Injunction / TRO', [
    'Ex-parte / TRO packets are time-critical. Confirm every listed order is in the physical packet before departing.',
    'Do not interpret the injunction for the recipient — refer to the issuing court or hiring attorney.',
  ]) : null,
  ({ h }) => includesAny(h, ['expedited discovery', 'order allowing discovery']) ? feat('paper.expedited_discovery', 'paper', 'Expedited Discovery Order', [
    'Discovery orders in the packet must travel with the summons. Confirm exhibits/attachments are physically present.',
  ]) : null,

  ({ input }) => get(input.fields, 'witness_fee_instrument') ? feat('packet.witness_fee', 'packet', 'Witness Fee Instrument', [
    `CARRY WITH YOU: ${get(input.fields, 'witness_fee_instrument')} — tender at service. Arriving without it fails the attempt.`,
  ]) : null,
  ({ h }) => includesAny(h, ['bilingual', 'spanish notice', 'aviso']) ? feat('packet.bilingual', 'packet', 'Bilingual Notice', [
    'Serve the complete packet including the translated notice. Do not serve the English set alone.',
  ]) : null,
  ({ input }) => {
    const docs = (get(input.fields, 'documents_to_serve') || '').split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
    return (docs.length > 1 || input.docCount > 1)
      ? feat('packet.multi_document', 'packet', 'Multi-Document Packet', [
        `Confirm every listed item is in hand (${docs.length || input.docCount} titles / ${input.docCount} files). A missing exhibit is a failed service.`,
      ])
      : null;
  },
  ({ h }) => includesAny(h, ['registered agent', 'registered-agent']) ? feat('packet.registered_agent', 'packet', 'Registered-Agent Service', [
    'Ask for the registered agent by name. Note the full name AND title of whoever accepts — "authorized to accept" must be supportable.',
    'If serving at a residence of the agent: personal delivery to the agent or an owner/member only.',
  ]) : null,

  ({ input }) => {
    const court = (input.queueRow.jurisdiction || '').trim().toUpperCase();
    const svc = (input.queueRow.recipient_state || '').trim().toUpperCase();
    const ok = /^[A-Z]{2}$/;
    if (ok.test(court) && ok.test(svc) && court !== svc) {
      return feat('legal.out_of_state_court', 'legal', 'Out-of-State Issuing Court', [
        `Issuing court ${court} / service in ${svc}. Confirm domestication (UIDDA) with the hiring party before attempting a subpoena.`,
      ]);
    }
    return null;
  },
  ({ h, input }) => {
    const target = (input.queueRow.recipient_name || '').toLowerCase();
    const p = (input.queueRow.plaintiff || '').toLowerCase();
    const d = (input.queueRow.defendant || '').toLowerCase();
    if (!target || target.split(/\s+/).length < 2) return null;
    if (p.includes(target) || d.includes(target)) return null;
    if (!p && !d) return null;
    return feat('legal.non_party', 'legal', 'Non-Party Recipient', [
      `${input.queueRow.recipient_name} does not match a named party string — typical for a subpoena. Do not discuss the case.`,
    ]);
  },
  ({ input }) => input.isBusiness || !!input.agentName
    ? feat('legal.entity_service', 'legal', 'Entity / Corporate Service', [
      'URCP 4(d)(1)(E): officer, managing/general agent, registered agent, or employee 18+ expressly authorized at the business location.',
    ])
    : null,
  ({ h }) => /do not serve on sunday|no service on sunday|no sundays|not on sunday/i.test(h)
    ? feat('legal.no_sunday', 'legal', 'No-Sunday Restriction', [
      'Client forbids Sunday service. Do not schedule or complete an attempt on Sunday. Log "client-imposed day restriction" if you arrive in error.',
    ])
    : null,
  ({ h }) => includesAny(h, ['anyone authorized', 'authorized to accept', 'any employee'])
    ? feat('legal.broad_acceptors', 'legal', 'Broad Authorized-Acceptor Instruction', [
      'Client authorizes service on anyone authorized to accept for the entity. Still record name AND title for the affidavit.',
    ])
    : null,
  ({ input }) => (get(input.fields, 'sub_service_authorized_first_attempt') || '').toLowerCase() === 'yes'
    ? feat('legal.subservice_first', 'legal', 'Substitute Service Authorized 1st Attempt', [
      'Client expressly permits substitute service on the first attempt. Still confirm the substitute actually resides there and record relationship + description.',
    ])
    : null,
  ({ h }) => includesAny(h, ['place of employment', 'employment only', 'do not serve at home'])
    ? feat('legal.employment_only', 'legal', 'Employment-Only Service', [
      'Client restricts service to the workplace. Do not attempt at a residence unless the hiring party lifts the restriction in writing.',
    ])
    : null,

  ({ input }) => input.addressClass === 'gated' || input.gateCode
    ? feat('access.gated', 'access', 'Gated / Controlled Access', [
      input.gateCode
        ? `Gate/call-box code on file: ${input.gateCode} — verify it still works; a changed code is not a failed identity check.`
        : 'Gated access: use the call box, do not tailgate a resident vehicle. Note how you gained entry.',
    ])
    : null,
  ({ input }) => input.addressClass === 'po_box' ? feat('access.po_box', 'access', 'PO Box — Not a Service Address', [
    'A PO box is not a lawful place of personal service. Identify the physical street address and re-plan.',
  ]) : null,
  ({ input }) => input.dogsOnSite || /\b(dog|canine|aggressive animal)\b/i.test(input.hazardNotes || '')
    ? feat('access.animal_hazard', 'access', 'Animal / Dog Hazard On File', [
      input.hazardNotes
        ? `Property hazard notes: ${input.hazardNotes}. Approach from cover; do not reach over a fence.`
        : 'Dogs flagged on this job. Approach from cover; do not reach over a fence. Announce from the vehicle if a gate is closed.',
    ])
    : null,
  ({ input }) => input.camerasOnSite
    ? feat('access.cameras', 'access', 'Cameras / Recording On Site', [
      'Treat the approach as recorded. Stay professional, do not discuss case merits on camera, and photograph posted recording notices for the file.',
    ])
    : null,
  ({ input }) => (input.physicalDescription || '').trim()
    ? feat('identity.description', 'identity', 'Subject Description On File', [
      `Match before tender: ${input.physicalDescription}. If they do not match, do not serve — log a failed identity check.`,
    ])
    : null,
  ({ h }) => includesAny(h, ['gate code', 'call box', 'buzzer', 'buzz unit'])
    ? feat('access.callbox_language', 'access', 'Call-Box / Buzzer In Packet', [
      'Packet mentions a call box or buzzer. Use it; document the unit you rang and who answered.',
    ])
    : null,

  ({ input }) => {
    if (!input.queueRow.deadline) return null;
    const d = daysUntil(input.queueRow.deadline, input.nowIso);
    if (d <= 0) {
      return feat('timeline.past_due', 'timeline', 'Deadline Past Due', [
        'Service deadline is PAST DUE. Attempt immediately and notify the hiring party — do not silently sit in queue.',
      ]);
    }
    if (d <= 1) {
      return feat('timeline.same_day', 'timeline', 'Same-Day / 24h Deadline', [
        'Deadline is today or tomorrow. Front-load the first attempt this shift. Notify the hiring party if you cannot complete personal service today.',
      ]);
    }
    return null;
  },
  ({ input }) => (input.queueRow.priority === 'urgent' || input.queueRow.priority === 'rush')
    ? feat('timeline.escalated_priority', 'timeline', 'Rush / Urgent Priority', [
      `Priority ${input.queueRow.priority.toUpperCase()}: do not let this packet sit beyond this shift.`,
    ])
    : null,

  ({ input }) => {
    const dob = get(input.fields, 'recipient_dob');
    if (!dob) return null;
    const y = parseInt(dob.slice(0, 4), 10);
    const nowY = parseInt(input.nowIso.slice(0, 4), 10);
    if (!y || nowY - y >= 18) return null;
    return feat('identity.possible_minor', 'identity', 'Possible Minor Recipient', [
      'DOB on file indicates a possible minor. A minor is not of suitable age and discretion for substitute service. Confirm with the hiring party before substitute-serving.',
    ]);
  },
  ({ h }) => includesAny(h, ['aka', 'a/k/a', 'also known as', 'fka'])
    ? feat('identity.aka', 'identity', 'AKA / Alias On Packet', [
      'Packet lists an AKA. Confirm identity against all names before tendering. Record which name they acknowledged.',
    ])
    : null,
];

function feat(id: string, branch: TreeBranch, label: string, playbook: string[]): TreeFeature {
  return { id, branch, label, playbook };
}

export const OUTPUT_TREE_CATALOG_SIZE = DETECTORS.length;

export function buildOutputTree(input: TreeBuildInput): OutputTree {
  const inferred = inferVenueKind(
    input.fullLocation,
    input.queueRow.recipient_name || get(input.fields, 'recipient_business_name'),
    input.queueRow.service_instructions,
  );
  const venue = input.venueOverride != null ? input.venueOverride : inferred;
  const h = haystack(input);
  const features: TreeFeature[] = [];
  for (const det of DETECTORS) {
    const hit = det({ h, input, venue });
    if (hit) features.push(hit);
  }
  return {
    locationClass: input.addressClass,
    locationLabel: addressClassLabel(input.addressClass) + (input.addressClassConfirmed ? ' (confirmed)' : ''),
    venue,
    venueLabel: VENUE_LABELS[venue],
    catalogSize: DETECTORS.length,
    firedIds: features.map((f) => f.id),
    features,
  };
}

export function renderOutputTreeNote(tree: OutputTree): string {
  const lines: string[] = [];
  lines.push('**PROCESS SERVICE — OPERATIONAL PLAYBOOK** *(auto-generated)*');
  lines.push('**■ OUTPUT TREE**');
  lines.push(`Location class: ${tree.locationLabel}`);
  lines.push(`Venue overlay: ${tree.venueLabel}`);
  lines.push(`Dynamics fired: ${tree.features.length} of ${tree.catalogSize} catalog rules (evidence-gated — silent rules are omitted).`);
  const byBranch = new Map<TreeBranch, TreeFeature[]>();
  for (const f of tree.features) {
    const list = byBranch.get(f.branch) ?? [];
    list.push(f);
    byBranch.set(f.branch, list);
  }
  const order: TreeBranch[] = ['venue', 'paper', 'packet', 'legal', 'access', 'timeline', 'identity', 'safety'];
  for (const branch of order) {
    const list = byBranch.get(branch);
    if (!list?.length) continue;
    lines.push(`**■ ${branch.toUpperCase()}**`);
    for (const f of list) {
      lines.push(`├─ ${f.label}  [${f.id}]`);
      for (const p of f.playbook) lines.push(`│    • ${p}`);
    }
  }
  lines.push('**■ TREE FOOTER**');
  lines.push('Unfired catalog rules stayed silent on purpose. Do not treat absence as authorization.');
  return lines.join('\n');
}
