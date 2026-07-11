// Person Dossier — v2 schema (migrated from utils/dossierPdfGenerator.ts).
// Section-level try/catch preserved from the original: one malformed
// section can never take down the rest of the export.
import type { FormSchema } from '../engine/types';
import { drawBadge } from '../engine/badge';

export interface LinkedIntelEntry {
  id: number;
  report_number?: string | null;
  title?: string | null;
  threat_level?: string | null;
  source_reliability?: string | null;
  info_credibility?: string | null;
  handling_code?: string | null;
  disseminated_at?: string | null;
  role?: string | null;
}

export interface DossierData {
  person: Record<string, any>;
  cluster: Array<{ person_id: number; name: string }>;
  flags: string[];
  timeline: Array<{ kind: string; id: number; date: string | null; title: string; subtitle: string; status: string }>;
  associates: Array<{ person_id: number; name: string; shared_events: number; kinds: string[] }>;
  vehicles: Array<Record<string, any>>;
  addresses: Array<{ address: string; source: string }>;
  // Optional — older callers may not pass these; PDF degrades gracefully.
  linked_intel?: LinkedIntelEntry[];
  escalation?: { recent: number; baseline: number; ratio: number; trend: string } | null;
}

const SENTINELS = new Set(['', 'none', 'n/a', 'na', 'null', '0', 'unknown']);
const real = (v: unknown) => v != null && !SENTINELS.has(String(v).trim().toLowerCase());
const show = (v: unknown) => (real(v) ? String(v) : '—');

function personName(p: Record<string, any>): string {
  return [p.first_name, p.middle_name, p.last_name].filter(real).join(' ') || `Person #${p.id}`;
}

