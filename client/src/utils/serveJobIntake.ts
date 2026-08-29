// Client-side parse of serve_queue.parsed_data (_intake + _ops).
// Mirrors src/utils/serveJobOps.ts — Worker and client packages do not share a build.

export const ADDRESS_CLASS_OPTIONS = [
  ['residential', 'Residential'],
  ['corporate', 'Corporate'],
  ['small_business', 'Small Biz'],
  ['government', 'Government'],
  ['business', 'Business'],
  ['gated', 'Gated / HOA'],
  ['po_box', 'PO Box'],
  ['unknown', 'Unknown'],
] as const;

export const VENUE_OPTIONS = [
  ['', 'Auto (infer from address / name)'],
  ['none', 'None (class only)'],
  ['medical_hospice', 'Medical / Hospice'],
  ['hospital', 'Hospital'],
  ['nursing_home', 'Nursing / Assisted Living'],
  ['financial', 'Bank / Financial'],
  ['law_office', 'Law Office'],
  ['school', 'School / Campus'],
  ['hotel', 'Hotel / Lodging'],
  ['warehouse', 'Warehouse / Industrial'],
  ['church', 'House of Worship'],
  ['storage', 'Self-Storage'],
  ['apartment_complex', 'Apartment Complex'],
  ['high_rise', 'High-Rise / Office'],
  ['military', 'Military / Restricted'],
  ['construction', 'Construction Site'],
  ['rural', 'Rural / Farm'],
] as const;

export interface ServeJobOps {
  documents_to_serve: string;
  venue_kind: string;
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

export interface ServeJobWindow {
  window: string;
  authority?: string;
  focus?: string;
}

export interface ServeJobMeta {
  addressClass: string;
  addressClassConfirmed: boolean;
  venue: string | null;
  venueLabel: string | null;
  ops: ServeJobOps;
  firedIds: string[];
  windows: ServeJobWindow[];
}

function asBool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 'true';
}

export function parseServeJobMeta(parsedData?: string | null): ServeJobMeta {
  let pd: Record<string, unknown> = {};
  if (typeof parsedData === 'string' && parsedData.trim()) {
    try { pd = JSON.parse(parsedData) as Record<string, unknown>; } catch { pd = {}; }
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
  const windows = Array.isArray(tree.windows)
    ? (tree.windows as unknown[]).flatMap((w) => {
      if (!w || typeof w !== 'object') return [];
      const o = w as Record<string, unknown>;
      if (typeof o.window !== 'string') return [];
      return [{
        window: o.window,
        authority: typeof o.authority === 'string' ? o.authority : undefined,
        focus: typeof o.focus === 'string' ? o.focus : undefined,
      }];
    })
    : [];
  const opsRaw = (pd._ops && typeof pd._ops === 'object') ? pd._ops as Record<string, unknown> : {};
  const venue = typeof intake.venue === 'string' ? intake.venue
    : typeof tree.venue === 'string' ? tree.venue
    : null;
  const venueLabel = typeof tree.venue_label === 'string' ? tree.venue_label : null;
  return {
    addressClass: typeof ac.klass === 'string' ? ac.klass : 'unknown',
    addressClassConfirmed: asBool(ac.confirmed),
    venue,
    venueLabel,
    firedIds: fired,
    windows,
    ops: {
      documents_to_serve: typeof opsRaw.documents_to_serve === 'string' ? opsRaw.documents_to_serve : '',
      venue_kind: typeof opsRaw.venue_kind === 'string' ? opsRaw.venue_kind : '',
      gate_code: typeof opsRaw.gate_code === 'string' ? opsRaw.gate_code : '',
      dogs_on_site: asBool(opsRaw.dogs_on_site),
      cameras_on_site: asBool(opsRaw.cameras_on_site),
      language_needed: typeof opsRaw.language_needed === 'string' ? opsRaw.language_needed : '',
      authorized_acceptor: typeof opsRaw.authorized_acceptor === 'string' ? opsRaw.authorized_acceptor : '',
      photo_required: asBool(opsRaw.photo_required),
      physical_description: typeof opsRaw.physical_description === 'string' ? opsRaw.physical_description : '',
      vehicle_description: typeof opsRaw.vehicle_description === 'string' ? opsRaw.vehicle_description : '',
      best_contact_window: typeof opsRaw.best_contact_window === 'string' ? opsRaw.best_contact_window : '',
      no_sunday: asBool(opsRaw.no_sunday),
      no_saturday: asBool(opsRaw.no_saturday),
      sub_service_first: asBool(opsRaw.sub_service_first),
    },
  };
}
