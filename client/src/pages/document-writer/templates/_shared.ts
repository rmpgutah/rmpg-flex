// Shared HTML fragments + field shortcuts for templates.
// Keep tight — these are composed into ~150 templates.
//
// ⚠️ ROUND-TRIP RULE — the editor's TipTap schema is LOSSY. Anything not
// whitelisted below is silently STRIPPED the moment a template is inserted
// (the first generation of templates leaned on <div> wrappers, per-<td>
// inline styles and h2 border-bottoms — all of which vanished, which is why
// documents rendered so plain). Only build templates from:
//   • tables (structure only — td/th chrome comes from writer.css)
//   • h1–h4 / p with: text-align, line-height, margin-top/bottom,
//     text-indent, full `border` shorthand, background-color (BlockStyle)
//   • inline <span> textStyle: color, font-size, letter-spacing,
//     font-weight, font-variant (small-caps), text-transform, font-family
//   • <strong>/<em>/<s>, <br>, <hr>, lists, blockquote,
//     <ul data-type="taskList"> interactive checkboxes
// NO <div>, NO <u> (Underline ext not registered), NO td styles,
// NO border-bottom-only (only the full `border` shorthand round-trips).
//
// COLOR RULE — the editor has light + dark page themes and print forces
// black-on-white. Never use near-black or near-white explicit colors:
// mid-gray #8a8a8a for labels, gold #d4a017 / #b8860b for accents — those
// read on every surface. Backgrounds are explicit (survive both themes)
// but browsers may skip them in print, so every filled element also
// carries a border that keeps its shape without the fill.

import type { TemplateField } from '../types';

// Citation-form chrome is set in compact sans-serif (the editor body default
// is Times) — FontFamily spans survive the schema.
const SANS = 'font-family:Arial, Helvetica, sans-serif;';


// ─── Letterhead ─────────────────────────────────────────────
export const AGENCY_HEADER = `
<p style="text-align:center;margin-bottom:2px;"><strong><span style="${SANS}font-size:19px;letter-spacing:0.16em;font-variant:small-caps;">Rocky Mountain Protective Group</span></strong></p>
<p style="text-align:center;margin-top:0;margin-bottom:1px;"><span style="${SANS}font-size:8.5px;letter-spacing:0.28em;color:#8a8a8a;text-transform:uppercase;">Law Enforcement · Private Security · Process Service</span></p>
<p style="text-align:center;margin-top:0;margin-bottom:0;"><span style="${SANS}font-size:8.5px;color:#8a8a8a;">Salt Lake City, Utah&nbsp;&nbsp;·&nbsp;&nbsp;rmpgutah.us</span></p>
<p style="background-color:#d4a017;border:1px solid #d4a017;line-height:0.3;margin-top:7px;margin-bottom:16px;"><span style="${SANS}font-size:6px;color:#d4a017;">&nbsp;</span></p>`;

export const CONFIDENTIAL = `<p style="text-align:center;margin-top:6px;"><span style="${SANS}font-size:8px;letter-spacing:0.24em;color:#8a8a8a;">CONFIDENTIAL — LAW ENFORCEMENT SENSITIVE — INTERNAL USE ONLY</span></p>`;

/** Centered document title. Letter-spaced caps under the letterhead rule. */
export function title(text: string, color?: string): string {
  const c = color ? `color:${color};` : '';
  return `<h1 style="text-align:center;margin-top:2px;margin-bottom:4px;"><span style="${SANS}font-size:16px;letter-spacing:0.20em;${c}">${text}</span></h1>
<p style="text-align:center;margin-top:0;margin-bottom:12px;"><span style="${SANS}font-size:8px;letter-spacing:0.30em;color:#8a8a8a;">— OFFICIAL DOCUMENT —</span></p>`;
}

/** Section header — filled bar with a gold tab marker. Prints as a bordered
 *  bar even when the browser skips the background fill. */
