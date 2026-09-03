// ============================================================
// Serve Job operational fields + live preview
// ============================================================
// Operator-entered scene data lives in parsed_data._ops so we do not
// burn D1 columns. Preview rebuilds venue / windows / output tree from
// the current form without waiting for a re-commit.

import type { AddressClass } from './serveAddressClass';
import { coerceAddressClass } from './serveAddressClass';
import type { QueueRow } from './serveIntakeExtract';
import { selectWindows, type WindowSpec } from './serveAttemptWindows';
import {
  VENUE_KINDS,
  VENUE_LABELS,
  buildOutputTree,
  inferVenueKind,
  renderOutputTreeNote,
  type OutputTree,
  type VenueKind,
} from './serveIntakeOutputTree';

export interface ServeJobOps {
  documents_to_serve: string;
  venue_kind: '' | VenueKind;
  gate_code: string;
  dogs_on_site: boolean;
  cameras_on_site: boolean;
  language_needed: string;
  authorized_acceptor: string;
  photo_required: boolean;
  physical_description: string;
  vehicle_description: string;
  best_contact_window: string;
  no_sunday: boolean;
  no_saturday: boolean;
  sub_service_first: boolean;
}

export const EMPTY_SERVE_JOB_OPS: ServeJobOps = {
  documents_to_serve: '',
  venue_kind: '',
  gate_code: '',
  dogs_on_site: false,
  cameras_on_site: false,
  language_needed: '',
  authorized_acceptor: '',
  photo_required: false,
  physical_description: '',
  vehicle_description: '',
  best_contact_window: '',
  no_sunday: false,
  no_saturday: false,
  sub_service_first: false,
};

export interface ServeOpsPreviewInput {
  addressClass?: string | null;
  addressClassConfirmed?: boolean;
  recipient_name?: string | null;
  recipient_address?: string | null;
  recipient_city?: string | null;
  recipient_state?: string | null;
  recipient_zip?: string | null;
  recipient_type?: string | null;
  business_name?: string | null;
  registered_agent_name?: string | null;
  document_type?: string | null;
  case_number?: string | null;
  court_name?: string | null;
  jurisdiction?: string | null;
  client_name?: string | null;
  attorney_name?: string | null;
  priority?: string | null;
  deadline?: string | null;
  service_instructions?: string | null;
  notes?: string | null;
  plaintiff_name?: string | null;
  defendant_name?: string | null;
  court_date?: string | null;
  ops?: Partial<ServeJobOps> | null;
  nowIso?: string;
}

export interface ServeOpsPreview {
  addressClass: AddressClass;
  addressClassConfirmed: boolean;
  venue: VenueKind;
  venueInferred: VenueKind;
  venueLabel: string;
  windows: WindowSpec[];
  tree: OutputTree;
  note: string;
  ops: ServeJobOps;
}

function asBool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 'true';
}

export function coerceVenueKind(raw: unknown): VenueKind | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return null;
  return (VENUE_KINDS as readonly string[]).includes(s) ? (s as VenueKind) : null;
}

export function normalizeServeJobOps(raw: unknown): ServeJobOps {
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const venue = coerceVenueKind(o.venue_kind);
  return {
    documents_to_serve: typeof o.documents_to_serve === 'string' ? o.documents_to_serve : '',
    venue_kind: venue ?? '',
    gate_code: typeof o.gate_code === 'string' ? o.gate_code : '',
    dogs_on_site: asBool(o.dogs_on_site),
    cameras_on_site: asBool(o.cameras_on_site),
    language_needed: typeof o.language_needed === 'string' ? o.language_needed : '',
    authorized_acceptor: typeof o.authorized_acceptor === 'string' ? o.authorized_acceptor : '',
    photo_required: asBool(o.photo_required),
    physical_description: typeof o.physical_description === 'string' ? o.physical_description : '',
    vehicle_description: typeof o.vehicle_description === 'string' ? o.vehicle_description : '',
    best_contact_window: typeof o.best_contact_window === 'string' ? o.best_contact_window : '',
    no_sunday: asBool(o.no_sunday),
    no_saturday: asBool(o.no_saturday),
    sub_service_first: asBool(o.sub_service_first),
  };
}

