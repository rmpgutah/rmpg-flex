// Investigative Case Report — v2 schema (migrated from utils/caseReportGenerator.ts).
// buildCaseReportSections() is unchanged pure logic; only the drawing moved
// from hand-rolled jsPDF closures to the v2 engine's shared primitives so
// this form gets the steel-blue header/section/table treatment for free.
import type { FormSchema } from '../engine/types';
import { drawBadge } from '../engine/badge';
import { formatActivity, type CaseActivityRow } from '../../../caseActivity';
import { parseTimestamp } from '../../../dateUtils';

export interface CaseReportData {
  caseRow: Record<string, any>;
  calls?: any[]; incidents?: any[]; persons?: any[]; vehicles?: any[];
  properties?: any[]; evidence?: any[]; warrants?: any[]; citations?: any[];
  tasks?: any[]; notes?: any[]; related?: any[]; activity?: CaseActivityRow[];
}

export interface ReportSection { key: string; title: string; count: number }

/** Pure: the ordered list of record sections that have content. */
export function buildCaseReportSections(data: CaseReportData): ReportSection[] {
  const defs: { key: keyof CaseReportData; title: string }[] = [
    { key: 'calls',      title: 'Linked Calls for Service' },
    { key: 'incidents',  title: 'Linked Incidents' },
    { key: 'persons',    title: 'Persons' },
    { key: 'vehicles',   title: 'Vehicles' },
    { key: 'properties', title: 'Property' },
    { key: 'evidence',   title: 'Evidence' },
    { key: 'warrants',   title: 'Warrants' },
    { key: 'citations',  title: 'Citations' },
    { key: 'tasks',      title: 'Investigative Tasks' },
    { key: 'notes',      title: 'Case Notes' },
    { key: 'related',    title: 'Related Cases' },
    { key: 'activity',   title: 'Activity Log' },
  ];
  return defs
    .map((d) => ({
      key: String(d.key),
      title: d.title,
      count: Array.isArray(data[d.key]) ? (data[d.key] as any[]).length : 0,
    }))
    .filter((s) => s.count > 0);
}

const safe = (v: unknown, dash = '—'): string => (v === null || v === undefined || v === '' ? dash : String(v));
const safeDate = (v: unknown): string => {
  if (!v) return '—';
  // parseTimestamp (not raw `new Date()`) — the server writes naive-UTC
  // wall-clock strings; see its docstring for why this matters. Matches
  // the original caseReportGenerator.ts's safeDate exactly.
  const d = parseTimestamp(String(v));
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
};

function rowLine(key: string, r: Record<string, any>): string {
  switch (key) {
    case 'calls':      return [r.call_number || r.case_number, r.incident_type || r.call_type, r.status, safeDate(r.created_at)].filter(Boolean).join('  ·  ');
    case 'incidents':  return [r.incident_number, r.incident_type, r.status, safeDate(r.created_at)].filter(Boolean).join('  ·  ');
    case 'persons':    return [`${safe(r.last_name, '')} ${safe(r.first_name, '')}`.trim(), r.role, r.date_of_birth, r.phone].filter(Boolean).join('  ·  ');
    case 'vehicles':   return [r.plate_number, [r.year, r.make, r.model].filter(Boolean).join(' '), r.color, r.vin].filter(Boolean).join('  ·  ');
    case 'properties': return [r.description, r.property_type, r.serial_number, r.status].filter(Boolean).join('  ·  ');
    case 'evidence':   return [r.evidence_number, r.description, r.evidence_type, r.status].filter(Boolean).join('  ·  ');
    case 'warrants':   return [r.warrant_number, r.subject_name, r.charge_description, r.status].filter(Boolean).join('  ·  ');
    case 'citations':  return [r.citation_number, r.violation, r.violator_name, r.status].filter(Boolean).join('  ·  ');
    case 'tasks':       return [r.title, (r.status || '').replace(/_/g, ' '), r.priority, r.assignee_name, r.due_date ? `due ${r.due_date}` : ''].filter(Boolean).join('  ·  ');
    case 'notes':       return `${r.author_name ? `${r.author_name} — ` : ''}${safe(r.content, '')}`;
    case 'related':     return [r.case_number, r.title, r.link_type || 'related', r.status].filter(Boolean).join('  ·  ');
    case 'activity': {
      const f = formatActivity(r.action, r.detail);
      return [safeDate(r.created_at), r.actor_name || 'System', f.label].filter(Boolean).join('  ·  ');
    }
    default: return '';
  }
}

export const caseReportSchema: FormSchema<CaseReportData> = {
  meta: { formNumber: 'FORM CR', title: 'Investigative Case Report', revision: '2026-07' },
  header: { kind: 'default', formId: 'case_report', caseNumberAccessor: (d) => d.caseRow?.case_number },
  sections: [
    (ctx, data) => {
      const c = data.caseRow || {};
      // Same field set/order as the legacy generator's cover fields
      // (Status, Priority, Type, Lead Investigator, Opened, [Closed],
      // [Disposition], Generated) — this is a visual/architecture
      // migration only, not a content redesign, so nothing gets dropped.
      // The priority badge is an additive visual upgrade alongside the
      // plain-text field, not a replacement for it.
      const genTs = new Date().toLocaleString('en-US', {
        month: '2-digit', day: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
      ctx.section('Overview', (inner) => {
        inner.labeledField({ kind: 'labeled', label: 'Status', accessor: () => safe(c.status, '').replace(/_/g, ' ').toUpperCase() }, data);
        inner.labeledField({ kind: 'labeled', label: 'Priority', accessor: () => safe(c.priority, '').toUpperCase() }, data);
        inner.labeledField({ kind: 'labeled', label: 'Type', accessor: () => safe(c.case_type, '').replace(/_/g, ' ') }, data);
        inner.labeledField({ kind: 'labeled', label: 'Lead Investigator', accessor: () => safe(c.lead_investigator_name) }, data);
        inner.labeledField({ kind: 'labeled', label: 'Opened', accessor: () => safeDate(c.opened_date) }, data);
        if (c.closed_date) inner.labeledField({ kind: 'labeled', label: 'Closed', accessor: () => safeDate(c.closed_date) }, data);
        if (c.disposition) inner.labeledField({ kind: 'labeled', label: 'Disposition', accessor: () => safe(c.disposition) }, data);
        inner.labeledField({ kind: 'labeled', label: 'Generated', accessor: () => genTs }, data);
        if (c.priority) drawBadge(ctx.doc, ctx.layout, { label: String(c.priority), tone: c.priority === 'high' ? 'gold' : 'steel' });
      });

      if (c.summary || c.narrative) {
        ctx.section('Summary', (inner) => {
          if (c.summary) inner.narrative({ kind: 'narrative', label: '', accessor: () => String(c.summary) }, data);
          if (c.narrative) inner.narrative({ kind: 'narrative', label: '', accessor: () => String(c.narrative) }, data);
        });
      }

      if (c.solvability_score != null && Number.isFinite(Number(c.solvability_score))) {
        ctx.section('Solvability', (inner) => {
          inner.labeledField({ kind: 'labeled', label: 'Score', accessor: () => `${Number(c.solvability_score)}/100` }, data);
        });
      }

      for (const section of buildCaseReportSections(data)) {
        ctx.section(`${section.title} (${section.count})`, (inner) => {
          const rows = (data as any)[section.key] as Array<Record<string, any>>;
          for (const r of rows) {
            inner.narrative({ kind: 'narrative', label: '', accessor: () => `• ${rowLine(section.key, r)}` }, data);
          }
        });
      }
    },
  ],
  footer: { kind: 'default', showRevision: true, showPageNumbers: true },
};
