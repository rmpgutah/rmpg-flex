// Shared HTML fragments + field shortcuts for templates.
// Keep tight — these are composed into ~150 templates.
//
// ── HOUSE STYLE: PLAIN COURT DOCUMENT ──────────────────────────
// These templates are styled like documents a legal office files with a
// court: clean white paper, black serif (Times) text, centered plain
// captions, bold-uppercase section headings, simple horizontal rules.
// NO branded letterhead bars, NO gold, NO dark fills, NO decorative
// chrome. If you are tempted to add a colored band or accent, don't —
// a thin black <hr> or a bold heading is the house vocabulary.
//
// ⚠️ ROUND-TRIP RULE — the editor's TipTap schema is LOSSY. Anything not
// whitelisted below is silently STRIPPED the moment a template is inserted
// (the first generation of templates leaned on <div> wrappers, per-<td>
// inline styles and h2 border-bottoms — all of which vanished). Only build
// templates from:
//   • tables (structure only — td/th chrome comes from writer.css)
//   • h1–h4 / p with: text-align, line-height, margin-top/bottom,
//     text-indent, full `border` shorthand, background-color (BlockStyle)
//   • inline <span> textStyle: color, font-size, letter-spacing,
//     font-weight, font-variant (small-caps), text-transform, font-family
//   • <strong>/<em>/<s>, <br>, <hr>, lists, blockquote,
//     <ul data-type="taskList"> interactive checkboxes
// NO <div>, NO <u> (Underline ext not registered), NO td styles,
// NO border-bottom-only (only the full `border` shorthand round-trips, and
// it draws a full box — for a rule use <hr>).
//
// COLOR RULE — the editor has light + dark page themes and print forces
// black-on-white. Body text is the page's inherited near-black. The ONLY
// non-inherited color used here is a neutral mid-gray (#6b6b6b) for the
// small field captions, which reads as plain gray on every surface. No
// brand accents.

import type { TemplateField } from '../types';

// Court documents are set in Times. The editor body default is already
// Times, but we set it explicitly on chrome spans so headings/captions
// stay serif even if a writer changes the body font. FontFamily spans
// survive the schema.
// NOTE: single-quote the family name. The whole string is interpolated into a
// double-quoted style="…" attribute, so double quotes here would terminate the
// attribute early and silently drop the font (the letterhead rendered in the
// editor's sans-serif default until this was fixed).
const SERIF = "font-family:'Times New Roman', Times, serif;";
// Neutral caption gray — the one non-inherited color, print-safe on light
// and dark pages alike.
const CAP = '#6b6b6b';


// ─── Letterhead ─────────────────────────────────────────────
// Tight, modern-formal identification block: an engraved-style tracked caps
// name, a small wide-tracked uppercase tagline, and a single hairline rule.
// Lines sit close together (tight line-height, near-zero margins) so the
// masthead reads as one compact unit — no band, no gold, no logo.
export const AGENCY_HEADER = `
<p style="text-align:center;line-height:1.15;margin-top:0;margin-bottom:0;"><strong><span style="${SERIF}font-size:16px;letter-spacing:0.14em;">ROCKY MOUNTAIN PROTECTIVE GROUP</span></strong></p>
<p style="text-align:center;line-height:1.15;margin-top:3px;margin-bottom:0;"><span style="${SERIF}font-size:8px;letter-spacing:0.28em;text-transform:uppercase;color:${CAP};">Law Enforcement &nbsp;&middot;&nbsp; Private Security &nbsp;&middot;&nbsp; Process Service</span></p>
<p style="text-align:center;line-height:1.15;margin-top:1px;margin-bottom:4px;"><span style="${SERIF}font-size:8.5px;letter-spacing:0.04em;color:${CAP};">Salt Lake City, Utah &nbsp;&middot;&nbsp; rmpgutah.us</span></p>
<hr>`;

export const CONFIDENTIAL = `<p style="text-align:center;margin-top:6px;"><span style="${SERIF}font-size:8px;letter-spacing:0.18em;text-transform:uppercase;color:${CAP};">Confidential &middot; Law Enforcement Sensitive &middot; Internal Use Only</span></p>`;

/** Centered document title — tracked caps under the letterhead rule, the way a
 *  pleading caption reads. Tight rule beneath for separation. */
export function title(text: string, color?: string): string {
  const c = color ? `color:${color};` : '';
  return `<h1 style="text-align:center;line-height:1.2;margin-top:4px;margin-bottom:3px;"><span style="${SERIF}font-size:15px;letter-spacing:0.12em;${c}">${text}</span></h1>
<hr>`;
}

/** Section header — plain bold uppercase heading. No fill, no accent tab;
 *  just a bold caption with breathing room, court-memo style. */