export function parseServeParsedData(raw: string | null | undefined): {
  addressClass: AddressClass;
  addressClassConfirmed: boolean;
  venue: VenueKind | null;
  ops: ServeJobOps;
  firedIds: string[];
} {
  let pd: Record<string, unknown> = {};
  if (typeof raw === 'string' && raw.trim()) {
    try { pd = JSON.parse(raw) as Record<string, unknown>; } catch { pd = {}; }
  }
  const intake = (pd._intake && typeof pd._intake === 'object')
    ? pd._intake as Record<string, unknown>
    : {};
  const ac = (intake.address_class && typeof intake.address_class === 'object')
    ? intake.address_class as Record<string, unknown>
    : {};
  const tree = (intake.output_tree && typeof intake.output_tree === 'object')
    ? intake.output_tree as Record<string, unknown>
    : {};
  const fired = Array.isArray(tree.fired_ids)
    ? (tree.fired_ids as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  return {
    addressClass: coerceAddressClass(typeof ac.klass === 'string' ? ac.klass : null) ?? 'unknown',
    addressClassConfirmed: asBool(ac.confirmed),
    venue: coerceVenueKind(intake.venue) ?? coerceVenueKind(tree.venue),
    ops: normalizeServeJobOps(pd._ops),
    firedIds: fired,
  };
}

function toQueueRow(input: ServeOpsPreviewInput, ops: ServeJobOps): QueueRow {
  const prio = input.priority;
  const priority = (prio === 'urgent' || prio === 'rush' || prio === 'routine' || prio === 'normal')
    ? prio
    : 'normal';
  const instr = [
    input.service_instructions,
    ops.no_sunday ? 'DO NOT SERVE ON SUNDAYS.' : '',
    ops.authorized_acceptor ? `YOU CAN SERVE ${ops.authorized_acceptor || 'ANYONE AUTHORIZED TO ACCEPT SERVICE'}.` : '',
    ops.best_contact_window ? `Best window: ${ops.best_contact_window}` : '',
  ].filter(Boolean).join(' ');
  return {
    recipient_name: input.recipient_name ?? null,
    recipient_address: input.recipient_address ?? null,
    recipient_city: input.recipient_city ?? null,
    recipient_state: input.recipient_state ?? null,
    recipient_zip: input.recipient_zip ?? null,
    document_type: input.document_type ?? null,
    case_number: input.case_number ?? null,
    court_name: input.court_name ?? null,
    jurisdiction: input.jurisdiction ?? null,
    client_name: input.client_name ?? null,
    attorney_name: input.attorney_name ?? null,
    priority,
    deadline: input.deadline ?? null,
    service_instructions: instr || null,
    notes: input.notes ?? null,
    plaintiff: input.plaintiff_name ?? null,
    defendant: input.defendant_name ?? null,
    court_date: input.court_date ?? null,
    sm_job_id: null,
    recipient_phone: null,
    recipient_dob: null,
    recipient_type: input.recipient_type === 'business' ? 'business' : input.recipient_type === 'individual' ? 'individual' : null,
    business_name: input.business_name ?? null,
    registered_agent_name: input.registered_agent_name ?? null,
    registered_office_address: null,
    attorney_phone: null,
    attorney_email: null,
    attorney_bar_number: null,
    serve_type: null,
    serve_fee: null,
    time_window: null,
  };
}

export function previewServeOps(input: ServeOpsPreviewInput): ServeOpsPreview {
  const ops = normalizeServeJobOps(input.ops);
  const addressClass = coerceAddressClass(input.addressClass) ?? 'unknown';
  const confirmed = !!input.addressClassConfirmed;
  const isBusiness = input.recipient_type === 'business' || !!input.business_name
    || addressClass === 'corporate' || addressClass === 'small_business' || addressClass === 'government';
  const fullLocation = [input.recipient_address, input.recipient_city, input.recipient_state, input.recipient_zip]
    .filter(Boolean).join(', ');
  const venueInferred = inferVenueKind(
    fullLocation,
    input.recipient_name || input.business_name,
    input.service_instructions,
  );
  const venueOverride = ops.venue_kind ? (ops.venue_kind as VenueKind) : null;
  const docs = ops.documents_to_serve.trim();
  const titles = docs.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
  const queueRow = toQueueRow(input, ops);
  const tree = buildOutputTree({
    addressClass,
    addressClassConfirmed: confirmed,
    isBusiness,
    fields: {
      documents_to_serve: { value: docs, confidence: 1 },
      ...(ops.sub_service_first ? { sub_service_authorized_first_attempt: { value: 'yes', confidence: 1 } } : {}),
    },
    queueRow,
    agentName: input.registered_agent_name || '',
    fullLocation,
    docCount: Math.max(1, titles.length),
    nowIso: input.nowIso || new Date().toISOString(),
    gateCode: ops.gate_code || null,
    venueOverride,
    dogsOnSite: ops.dogs_on_site,
    camerasOnSite: ops.cameras_on_site,
    noSunday: ops.no_sunday,
    authorizedAcceptor: ops.authorized_acceptor || null,
    languageNeeded: ops.language_needed || null,
    physicalDescription: ops.physical_description || null,
  });
  const windows = selectWindows({
    addressClass,
    addressClassConfirmed: confirmed,
    clientBands: [],
    locationNote: null,
    venueKind: tree.venue,
  });
  return {
    addressClass,
    addressClassConfirmed: confirmed,
    venue: tree.venue,
    venueInferred,
    venueLabel: VENUE_LABELS[tree.venue],
    windows,
    tree,
    note: renderOutputTreeNote(tree),
    ops,
  };
}

export function intakePatchFromPreview(
  existingParsed: string | null | undefined,
  preview: ServeOpsPreview,
): string {
  let pd: Record<string, unknown> = {};
  if (typeof existingParsed === 'string' && existingParsed.trim()) {
    try { pd = JSON.parse(existingParsed) as Record<string, unknown>; } catch { pd = {}; }
  }
  const intake = (pd._intake && typeof pd._intake === 'object')
    ? { ...(pd._intake as Record<string, unknown>) }
    : {};
  const prevAc = (intake.address_class && typeof intake.address_class === 'object')
    ? intake.address_class as Record<string, unknown>
    : {};
  intake.address_class = {
    ...prevAc,
    klass: preview.addressClass,
    confirmed: preview.addressClassConfirmed,
  };
  intake.venue = preview.venue;
  intake.output_tree = {
    venue: preview.tree.venue,
    venue_label: preview.tree.venueLabel,
    catalog_size: preview.tree.catalogSize,
    fired_ids: preview.tree.firedIds,
    fired_count: preview.tree.features.length,
    windows: preview.windows.map((w) => ({ window: w.window, authority: w.authority, focus: w.focus })),
  };
  pd._intake = intake;
  pd._ops = preview.ops;
  return JSON.stringify(pd);
}