export function section(label: string): string {
  return `<p style="background-color:#252c39;border:1px solid #3c4658;margin-top:16px;margin-bottom:8px;line-height:1.5;"><strong><span style="${SANS}color:#d4a017;font-size:10px;letter-spacing:0.14em;">&nbsp;&nbsp;▌&nbsp;${label}</span></strong></p>`;
}

// ─── Tables (chrome comes from writer.css — keep cells clean) ───
export function row2(a: string, b: string): string {
  return `<tr><td>${a}</td><td>${b}</td></tr>`;
}
export function row1(a: string): string {
  return `<tr><td colspan="2">${a}</td></tr>`;
}
export function tbl(rows: string): string {
  return `<table>${rows}</table>`;
}

/** One label-over-value cell body (the classic police-form field look):
 *  tiny letter-spaced gray caption, bold value beneath it. */
export function field(label: string, value: string): string {
  return `<p style="margin-bottom:1px;"><span style="${SANS}font-size:7.5px;letter-spacing:0.10em;color:#8a8a8a;">${label.toUpperCase()}</span></p><p style="margin-top:0;"><strong><span style="${SANS}font-size:11.5px;">${value || '&nbsp;'}</span></strong></p>`;
}

/** Label-over-value form grid. Pass [label, value] pairs; lays them out
 *  `perRow` cells per table row (last row padded with blanks). */
export function fieldGrid(pairs: Array<[string, string]>, perRow = 2): string {
  const rows: string[] = [];
  for (let i = 0; i < pairs.length; i += perRow) {
    const slice = pairs.slice(i, i + perRow);
    while (slice.length < perRow) slice.push(['', '&nbsp;']);
    rows.push(`<tr>${slice.map(([l, v]) => `<td>${l ? field(l, v) : '<p>&nbsp;</p>'}</td>`).join('')}</tr>`);
  }
  return `<table>${rows.join('')}</table>`;
}

/** Ruled writing area — N boxed lines to type into (survives the schema;
 *  border-bottom-only paragraphs do not). */
export function linedArea(lines = 5): string {
  const row = '<tr><td><p style="margin-top:2px;margin-bottom:10px;">&nbsp;</p></td></tr>';
  return `<table>${Array.from({ length: lines }, () => row).join('')}</table>`;
}

/** Interactive checkbox list (TipTap taskList — clickable in the editor). */
export function checkboxes(items: string[]): string {
  const lis = items
    .map((t) => `<li data-type="taskItem" data-checked="false"><p>${t}</p></li>`)
    .join('');
  return `<ul data-type="taskList">${lis}</ul>`;
}

/** Inline checkbox option row for compact single-line choices. */
export function checkRow(options: string[]): string {
  return `<p>${options.map((o) => `☐&nbsp;${o}`).join(' &nbsp;&nbsp; ')}</p>`;
}

// ─── Signature blocks ───────────────────────────────────────
function sigCell(label: string): string {
  return `<td><p style="margin-bottom:0;"><span style="${SANS}font-size:7.5px;letter-spacing:0.10em;color:#8a8a8a;">${label.toUpperCase()}</span></p><p style="margin-top:24px;margin-bottom:0;"><span style="${SANS}color:#8a8a8a;">✗</span>&nbsp;</p></td>`;
}

/** Generic signature row — one boxed signing cell per label. */
export function sigRow(labels: string[]): string {
  return `<table><tr>${labels.map(sigCell).join('')}</tr></table>`;
}

export const SIG_BLOCK = `
<p style="margin-top:22px;margin-bottom:0;">&nbsp;</p>
${sigRow(['Officer Signature', 'Badge #', 'Date'])}
<p style="margin-top:0;"><span style="${SANS}font-size:8px;color:#8a8a8a;">I certify the foregoing is true and accurate to the best of my knowledge and belief.</span></p>`;

