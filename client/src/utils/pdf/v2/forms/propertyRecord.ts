import type { FormSchema } from '../engine/types';
import { toDisplayLabel } from '../../../formatters';
import { parseTimestamp } from '../../../dateUtils';

export interface PropertyRecordData {
  id?: number | string;
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  property_type?: string;
  client_name?: string;
  // Assessor-sourced
  parcel_number?: string;
  owner_of_record?: string;
  owner_type?: string;
  owner_mailing_address?: string;
  total_market_value?: string | number;
  land_sqft?: string | number;
  last_sale_date?: string;
  last_sale_price?: string | number;
  legal_description?: string;
  tax_district?: string;
  assessor_last_synced_at?: string;
  // Property details
  year_built?: string | number;
  square_footage?: string | number;
  number_of_stories?: string | number;
  structure_type?: string;
  occupancy_status?: string;
  business_type?: string;
  // Security
  gate_code?: string;
  alarm_code?: string;
  alarm_system?: string;
  alarm_company?: string;
  alarm_account?: string;
  camera_system?: string;
  security_features?: string;
  access_instructions?: string;
  // Contacts
  key_holder_name?: string;
  key_holder_phone?: string;
  key_holder_relationship?: string;
  owner_name?: string;
  owner_phone?: string;
  emergency_contact?: string;
  contact_email?: string;
  secondary_contact_name?: string;
  secondary_contact_phone?: string;
  // Operations
  opening_hours?: string;
  closing_hours?: string;
  patrol_frequency?: string;
  roof_access?: string;
  parking_info?: string;
  utility_shutoffs?: string;
  hazard_notes?: string;
  post_orders?: string;
  notes?: string;
  is_active?: boolean | number;
  // Dispatch geography
  sector_id?: string;
  zone_id?: string;
  beat_id?: string;
  // Cross-referenced data (enriched by PrintRecordButton)
  calls?: Array<{ call_number?: string; incident_type?: string; status?: string; created_at?: string }>;
  trespass_orders?: Array<{ order_number?: string; subject_name?: string; status?: string; issued_date?: string; expires_date?: string }>;
  linked_persons?: Array<{ name?: string; relationship?: string }>;
  linked_vehicles?: Array<{ license_plate?: string; make?: string; model?: string; year?: string; color?: string; relationship?: string }>;
}

const safe = (v: unknown, dash = '—'): string =>
  v === null || v === undefined || v === '' ? dash : String(v);

const currency = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
};

const sqft = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return `${n.toLocaleString('en-US')} sq ft`;
};

