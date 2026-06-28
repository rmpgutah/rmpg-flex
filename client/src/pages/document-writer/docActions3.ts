// Wave-5 Document Writer actions — 100 new features. Same contract as
// docActions.ts / docActions2.ts: each is a pure function over a TipTap
// Editor that inserts schema-safe HTML or runs an editor command. They are
// exported as WAVE5_ACTIONS and appended to ACTION_REGISTRY in docActions2,
// so every one is instantly searchable in the Command Palette (Ctrl+/),
// grouped by tab — the "easy to use" surface for all of them.
//
// SCHEMA NOTE: the editor strips per-cell/div inline styling on insert, so
// blocks are built from structure the schema keeps — tables (cell borders
// come from writer.css), h3/p/strong/em, <hr>, lists, and span color marks.
// No reliance on <td style> / background fills.

import type { Editor } from '@tiptap/react';
import type { DocAction } from './docActions2';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'); // escape quotes too — output is used inside HTML attributes
const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

function insert(editor: Editor, html: string) {
  editor.chain().focus().insertContent(html).run();
}

// ── HTML builders (schema-safe) ──
const heading = (t: string) => `<h3>${esc(t)}</h3>`;
/** Label→value form table (blank values are fillable cells). */
const kv = (rows: Array<[string, string?]>) =>
  `<table>${rows
    .map(([k, v]) => `<tr><td><strong>${esc(k)}</strong></td><td>${v && v.length ? esc(v) : '&nbsp;'}</td></tr>`)
    .join('')}</table>`;
/** Header row + N blank rows — a grid/log to fill in. */
const grid = (headers: string[], n: number) => {
  const h = `<tr>${headers.map((x) => `<td><strong>${esc(x)}</strong></td>`).join('')}</tr>`;
  const blank = `<tr>${headers.map(() => '<td>&nbsp;</td>').join('')}</tr>`;
  return `<table>${h}${Array(Math.max(1, n)).fill(blank).join('')}</table>`;
};
const centered = (html: string) => `<p style="text-align:center;">${html}</p>`;
const stamp = (label: string, color: string) =>
  `<p><strong><span style="color:${color};letter-spacing:0.08em;">[ ${esc(label)} ]</span></strong></p>`;

/** Wrap the current selection with pre/post, preserving inner formatting.
 *  With no selection, inserts the empty pair at the cursor. */
function wrapSel(editor: Editor, pre: string, post: string) {
  const { from, to, empty } = editor.state.selection;
  if (empty) { insert(editor, pre + post); return; }
  // Insert the closer first (higher position) so the opener position holds.
  editor.chain().focus().insertContentAt(to, post).insertContentAt(from, pre).run();
}

const now = () => new Date();
const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';