export const DUAL_SIG_BLOCK = `
<p style="margin-top:22px;margin-bottom:0;">&nbsp;</p>
${sigRow(['Officer / Employee Signature', 'Date', 'Supervisor Signature', 'Date'])}`;

/** Notary acknowledgment — for affidavits and sworn statements. */
export const NOTARY_BLOCK = `
${section('NOTARY ACKNOWLEDGMENT')}
<p><span style="${SANS}font-size:11px;">STATE OF UTAH&nbsp;&nbsp;&nbsp;)<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: ss.<br>COUNTY OF SALT LAKE&nbsp;)</span></p>
<p><span style="${SANS}font-size:11px;">Subscribed and sworn to (or affirmed) before me on this ____ day of ______________, 20____, by _________________________________, proved to me on the basis of satisfactory evidence to be the person who appeared before me.</span></p>
${sigRow(['Notary Public Signature', 'Commission No.', 'My Commission Expires'])}`;

/** Form footer — form number, revision, distribution line. */
export function footer(formNo: string, distribution = 'ORIGINAL — CASE FILE&nbsp;&nbsp;·&nbsp;&nbsp;COPY — RECORDS'): string {
  return `<hr>
<p style="text-align:center;margin-top:2px;"><span style="${SANS}font-size:7.5px;letter-spacing:0.08em;color:#8a8a8a;">FORM ${formNo}&nbsp;&nbsp;·&nbsp;&nbsp;REV. 06/2026&nbsp;&nbsp;·&nbsp;&nbsp;${distribution}</span></p>`;
}

/** Statute reference banner. */
export function statutes(refs: string[]): string {
  if (!refs.length) return '';
  return `<p style="border:1px solid #d4a017;background-color:#2b2516;margin-top:4px;margin-bottom:10px;"><span style="${SANS}font-size:9px;color:#d4a017;">&nbsp;&nbsp;⚖&nbsp;&nbsp;UTAH CODE:&nbsp;</span><strong><span style="${SANS}font-size:9px;color:#d4a017;">${refs.join(' &nbsp;·&nbsp; ')}</span></strong></p>`;
}

// ─── Reusable field-set generators ──────────────────────────
export const F_CASE: TemplateField = { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' };
export const F_DATE: TemplateField = { key: 'date_of_report', label: 'Date of Report', source: 'manual' };
export const F_INC_DT: TemplateField = { key: 'incident_date', label: 'Incident Date/Time', source: 'cad', cadPath: 'call.received_at' };
export const F_LOC: TemplateField = { key: 'location', label: 'Location', source: 'cad', cadPath: 'call.address' };
export const F_OFFICER: TemplateField = { key: 'reporting_officer', label: 'Reporting Officer', source: 'user' };
export const F_BADGE: TemplateField = { key: 'badge_number', label: 'Badge Number', source: 'user' };

export function commonFields(extra: TemplateField[] = []): TemplateField[] {
  return [F_CASE, F_INC_DT, F_LOC, F_OFFICER, F_BADGE, ...extra];
}

/** Header info bar — used by ~80% of templates. Citation-style grid:
 *  dense 3-up top row, full-width location bar beneath. */
export function caseHeader(): string {
  return `<table><tr><td>${field('Case / Call No.', '{{case_number}}')}</td><td>${field('Incident Date / Time', '{{incident_date}}')}</td><td>${field('Reporting Officer / Badge', '{{reporting_officer}}&nbsp;·&nbsp;#{{badge_number}}')}</td></tr><tr><td colspan="3">${field('Location of Occurrence', '{{location}}')}</td></tr></table>`;
}

/** Narrative section: prompt + ruled writing area. */
export function narrative(opening?: string): string {
  return section('NARRATIVE') +
    `<p><em><span style="${SANS}font-size:9px;color:#8a8a8a;">Describe events in chronological order. Include who, what, when, where, why, and how. Identify all parties by full name on first reference.</span></em></p>` +
    (opening ? `<p>${opening}</p>` : '') +
    linedArea(6);
}