export const propertyRecordSchema: FormSchema<PropertyRecordData> = {
  meta: { formNumber: 'FORM PR', title: 'Property Record', revision: '2026-08' },
  header: {
    kind: 'default',
    formId: 'property_record',
    caseLabel: 'RECORD',
    caseNumberAccessor: (d) => d.id ? `PR-${d.id}` : undefined,
  },
  sections: [
    (ctx, data) => {
      ctx.section('Property Identification', (inner) => {
        inner.labeledField({ kind: 'labeled', label: 'Property Name', accessor: (d) => safe(d.name), width: 'full' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Street Address', accessor: (d) => safe(d.address), width: 'full' }, data);
        inner.labeledField({ kind: 'labeled', label: 'City', accessor: (d) => safe(d.city), width: 'third' }, data);
        inner.labeledField({ kind: 'labeled', label: 'State', accessor: (d) => safe(d.state), width: 'third' }, data);
        inner.labeledField({ kind: 'labeled', label: 'ZIP', accessor: (d) => safe(d.zip), width: 'third' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Property Type', accessor: (d) => toDisplayLabel(safe(d.property_type, '')), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Business / Use Type', accessor: (d) => toDisplayLabel(safe(d.business_type, '')), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Status', accessor: (d) => (d.is_active == null || d.is_active === 1 || d.is_active === true) ? 'Active' : 'Inactive', width: 'third' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Client', accessor: (d) => safe(d.client_name), width: 'third' }, data);
        if (data.parcel_number) {
          inner.labeledField({ kind: 'labeled', label: 'APN / Parcel Number', accessor: (d) => safe(d.parcel_number), width: 'third' }, data);
        }
      });

      ctx.section('Ownership (Assessor of Record)', (inner) => {
        inner.labeledField({ kind: 'labeled', label: 'Owner of Record', accessor: (d) => safe(d.owner_of_record), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Owner Type', accessor: (d) => toDisplayLabel(safe(d.owner_type, '')), width: 'half' }, data);
        if (data.owner_mailing_address) {
          inner.labeledField({ kind: 'labeled', label: 'Mailing Address', accessor: (d) => safe(d.owner_mailing_address), width: 'full' }, data);
        }
      });

      ctx.section('Property Details', (inner) => {
        inner.labeledField({ kind: 'labeled', label: 'Year Built', accessor: (d) => safe(d.year_built), width: 'quarter' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Square Footage', accessor: (d) => sqft(d.square_footage), width: 'quarter' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Lot Size', accessor: (d) => sqft(d.land_sqft), width: 'quarter' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Stories', accessor: (d) => safe(d.number_of_stories), width: 'quarter' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Structure Type', accessor: (d) => toDisplayLabel(safe(d.structure_type, '')), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Occupancy Status', accessor: (d) => toDisplayLabel(safe(d.occupancy_status, '')), width: 'half' }, data);
      });

      ctx.section('Valuation', (inner) => {
        inner.labeledField({ kind: 'labeled', label: 'Total Market Value', accessor: (d) => currency(d.total_market_value), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Tax District', accessor: (d) => safe(d.tax_district), width: 'half' }, data);
        if (data.last_sale_date) {
          inner.labeledField({ kind: 'labeled', label: 'Last Sale Date', accessor: (d) => safe(d.last_sale_date), width: 'half' }, data);
          inner.labeledField({ kind: 'labeled', label: 'Last Sale Price', accessor: (d) => currency(d.last_sale_price), width: 'half' }, data);
        }
        if (data.legal_description) {
          inner.labeledField({ kind: 'labeled', label: 'Legal Description', accessor: (d) => safe(d.legal_description), width: 'full' }, data);
        }
        if (data.assessor_last_synced_at) {
          inner.labeledField({ kind: 'labeled', label: 'Assessor Last Synced', accessor: (d) => safe(d.assessor_last_synced_at), width: 'half' }, data);
        }
      });

      ctx.section('Security', (inner) => {
        inner.labeledField({ kind: 'labeled', label: 'Gate Code', accessor: (d) => safe(d.gate_code), width: 'quarter' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Alarm Code', accessor: (d) => safe(d.alarm_code), width: 'quarter' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Alarm Company', accessor: (d) => safe(d.alarm_company), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Alarm Account #', accessor: (d) => safe(d.alarm_account), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Alarm System', accessor: (d) => toDisplayLabel(safe(d.alarm_system, '')), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Camera System', accessor: (d) => safe(d.camera_system), width: 'full' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Security Features', accessor: (d) => safe(d.security_features), width: 'full' }, data);
        if (data.access_instructions) {
          inner.narrative({ kind: 'narrative', label: 'Access Instructions', accessor: (d) => safe(d.access_instructions, ''), minLines: 2 }, data);
        }
      });

      ctx.section('Contacts', (inner) => {
        inner.labeledField({ kind: 'labeled', label: 'Key Holder', accessor: (d) => safe(d.key_holder_name), width: 'third' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Key Holder Phone', accessor: (d) => safe(d.key_holder_phone), width: 'third' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Relationship', accessor: (d) => safe(d.key_holder_relationship), width: 'third' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Owner / Manager', accessor: (d) => safe(d.owner_name), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Owner Phone', accessor: (d) => safe(d.owner_phone), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Emergency Contact', accessor: (d) => safe(d.emergency_contact), width: 'full' }, data);
        if (data.contact_email || data.secondary_contact_name) {
          inner.labeledField({ kind: 'labeled', label: 'Contact Email', accessor: (d) => safe(d.contact_email), width: 'half' }, data);
          inner.labeledField({ kind: 'labeled', label: 'Secondary Contact', accessor: (d) => safe(d.secondary_contact_name), width: 'half' }, data);
          if (data.secondary_contact_phone) {
            inner.labeledField({ kind: 'labeled', label: 'Secondary Phone', accessor: (d) => safe(d.secondary_contact_phone), width: 'half' }, data);
          }
        }
      });

      ctx.section('Operations', (inner) => {
        inner.labeledField({ kind: 'labeled', label: 'Opening Hours', accessor: (d) => safe(d.opening_hours), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Closing Hours', accessor: (d) => safe(d.closing_hours), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Patrol Frequency', accessor: (d) => toDisplayLabel(safe(d.patrol_frequency, '')), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Roof Access', accessor: (d) => safe(d.roof_access), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Parking', accessor: (d) => safe(d.parking_info), width: 'full' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Utility Shutoffs', accessor: (d) => safe(d.utility_shutoffs), width: 'full' }, data);
        // Dispatch geography
        if (data.sector_id || data.zone_id || data.beat_id) {
          inner.labeledField({ kind: 'labeled', label: 'Sector', accessor: (d) => safe(d.sector_id), width: 'third' }, data);
          inner.labeledField({ kind: 'labeled', label: 'Zone', accessor: (d) => safe(d.zone_id), width: 'third' }, data);
          inner.labeledField({ kind: 'labeled', label: 'Beat', accessor: (d) => safe(d.beat_id), width: 'third' }, data);
        }
      });

      if (data.hazard_notes) {
        ctx.section('Hazard Notes', (inner) => {
          inner.narrative({ kind: 'narrative', label: '', accessor: (d) => safe(d.hazard_notes, ''), minLines: 2 }, data);
        });
      }

      if (data.post_orders) {
        ctx.section('Post Orders', (inner) => {
          inner.narrative({ kind: 'narrative', label: '', accessor: (d) => safe(d.post_orders, ''), minLines: 3 }, data);
        });
      }

      if (data.notes) {
        ctx.section('Additional Notes', (inner) => {
          inner.narrative({ kind: 'narrative', label: '', accessor: (d) => safe(d.notes, ''), minLines: 2 }, data);
        });
      }

      if (data.linked_persons && data.linked_persons.length > 0) {
        ctx.section(`Associated Persons (${data.linked_persons.length})`, (inner) => {
          inner.table({
            kind: 'table',
            label: '',
            columns: [
              { key: 'name', header: 'Name', ratio: 3 },
              { key: 'relationship', header: 'Relationship', ratio: 2 },
            ],
            accessor: (d) => (d.linked_persons ?? []).map((p) => ({
              name: safe(p.name),
              relationship: toDisplayLabel(safe(p.relationship, '')),
            })),
          }, data);
        });
      }

      if (data.trespass_orders && data.trespass_orders.length > 0) {
        ctx.section(`Trespass Orders (${data.trespass_orders.length})`, (inner) => {
          inner.table({
            kind: 'table',
            label: '',
            columns: [
              { key: 'order_number', header: 'Order #', ratio: 1 },
              { key: 'subject_name', header: 'Subject', ratio: 2 },
              { key: 'status', header: 'Status', ratio: 1 },
              { key: 'issued_date', header: 'Issued', ratio: 1 },
              { key: 'expires_date', header: 'Expires', ratio: 1 },
            ],
            accessor: (d) => (d.trespass_orders ?? []).map((t) => ({
              order_number: safe(t.order_number),
              subject_name: safe(t.subject_name),
              status: toDisplayLabel(safe(t.status, '')),
              issued_date: safe(t.issued_date),
              expires_date: safe(t.expires_date),
            })),
          }, data);
        });
      }

      if (data.calls && data.calls.length > 0) {
        ctx.section(`Calls for Service (${data.calls.length})`, (inner) => {
          inner.table({
            kind: 'table',
            label: '',
            columns: [
              { key: 'call_number', header: 'Call #', ratio: 1 },
              { key: 'incident_type', header: 'Type', ratio: 2 },
              { key: 'status', header: 'Status', ratio: 1 },
              { key: 'created_at', header: 'Date', ratio: 1 },
            ],
            accessor: (d) => (d.calls ?? []).map((c) => ({
              call_number: safe(c.call_number),
              incident_type: toDisplayLabel(safe(c.incident_type, '')),
              status: toDisplayLabel(safe(c.status, '')),
              created_at: c.created_at ? parseTimestamp(c.created_at).toLocaleDateString() : '—',
            })),
          }, data);
        });
      }
    },
  ],
  footer: { kind: 'default', showRevision: true, showPageNumbers: true },
};