export function section(label: string): string {
  return `<p style="margin-top:15px;margin-bottom:6px;"><strong><span style="${SERIF}font-size:11.5px;letter-spacing:0.06em;">${label.toUpperCase()}</span></strong></p>`;
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

/** One label-over-value cell body: small gray caption, plain value beneath.
 *  Mixed-case serif — reads like a filled court form field, not a CAD chip. */
export function field(label: string, value: string): string {
  return `<p style="margin-bottom:1px;"><span style="${SERIF}font-size:8px;letter-spacing:0.06em;color:${CAP};">${label.toUpperCase()}</span></p><p style="margin-top:0;"><span style="${SERIF}font-size:11.5px;">${value || '&nbsp;'}</span></p>`;
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
// A signature line in a court document is a plain rule with the signer's
// identity beneath. The schema strips border-bottom, so the "line" is the
// printed underscores; the caption sits under it.
function sigCell(label: string): string {
  return `<td><p style="margin-top:22px;margin-bottom:0;"><span style="${SERIF}">________________________________</span></p><p style="margin-top:0;"><span style="${SERIF}font-size:8px;letter-spacing:0.06em;color:${CAP};">${label.toUpperCase()}</span></p></td>`;
}

/** Generic signature row — one signing cell per label. */
export function sigRow(labels: string[]): string {
  return `<table><tr>${labels.map(sigCell).join('')}</tr></table>`;
}

export const SIG_BLOCK = `
<p style="margin-top:18px;margin-bottom:0;">&nbsp;</p>
${sigRow(['Officer Signature', 'Badge #', 'Date'])}
<p style="margin-top:2px;"><span style="${SERIF}font-size:9px;color:${CAP};">I certify the foregoing is true and accurate to the best of my knowledge and belief.</span></p>`;

export const DUAL_SIG_BLOCK = `
<p style="margin-top:18px;margin-bottom:0;">&nbsp;</p>
${sigRow(['Officer / Employee Signature', 'Date', 'Supervisor Signature', 'Date'])}`;

/** Notary acknowledgment — for affidavits and sworn statements. */
export const NOTARY_BLOCK = `
${section('NOTARY ACKNOWLEDGMENT')}
<p><span style="${SERIF}font-size:11px;">STATE OF UTAH&nbsp;&nbsp;&nbsp;)<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: ss.<br>COUNTY OF SALT LAKE&nbsp;)</span></p>
<p><span style="${SERIF}font-size:11px;">Subscribed and sworn to (or affirmed) before me on this ____ day of ______________, 20____, by _________________________________, proved to me on the basis of satisfactory evidence to be the person who appeared before me.</span></p>
${sigRow(['Notary Public Signature', 'Commission No.', 'My Commission Expires'])}`;

/** Form footer — form number, revision, distribution line. */
export function footer(formNo: string, distribution = 'ORIGINAL — CASE FILE&nbsp;&nbsp;·&nbsp;&nbsp;COPY — RECORDS'): string {
  return `<hr>
<p style="text-align:center;margin-top:2px;"><span style="${SERIF}font-size:8px;color:${CAP};">Form ${formNo}&nbsp;&nbsp;·&nbsp;&nbsp;Rev. 06/2026&nbsp;&nbsp;·&nbsp;&nbsp;${distribution}</span></p>`;
}

/** Statute reference line — plain italic authority cite, no banner/accent. */
export function statutes(refs: string[]): string {
  if (!refs.length) return '';
  return `<p style="margin-top:4px;margin-bottom:10px;"><strong><span style="${SERIF}font-size:9.5px;">Authority: </span></strong><em><span style="${SERIF}font-size:9.5px;">Utah Code ${refs.join(' · ')}</span></em></p>`;
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

/** Header info bar — used by ~80% of templates. Dense 3-up top row, full-width
 *  location bar beneath. Auto-populated from CAD/user via {{tokens}} that stay
 *  inline-editable in the writer. */
export function caseHeader(): string {
  return `<table><tr><td>${field('Case / Call No.', '{{case_number}}')}</td><td>${field('Incident Date / Time', '{{incident_date}}')}</td><td>${field('Reporting Officer / Badge', '{{reporting_officer}}&nbsp;·&nbsp;#{{badge_number}}')}</td></tr><tr><td colspan="3">${field('Location of Occurrence', '{{location}}')}</td></tr></table>`;
}

/** Narrative section: prompt + ruled writing area. */
export function narrative(opening?: string): string {
  return section('NARRATIVE') +
    `<p><em><span style="${SERIF}font-size:9.5px;color:${CAP};">Describe events in chronological order. Include who, what, when, where, why, and how. Identify all parties by full name on first reference.</span></em></p>` +
    (opening ? `<p>${opening}</p>` : '') +
    linedArea(6);
}