// ════════════════════════════════════════════════════════════════════════
// The 100 actions
// ════════════════════════════════════════════════════════════════════════
export const WAVE5_ACTIONS: DocAction[] = [
  // ── Insert · symbols & glyphs (20) ──
  { name: 'Bullet •', group: 'Insert', fn: (e) => insert(e, '•') },
  { name: 'Middle dot ·', group: 'Insert', fn: (e) => insert(e, '·') },
  { name: 'Right arrow →', group: 'Insert', fn: (e) => insert(e, '→') },
  { name: 'Left arrow ←', group: 'Insert', fn: (e) => insert(e, '←') },
  { name: 'Double arrow ⇒', group: 'Insert', fn: (e) => insert(e, '⇒') },
  { name: 'Up arrow ↑', group: 'Insert', fn: (e) => insert(e, '↑') },
  { name: 'Down arrow ↓', group: 'Insert', fn: (e) => insert(e, '↓') },
  { name: 'Plus-minus ±', group: 'Insert', fn: (e) => insert(e, '±') },
  { name: 'Multiply ×', group: 'Insert', fn: (e) => insert(e, '×') },
  { name: 'Divide ÷', group: 'Insert', fn: (e) => insert(e, '÷') },
  { name: 'Not equal ≠', group: 'Insert', fn: (e) => insert(e, '≠') },
  { name: 'Less-or-equal ≤', group: 'Insert', fn: (e) => insert(e, '≤') },
  { name: 'Greater-or-equal ≥', group: 'Insert', fn: (e) => insert(e, '≥') },
  { name: 'Approximately ≈', group: 'Insert', fn: (e) => insert(e, '≈') },
  { name: 'Per mille ‰', group: 'Insert', fn: (e) => insert(e, '‰') },
  { name: 'Euro €', group: 'Insert', fn: (e) => insert(e, '€') },
  { name: 'Cent ¢', group: 'Insert', fn: (e) => insert(e, '¢') },
  { name: 'One-half ½', group: 'Insert', fn: (e) => insert(e, '½') },
  { name: 'One-quarter ¼', group: 'Insert', fn: (e) => insert(e, '¼') },
  { name: 'Three-quarters ¾', group: 'Insert', fn: (e) => insert(e, '¾') },

  // ── Format · wraps, marks & layout (20) ──
  { name: 'Wrap in "quotes"', group: 'Format', fn: (e) => wrapSel(e, '“', '”') },
  { name: "Wrap in 'quotes'", group: 'Format', fn: (e) => wrapSel(e, '‘', '’') },
  { name: 'Wrap in (parentheses)', group: 'Format', fn: (e) => wrapSel(e, '(', ')') },
  { name: 'Wrap in [brackets]', group: 'Format', fn: (e) => wrapSel(e, '[', ']') },
  { name: 'Wrap in {braces}', group: 'Format', fn: (e) => wrapSel(e, '{', '}') },
  { name: 'Wrap in «guillemets»', group: 'Format', fn: (e) => wrapSel(e, '«', '»') },
  { name: 'Bold selection', group: 'Format', fn: (e) => e.chain().focus().toggleBold().run() },
  { name: 'Italic selection', group: 'Format', fn: (e) => e.chain().focus().toggleItalic().run() },
  { name: 'Strikethrough selection', group: 'Format', fn: (e) => e.chain().focus().toggleStrike().run() },
  { name: 'Highlight selection (yellow)', group: 'Format', fn: (e) => e.chain().focus().toggleHighlight({ color: '#fff59d' }).run() },
  { name: 'Centered title block', group: 'Format', fn: (e) => insert(e, `<h2 style="text-align:center;">DOCUMENT TITLE</h2>`) },
  { name: 'Centered section label', group: 'Format', fn: (e) => insert(e, centered('<strong>— SECTION —</strong>')) },
  { name: 'Align block center', group: 'Format', fn: (e) => e.chain().focus().setTextAlign('center').run() },
  { name: 'Align block right', group: 'Format', fn: (e) => e.chain().focus().setTextAlign('right').run() },
  { name: 'Blank line spacer', group: 'Format', fn: (e) => insert(e, '<p>&nbsp;</p>') },
  { name: 'Two-signature row', group: 'Format', fn: (e) => insert(e, grid(['Signature', 'Date', 'Signature', 'Date'], 1)) },
  { name: 'Three-signature row', group: 'Format', fn: (e) => insert(e, grid(['Prepared By', 'Reviewed By', 'Approved By'], 2)) },
  { name: 'Memo header (To/From/Re)', group: 'Format', fn: (e) => insert(e, kv([['TO', ''], ['FROM', ''], ['DATE', now().toLocaleDateString()], ['RE', '']])) },
  { name: 'Approval block', group: 'Format', fn: (e) => insert(e, heading('APPROVAL') + grid(['Action', 'Name / Title', 'Signature', 'Date'], 3)) },
  { name: 'Distribution list', group: 'Format', fn: (e) => insert(e, heading('DISTRIBUTION') + '<ul><li>Original — Case File</li><li>Copy — Records</li><li>Copy — Supervisor</li></ul>') },

  // ── Police / field blocks (25) ──
  { name: 'Field interview (FI) card', group: 'Police', fn: (e) => insert(e, heading('FIELD INTERVIEW CARD') + kv([['Date / Time', ''], ['Location', ''], ['Name', ''], ['DOB', ''], ['Address', ''], ['Phone', ''], ['Reason for Contact', ''], ['Officer / Unit', '']])) },
  { name: 'Traffic stop block', group: 'Police', fn: (e) => insert(e, heading('TRAFFIC STOP') + kv([['Date / Time', ''], ['Location', ''], ['Plate / State', ''], ['Vehicle (Y/M/M/Color)', ''], ['Driver', ''], ['DL # / State', ''], ['Reason for Stop', ''], ['Disposition', '']])) },
  { name: 'Property / evidence receipt', group: 'Police', fn: (e) => insert(e, heading('PROPERTY / EVIDENCE RECEIPT') + grid(['Item #', 'Description', 'Qty', 'Location Found', 'Recovered By'], 4)) },
  { name: 'Arrest / booking block', group: 'Police', fn: (e) => insert(e, heading('ARREST / BOOKING') + kv([['Arrestee', ''], ['DOB', ''], ['Charge(s)', ''], ['Date / Time of Arrest', ''], ['Location of Arrest', ''], ['Booking #', ''], ['Arresting Officer', '']])) },
  { name: 'BOLO block', group: 'Police', fn: (e) => insert(e, stamp('BOLO', '#b00020') + kv([['Subject / Vehicle', ''], ['Description', ''], ['Last Seen', ''], ['Direction of Travel', ''], ['Wanted For', ''], ['Caution / Hazards', ''], ['Contact', '']])) },
  { name: 'Vehicle pursuit log', group: 'Police', fn: (e) => insert(e, heading('PURSUIT LOG') + grid(['Time', 'Location', 'Speed', 'Direction', 'Notes'], 5)) },
  { name: 'K-9 deployment block', group: 'Police', fn: (e) => insert(e, heading('K-9 DEPLOYMENT') + kv([['Handler / Unit', ''], ['K-9 Name', ''], ['Date / Time', ''], ['Location', ''], ['Purpose', ''], ['Result', ''], ['Apprehension (Y/N)', '']])) },
  { name: 'Use-of-force continuum', group: 'Police', fn: (e) => insert(e, heading('USE-OF-FORCE CONTINUUM') + '<ol><li>Officer Presence</li><li>Verbal Commands</li><li>Empty-Hand Control</li><li>Less-Lethal (OC / CEW / Baton)</li><li>Lethal Force</li></ol>') },
  { name: 'Probable cause statement', group: 'Police', fn: (e) => insert(e, heading('STATEMENT OF PROBABLE CAUSE') + '<p>On the above date and time, your affiant observed the following facts establishing probable cause to believe that the offense(s) charged were committed:</p>' + '<p>&nbsp;</p><p>&nbsp;</p>') },
  { name: 'Victim information block', group: 'Police', fn: (e) => insert(e, heading('VICTIM INFORMATION') + kv([['Name', ''], ['DOB', ''], ['Address', ''], ['Phone', ''], ['Injuries', ''], ['Medical Treatment (Y/N)', ''], ['Relationship to Suspect', '']])) },
  { name: 'Witness statement block', group: 'Police', fn: (e) => insert(e, heading('WITNESS STATEMENT') + kv([['Witness', ''], ['DOB', ''], ['Contact', '']]) + '<p>Statement:</p><p>&nbsp;</p><p>&nbsp;</p>') },
  { name: 'Subject / defendant info', group: 'Police', fn: (e) => insert(e, heading('SUBJECT / DEFENDANT') + kv([['Name', ''], ['Aliases', ''], ['DOB', ''], ['Sex / Race', ''], ['Height / Weight', ''], ['Address', ''], ['SSN / OLN', ''], ['Scars / Marks / Tattoos', '']])) },
  { name: 'Citation / NTC block', group: 'Police', fn: (e) => insert(e, heading('CITATION / NOTICE TO APPEAR') + kv([['Citation #', ''], ['Violator', ''], ['Violation(s)', ''], ['Date / Time', ''], ['Location', ''], ['Court Date', ''], ['Officer', '']])) },
  { name: 'Incident timeline', group: 'Police', fn: (e) => insert(e, heading('INCIDENT TIMELINE') + grid(['Time', 'Event'], 6)) },
  { name: 'Radio traffic log', group: 'Police', fn: (e) => insert(e, heading('RADIO TRAFFIC LOG') + grid(['Time', 'Unit', 'Transmission'], 6)) },
  { name: 'Patrol / activity log', group: 'Police', fn: (e) => insert(e, heading('ACTIVITY LOG') + grid(['Time', 'Location', 'Activity / Disposition'], 8)) },
  { name: 'Mileage log', group: 'Police', fn: (e) => insert(e, heading('MILEAGE LOG') + grid(['Date', 'Unit', 'Start', 'End', 'Total'], 5)) },
  { name: 'Tow / impound block', group: 'Police', fn: (e) => insert(e, heading('TOW / IMPOUND') + kv([['Vehicle', ''], ['Plate / VIN', ''], ['Reason', ''], ['Tow Company', ''], ['Location Stored', ''], ['Hold (Y/N)', ''], ['Released To', '']])) },
  { name: 'Domestic violence supplement', group: 'Police', fn: (e) => insert(e, heading('DOMESTIC VIOLENCE SUPPLEMENT') + kv([['Relationship', ''], ['Primary Aggressor', ''], ['Prior History (Y/N)', ''], ['Weapons Involved', ''], ['Children Present (Y/N)', ''], ['Protective Order (Y/N)', ''], ['Lethality Assessment', '']])) },
  { name: 'Crisis / mental-health block', group: 'Police', fn: (e) => insert(e, heading('CRISIS / MENTAL HEALTH') + kv([['Subject', ''], ['Behavior Observed', ''], ['Danger to Self / Others', ''], ['Weapons (Y/N)', ''], ['Disposition', ''], ['Receiving Facility', '']])) },
  { name: 'Trespass warning block', group: 'Police', fn: (e) => insert(e, heading('TRESPASS WARNING') + kv([['Person Warned', ''], ['DOB', ''], ['Property / Address', ''], ['On Behalf Of', ''], ['Date / Time', ''], ['Duration', ''], ['Officer', '']]) + '<p>The above person was advised they are no longer permitted on the listed property and that return will result in arrest for criminal trespass.</p>') },
  { name: 'Field contact log', group: 'Police', fn: (e) => insert(e, heading('FIELD CONTACT LOG') + grid(['Time', 'Name', 'Location', 'Reason', 'Disposition'], 5)) },
  { name: 'Supplement report header', group: 'Police', fn: (e) => insert(e, heading('SUPPLEMENTAL REPORT') + kv([['Case #', ''], ['Original Report Date', ''], ['Supplement #', ''], ['Reporting Officer', ''], ['Date', now().toLocaleDateString()]])) },
  { name: 'Continuation page header', group: 'Police', fn: (e) => insert(e, centered('<strong>— CONTINUATION —</strong>') + kv([['Case #', ''], ['Page', ''], ['Officer', '']])) },
  { name: 'Disposition stamp', group: 'Police', fn: (e) => insert(e, stamp('CLEARED BY ARREST', '#1a7f37') + stamp('PENDING', '#b8860b') + stamp('UNFOUNDED', '#b00020')) },

  // ── Legal / court (15) ──
  { name: 'Affidavit jurat', group: 'Legal', fn: (e) => insert(e, '<p>Subscribed and sworn to before me this ____ day of ______________, 20____.</p>' + kv([['Notary Public', ''], ['My Commission Expires', '']])) },
  { name: 'Notary acknowledgment', group: 'Legal', fn: (e) => insert(e, heading('NOTARY ACKNOWLEDGMENT') + '<p>STATE OF UTAH&nbsp;&nbsp;)<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: ss.<br>COUNTY OF ______________&nbsp;&nbsp;)</p><p>On this ____ day of ______________, 20____, before me personally appeared ______________________, known to me (or proved on the basis of satisfactory evidence) to be the person whose name is subscribed to the foregoing instrument.</p>' + kv([['Notary Public', ''], ['Commission #', ''], ['Expires', '']])) },
  { name: 'Certificate of service', group: 'Legal', fn: (e) => insert(e, heading('CERTIFICATE OF SERVICE') + '<p>I hereby certify that on this ____ day of ______________, 20____, a true and correct copy of the foregoing was served upon the following by the method indicated:</p>' + grid(['Recipient', 'Method', 'Address / Email'], 3)) },
  { name: 'Verification (penalty of perjury)', group: 'Legal', fn: (e) => insert(e, '<p>I declare under criminal penalty under the law of the State of Utah that the foregoing is true and correct.</p>' + kv([['Signature', ''], ['Printed Name', ''], ['Date', '']])) },
  { name: 'Declaration block', group: 'Legal', fn: (e) => insert(e, heading('DECLARATION') + '<p>I, ______________________, declare as follows:</p><ol><li>I am over the age of 18 and competent to testify to the matters stated herein.</li><li>The following facts are within my personal knowledge.</li></ol>') },
  { name: 'Signature line (name/title/date)', group: 'Legal', fn: (e) => insert(e, '<p>________________________________</p>' + kv([['Name', ''], ['Title', ''], ['Date', '']])) },
  { name: 'Date line ____', group: 'Legal', fn: (e) => insert(e, 'Dated this ____ day of ______________, 20____.') },
  { name: 'Initial line ____', group: 'Legal', fn: (e) => insert(e, 'Initials: ______') },
  { name: 'Witness signature block', group: 'Legal', fn: (e) => insert(e, grid(['Witness Signature', 'Printed Name', 'Date'], 2)) },
  { name: 'Court caption block', group: 'Legal', fn: (e) => insert(e, centered('<strong>IN THE ____ JUDICIAL DISTRICT COURT</strong>') + centered('IN AND FOR ______________ COUNTY, STATE OF UTAH') + kv([['Plaintiff / State', ''], ['v.', ''], ['Defendant', ''], ['Case No.', '']])) },
  { name: 'Exhibit cover sheet', group: 'Legal', fn: (e) => insert(e, centered('<strong>EXHIBIT ____</strong>') + centered('______________________') + '<p>&nbsp;</p>') },
  { name: 'Proof of service block', group: 'Legal', fn: (e) => insert(e, heading('PROOF OF SERVICE') + kv([['Served Upon', ''], ['Date / Time of Service', ''], ['Manner of Service', ''], ['Address', ''], ['Server', '']])) },
  { name: 'Oath / affirmation line', group: 'Legal', fn: (e) => insert(e, '<p>Do you solemnly swear or affirm that the testimony you are about to give is the truth, the whole truth, and nothing but the truth?&nbsp;&nbsp;☐ Yes&nbsp;&nbsp;☐ No</p>') },
  { name: 'Filed-stamp box', group: 'Legal', fn: (e) => insert(e, kv([['FILED', ''], ['Date / Time', ''], ['Clerk', ''], ['Case No.', '']])) },
  { name: 'Page / line citation', group: 'Legal', fn: (e) => insert(e, '(p.&nbsp;____, ll.&nbsp;____–____)') },

  // ── Utility · fields, dates & productivity (20) ──
  { name: 'Insert date (long)', group: 'Utility', fn: (e) => insert(e, now().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })) },
  { name: 'Insert date (numeric)', group: 'Utility', fn: (e) => { const d = now(); insert(e, `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`); } },
  { name: 'Insert military time stamp', group: 'Utility', fn: (e) => { const d = now(); insert(e, `${pad2(d.getHours())}${pad2(d.getMinutes())} hrs ${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`); } },
  { name: 'Insert ISO timestamp', group: 'Utility', fn: (e) => { const d = now(); insert(e, `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`); } },
  { name: 'Insert weekday', group: 'Utility', fn: (e) => insert(e, now().toLocaleDateString('en-US', { weekday: 'long' })) },
  { name: 'Insert word count', group: 'Utility', fn: (e) => insert(e, `Word count: ${e.getText().trim().split(/\s+/).filter(Boolean).length}`) },
  { name: 'Insert character count', group: 'Utility', fn: (e) => insert(e, `Characters: ${e.getText().length}`) },
  { name: 'Insert reading time', group: 'Utility', fn: (e) => { const w = e.getText().trim().split(/\s+/).filter(Boolean).length; insert(e, `Est. reading time: ${Math.max(1, Math.round(w / 200))} min`); } },
  { name: 'Insert "Page __ of __"', group: 'Utility', fn: (e) => insert(e, 'Page&nbsp;____ of&nbsp;____') },
  { name: 'Insert document title placeholder', group: 'Utility', fn: (e) => insert(e, '[DOCUMENT TITLE]') },
  { name: 'Insert agency name', group: 'Utility', fn: (e) => insert(e, 'Rocky Mountain Protective Group') },
  { name: 'Insert TODO marker', group: 'Utility', fn: (e) => insert(e, '<p><strong><span style="color:#b8860b;">TODO:</span></strong>&nbsp;</p>') },
  { name: 'Insert NOTE marker', group: 'Utility', fn: (e) => insert(e, '<p><strong><span style="color:#1a7f37;">NOTE:</span></strong>&nbsp;</p>') },
  { name: 'Insert [REDACTED] marker', group: 'Utility', fn: (e) => insert(e, '<strong>[REDACTED]</strong>') },
  { name: 'Insert N/A', group: 'Utility', fn: (e) => insert(e, 'N/A') },
  { name: 'Insert Yes/No checkboxes', group: 'Utility', fn: (e) => insert(e, '☐&nbsp;Yes&nbsp;&nbsp;☐&nbsp;No') },
  { name: 'Insert signature underline', group: 'Utility', fn: (e) => insert(e, '________________________________') },
  { name: 'Insert confidential footer', group: 'Utility', fn: (e) => insert(e, centered('<span style="color:#6b6b6b;">CONFIDENTIAL — LAW ENFORCEMENT SENSITIVE</span>')) },
  { name: 'Insert Lorem ipsum (paragraph)', group: 'Utility', fn: (e) => insert(e, `<p>${LOREM}</p>`) },
  { name: 'Insert placeholder lines (5)', group: 'Utility', fn: (e) => insert(e, grid(['&nbsp;'], 5)) },
];