export const dossierSchema: FormSchema<DossierData> = {
  meta: { formNumber: 'FORM DOS', title: 'Person Dossier', revision: '2026-07' },
  header: {
    kind: 'default',
    formId: 'dossier',
    caseNumberAccessor: (d) => (d.person?.id != null ? `${personName(d.person)} — SUBJECT #${d.person.id}` : undefined),
    caseLabel: 'REF',
  },
  sections: [
    (ctx, data) => {
      const p = data.person;
      const name = personName(p);

      ctx.section('Identity', (inner) => {
        try {
          inner.labeledField({ kind: 'labeled', label: 'Name', accessor: () => name }, data);
          inner.labeledField({ kind: 'labeled', label: 'DOB', accessor: () => show(p.dob) }, data);
          inner.labeledField({ kind: 'labeled', label: 'Gender', accessor: () => show(p.gender), width: 'third' }, data);
          inner.labeledField({ kind: 'labeled', label: 'Race', accessor: () => show(p.race), width: 'third' }, data);
          inner.labeledField({ kind: 'labeled', label: 'Height', accessor: () => show(p.height), width: 'quarter' }, data);
          inner.labeledField({ kind: 'labeled', label: 'Weight', accessor: () => show(p.weight), width: 'quarter' }, data);
          inner.labeledField({ kind: 'labeled', label: 'Hair', accessor: () => show(p.hair_color), width: 'quarter' }, data);
          inner.labeledField({ kind: 'labeled', label: 'Eyes', accessor: () => show(p.eye_color), width: 'quarter' }, data);
          inner.labeledField({ kind: 'labeled', label: 'DL', accessor: () => `${show(p.dl_number)} (${show(p.dl_state)})` }, data);
          inner.labeledField({ kind: 'labeled', label: 'SSN', accessor: () => (real(p.ssn_last4) ? `***-**-${p.ssn_last4}` : '—') }, data);
          inner.labeledField({ kind: 'labeled', label: 'Phone', accessor: () => show(p.phone) }, data);
          if (real(p.alias_nickname)) inner.labeledField({ kind: 'labeled', label: 'Aliases', accessor: () => String(p.alias_nickname) }, data);
          if (real(p.gang_affiliation)) inner.labeledField({ kind: 'labeled', label: 'Gang affiliation', accessor: () => String(p.gang_affiliation) }, data);
          if (real(p.probation_parole)) {
            inner.labeledField({
              kind: 'labeled', label: 'Probation/parole',
              accessor: () => `${p.probation_parole}${real(p.probation_parole_officer) ? ` (PO: ${p.probation_parole_officer})` : ''}`,
            }, data);
          }
          if (real(p.scars_marks_tattoos)) inner.narrative({ kind: 'narrative', label: 'Scars/marks/tattoos', accessor: () => String(p.scars_marks_tattoos) }, data);
          if (data.cluster.length) {
            inner.labeledField({
              kind: 'labeled', label: 'Linked identities',
              accessor: () => data.cluster.map((m) => `${m.name} (#${m.person_id})`).join(', '),
            }, data);
          }
          for (const flag of data.flags ?? []) drawBadge(ctx.doc, ctx.layout, { label: flag, tone: 'gold' });
        } catch { /* section degraded */ }
      });

      try {
        if (data.escalation && data.escalation.trend && data.escalation.trend !== 'stable') {
          ctx.section('Activity Trend', (inner) => {
            const r = data.escalation!;
            inner.narrative({
              kind: 'narrative', label: '',
              accessor: () => `Trend: ${r.trend.toUpperCase()}    Last 30d: ${r.recent} events    90d baseline: ${r.baseline.toFixed(1)}    Ratio: ${r.ratio >= 99 ? '∞' : `${r.ratio.toFixed(1)}×`}`,
            }, data);
          });
        }
      } catch { /* section degraded */ }

      try {
        if (data.addresses?.length) {
          ctx.section('Addresses', (inner) => {
            for (const a of data.addresses) {
              inner.narrative({ kind: 'narrative', label: '', accessor: () => `${a.address}  —  ${a.source}` }, data);
            }
          });
        }
      } catch { /* section degraded */ }

      try {
        if (data.vehicles?.length) {
          ctx.section('Vehicles', (inner) => {
            for (const v of data.vehicles) {
              inner.narrative({
                kind: 'narrative', label: '',
                accessor: () => `${[v.color, v.year, v.make, v.model].filter(real).join(' ')}    Plate: ${show(v.plate_number)}    VIN: ${show(v.vin)}`,
              }, data);
            }
          });
        }
      } catch { /* section degraded */ }

      try {
        if (data.associates?.length) {
          ctx.section('Known Associates', (inner) => {
            for (const a of data.associates) {
              inner.narrative({
                kind: 'narrative', label: '',
                accessor: () => `${a.name} (#${a.person_id})  —  ${a.shared_events} shared event${a.shared_events === 1 ? '' : 's'} (${a.kinds.join(', ')})`,
              }, data);
            }
          });
        }
      } catch { /* section degraded */ }

      try {
        if (data.linked_intel && data.linked_intel.length) {
          ctx.section(`Linked Intelligence (${data.linked_intel.length})`, (inner) => {
            for (const r of data.linked_intel!) {
              const head = `${r.report_number || `IR-${r.id}`}${r.threat_level ? `  [${String(r.threat_level).toUpperCase()}]` : ''}${r.role ? `  (${r.role})` : ''}`;
              inner.narrative({ kind: 'narrative', label: '', accessor: () => head }, data);
              if (real(r.title)) inner.narrative({ kind: 'narrative', label: '', accessor: () => String(r.title) }, data);
              const meta: string[] = [];
              if (real(r.disseminated_at)) meta.push(`Disseminated ${String(r.disseminated_at).slice(0, 10)}`);
              if (real(r.handling_code)) meta.push(`Handling: ${r.handling_code}`);
              if (real(r.source_reliability)) meta.push(`Source: ${r.source_reliability}`);
              if (real(r.info_credibility)) meta.push(`Info: ${r.info_credibility}`);
              if (meta.length) inner.narrative({ kind: 'narrative', label: '', accessor: () => meta.join('   ') }, data);
            }
          });
        }
      } catch { /* section degraded */ }

      try {
        if (data.timeline?.length) {
          ctx.section(`Contact Timeline (${data.timeline.length})`, (inner) => {
            for (const e of data.timeline.slice(0, 150)) {
              const date = e.date ? String(e.date).slice(0, 10) : '—';
              const kind = (e.kind ?? '').replace(/_/g, ' ').toUpperCase();
              inner.narrative({
                kind: 'narrative', label: '',
                accessor: () => `${date}  [${kind}]  ${e.title ?? ''}${e.status ? `  (${e.status})` : ''}${e.subtitle ? `  —  ${e.subtitle}` : ''}`,
              }, data);
            }
            if (data.timeline.length > 150) {
              inner.narrative({ kind: 'narrative', label: '', accessor: () => `… ${data.timeline.length - 150} older events omitted` }, data);
            }
          });
        }
      } catch { /* section degraded */ }
    },
  ],
  footer: { kind: 'default', showRevision: true, showPageNumbers: true },
};
