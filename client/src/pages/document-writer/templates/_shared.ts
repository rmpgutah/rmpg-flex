// Shared HTML fragments + field shortcuts for templates.
// Keep tight — these are copy-pasted into dozens of templates.
import type { TemplateField } from '../types';

export const AGENCY_HEADER = `
<div style="text-align:center;margin-bottom:18px;">
  <p style="font-size:16px;font-weight:bold;margin:0;">ROCKY MOUNTAIN PROTECTIVE GROUP</p>
  <p style="font-size:11px;margin:2px 0;color:#666;">Law Enforcement &amp; Private Security Services</p>
  <p style="font-size:10px;margin:2px 0;color:#888;">Salt Lake City, Utah</p>
  <hr style="border:none;border-top:2px solid #d4a017;margin:8px 0;" />
</div>`;

export const CONFIDENTIAL = `<p style="text-align:center;font-size:10px;color:#888;">CONFIDENTIAL — Internal use only. Subject to discovery in legal proceedings.</p>`;

export function title(text: string, color = '#111'): string {
  return `<h1 style="text-align:center;font-size:18px;color:${color};margin:8px 0 14px;">${text}</h1>`;
}

export function section(label: string): string {
  return `<h2 style="font-size:13px;border-bottom:1px solid #333;margin-top:14px;padding-bottom:2px;">${label}</h2>`;
}

export function row2(a: string, b: string): string {
  return `<tr><td style="border:1px solid #333;padding:5px;width:50%;">${a}</td><td style="border:1px solid #333;padding:5px;width:50%;">${b}</td></tr>`;
}
export function row1(a: string): string {
  return `<tr><td colspan="2" style="border:1px solid #333;padding:5px;">${a}</td></tr>`;
}
export function tbl(rows: string): string {
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:11px;">${rows}</table>`;
}

export const SIG_BLOCK = `
<div style="margin-top:40px;">
  <table style="width:100%;border:none;font-size:10px;color:#666;">
    <tr>
      <td style="width:60%;border-bottom:1px solid #333;padding-top:28px;">&nbsp;</td>
      <td style="width:10%;">&nbsp;</td>
      <td style="width:30%;border-bottom:1px solid #333;padding-top:28px;">&nbsp;</td>
    </tr>
    <tr><td>Signature</td><td></td><td>Date</td></tr>
  </table>
</div>`;

export const DUAL_SIG_BLOCK = `
<div style="margin-top:32px;">
  <table style="width:100%;border:none;font-size:10px;color:#666;">
    <tr>
      <td style="width:45%;border-bottom:1px solid #333;padding-top:28px;">&nbsp;</td>
      <td style="width:10%;">&nbsp;</td>
      <td style="width:45%;border-bottom:1px solid #333;padding-top:28px;">&nbsp;</td>
    </tr>
    <tr><td>Officer / Employee</td><td></td><td>Supervisor</td></tr>
  </table>
</div>`;

export function statutes(refs: string[]): string {
  if (!refs.length) return '';
  return `<div style="background:#f7f3e8;border-left:3px solid #d4a017;padding:6px 10px;margin:8px 0;font-size:10px;color:#5a4400;"><strong>Utah Code:</strong> ${refs.join(' &middot; ')}</div>`;
}

// Reusable field-set generators.
export const F_CASE: TemplateField = { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' };
export const F_DATE: TemplateField = { key: 'date_of_report', label: 'Date of Report', source: 'manual' };
export const F_INC_DT: TemplateField = { key: 'incident_date', label: 'Incident Date/Time', source: 'cad', cadPath: 'call.received_at' };
export const F_LOC: TemplateField = { key: 'location', label: 'Location', source: 'cad', cadPath: 'call.address' };
export const F_OFFICER: TemplateField = { key: 'reporting_officer', label: 'Reporting Officer', source: 'user' };
export const F_BADGE: TemplateField = { key: 'badge_number', label: 'Badge Number', source: 'user' };

export function commonFields(extra: TemplateField[] = []): TemplateField[] {
  return [F_CASE, F_INC_DT, F_LOC, F_OFFICER, F_BADGE, ...extra];
}

/** Header info bar — used by ~80% of templates. */
export function caseHeader(): string {
  return tbl(
    row2('<strong>Case #:</strong> {{case_number}}', '<strong>Date/Time:</strong> {{incident_date}}') +
    row2('<strong>Location:</strong> {{location}}', '<strong>Officer:</strong> {{reporting_officer}} (#{{badge_number}})')
  );
}

/** Narrative section with prompts. */
export function narrative(opening?: string): string {
  return section('NARRATIVE') +
    (opening ? `<p>${opening}</p>` : '<p>&nbsp;</p>') +
    '<p>&nbsp;</p><p>&nbsp;</p>';
}
