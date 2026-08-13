import type { FormSchema } from '../engine/types';
import { toDisplayLabel } from '../../../formatters';

export interface BusinessRecordData {
  id?: number | string;
  name?: string;
  dba_name?: string;
  business_type?: string;
  ein?: string;
  license_number?: string;
  industry?: string;
  employee_count?: string | number;
  annual_revenue?: string | number;
  status?: string;
  // Location
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  // Assessor-sourced (patched via buildAssessorFormPatch)
  parcel_number?: string;
  owner_of_record?: string;
  owner_mailing_address?: string;
  total_market_value?: string | number;
  year_built?: string | number;
  land_sqft?: string | number;
  legal_description?: string;
  tax_district?: string;
  assessor_last_synced_at?: string;
  // Contacts
  phone?: string;
  email?: string;
  website?: string;
  owner_name?: string;
  owner_phone?: string;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
  // Notes
  notes?: string;
  flags?: string[];
  created_at?: string;
  updated_at?: string;
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

export const businessRecordSchema: FormSchema<BusinessRecordData> = {
  meta: { formNumber: 'FORM BR', title: 'Business Record', revision: '2026-08' },
  header: {
    kind: 'default',
    formId: 'business_record',
    caseLabel: 'RECORD',
    caseNumberAccessor: (d) => d.id ? `BR-${d.id}` : undefined,
  },
  sections: [
    (ctx, data) => {
      ctx.section('Business Identification', (inner) => {
        inner.labeledField({ kind: 'labeled', label: 'Business Name', accessor: (d) => safe(d.name), width: 'full' }, data);
        if (data.dba_name) {
          inner.labeledField({ kind: 'labeled', label: 'DBA / Trade Name', accessor: (d) => safe(d.dba_name), width: 'full' }, data);
        }
        inner.labeledField({ kind: 'labeled', label: 'Type', accessor: (d) => toDisplayLabel(safe(d.business_type, '')), width: 'third' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Industry', accessor: (d) => toDisplayLabel(safe(d.industry, '')), width: 'third' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Status', accessor: (d) => toDisplayLabel(safe(d.status, '')), width: 'third' }, data);
        inner.labeledField({ kind: 'labeled', label: 'EIN', accessor: (d) => safe(d.ein), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'License Number', accessor: (d) => safe(d.license_number), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Employees', accessor: (d) => safe(d.employee_count), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Annual Revenue', accessor: (d) => currency(d.annual_revenue), width: 'half' }, data);
        if (data.parcel_number) {
          inner.labeledField({ kind: 'labeled', label: 'APN / Parcel Number', accessor: (d) => safe(d.parcel_number), width: 'full' }, data);
        }
      });

      ctx.section('Location', (inner) => {
        inner.labeledField({ kind: 'labeled', label: 'Street Address', accessor: (d) => safe(d.address), width: 'full' }, data);
        inner.labeledField({ kind: 'labeled', label: 'City', accessor: (d) => safe(d.city), width: 'third' }, data);
        inner.labeledField({ kind: 'labeled', label: 'State', accessor: (d) => safe(d.state), width: 'third' }, data);
        inner.labeledField({ kind: 'labeled', label: 'ZIP', accessor: (d) => safe(d.zip), width: 'third' }, data);
      });

      ctx.section('Contacts', (inner) => {
        inner.labeledField({ kind: 'labeled', label: 'Phone', accessor: (d) => safe(d.phone), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Email', accessor: (d) => safe(d.email), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Website', accessor: (d) => safe(d.website), width: 'full' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Owner', accessor: (d) => safe(d.owner_name), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Owner Phone', accessor: (d) => safe(d.owner_phone), width: 'half' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Primary Contact', accessor: (d) => safe(d.contact_name), width: 'third' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Contact Phone', accessor: (d) => safe(d.contact_phone), width: 'third' }, data);
        inner.labeledField({ kind: 'labeled', label: 'Contact Email', accessor: (d) => safe(d.contact_email), width: 'third' }, data);
      });

      if (data.owner_of_record || data.total_market_value || data.year_built) {
        ctx.section('Assessor Data', (inner) => {
          inner.labeledField({ kind: 'labeled', label: 'Owner of Record', accessor: (d) => safe(d.owner_of_record), width: 'full' }, data);
          if (data.owner_mailing_address) {
            inner.labeledField({ kind: 'labeled', label: 'Mailing Address', accessor: (d) => safe(d.owner_mailing_address), width: 'full' }, data);
          }
          inner.labeledField({ kind: 'labeled', label: 'Market Value', accessor: (d) => currency(d.total_market_value), width: 'half' }, data);
          inner.labeledField({ kind: 'labeled', label: 'Year Built', accessor: (d) => safe(d.year_built), width: 'quarter' }, data);
          inner.labeledField({ kind: 'labeled', label: 'Lot Size', accessor: (d) => sqft(d.land_sqft), width: 'quarter' }, data);
          inner.labeledField({ kind: 'labeled', label: 'Tax District', accessor: (d) => safe(d.tax_district), width: 'half' }, data);
          if (data.legal_description) {
            inner.labeledField({ kind: 'labeled', label: 'Legal Description', accessor: (d) => safe(d.legal_description), width: 'full' }, data);
          }
          if (data.assessor_last_synced_at) {
            inner.labeledField({ kind: 'labeled', label: 'Assessor Last Synced', accessor: (d) => safe(d.assessor_last_synced_at), width: 'half' }, data);
          }
        });
      }

      if (data.flags && data.flags.length > 0) {
        ctx.section('Flags', (inner) => {
          inner.labeledField({ kind: 'labeled', label: 'Active Flags', accessor: (d) => (d.flags ?? []).join(', ') || '—', width: 'full' }, data);
        });
      }

      if (data.notes) {
        ctx.section('Notes', (inner) => {
          inner.narrative({ kind: 'narrative', label: '', accessor: (d) => safe(d.notes, ''), minLines: 3 }, data);
        });
      }
    },
  ],
  footer: { kind: 'default', showRevision: true, showPageNumbers: true },
};
