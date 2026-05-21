// ============================================================
// RMPG Flex — Dispatch Guide PDF Generator
//
// Produces a printable training + quick-reference manual for the
// Dispatch Console. Combines narrative training content (call
// intake, unit status, safety flags, voice features) with a
// one-page quick-reference card at the end for dispatchers to
// tear off and keep at the console.
//
// This file is the SINGLE SOURCE OF TRUTH for the guide — update
// here when dispatch features change and the PDF regenerates on
// the next download click. No static artifact to keep in sync.
// ============================================================

import jsPDF from 'jspdf';

// ─── Layout constants ───────────────────────────────────────
const PAGE = { W: 612, H: 792, MARGIN: 54 }; // US Letter @ 72dpi, 0.75" margins
const LINE_H = 14;
const SECTION_GAP = 18;

const COLOR = {
  BLACK:    '#000000',
  INK:      '#1a1a1a',
  MUTED:    '#666666',
  ACCENT:   '#d4a017',   // Spillman gold
  SURFACE:  '#f4f4f4',
  RULE:     '#cccccc',
  RED:      '#b91c1c',
  GREEN:    '#166534',
};

// ─── Types ──────────────────────────────────────────────────
interface GuideContext {
  doc: jsPDF;
  y: number;
  page: number;
}

// ─── Primitive helpers ──────────────────────────────────────

function newPage(ctx: GuideContext): void {
  ctx.doc.addPage();
  ctx.page += 1;
  ctx.y = PAGE.MARGIN;
  pageHeader(ctx);
}

function ensureSpace(ctx: GuideContext, need: number): void {
  if (ctx.y + need > PAGE.H - PAGE.MARGIN - 24 /* footer */) {
    newPage(ctx);
  }
}

function pageHeader(ctx: GuideContext): void {
  const d = ctx.doc;
  d.setFont('helvetica', 'bold');
  d.setFontSize(8);
  d.setTextColor(COLOR.MUTED);
  d.text('RMPG Flex — Dispatch Console Guide', PAGE.MARGIN, 34);
  d.setFont('helvetica', 'normal');
  d.text('Rocky Mountain Protective Group', PAGE.W - PAGE.MARGIN, 34, { align: 'right' });
  d.setDrawColor(COLOR.RULE);
  d.setLineWidth(0.5);
  d.line(PAGE.MARGIN, 40, PAGE.W - PAGE.MARGIN, 40);
}

function pageFooter(ctx: GuideContext, total: number): void {
  const d = ctx.doc;
  d.setFont('helvetica', 'normal');
  d.setFontSize(8);
  d.setTextColor(COLOR.MUTED);
  d.text(`Page ${ctx.page} of ${total}`, PAGE.W / 2, PAGE.H - 28, { align: 'center' });
  d.text(generatedStamp(), PAGE.MARGIN, PAGE.H - 28);
  d.text('CONFIDENTIAL — AUTHORIZED USE ONLY', PAGE.W - PAGE.MARGIN, PAGE.H - 28, { align: 'right' });
}

function generatedStamp(): string {
  const d = new Date();
  return `Generated ${d.toISOString().slice(0, 10)}`;
}

function title(ctx: GuideContext, text: string, size = 18): void {
  ensureSpace(ctx, size + SECTION_GAP);
  ctx.doc.setFont('helvetica', 'bold');
  ctx.doc.setFontSize(size);
  ctx.doc.setTextColor(COLOR.BLACK);
  ctx.doc.text(text, PAGE.MARGIN, ctx.y + size);
  ctx.y += size + 4;
}

function h2(ctx: GuideContext, text: string): void {
  ensureSpace(ctx, 30);
  ctx.y += 8;
  ctx.doc.setFont('helvetica', 'bold');
  ctx.doc.setFontSize(13);
  ctx.doc.setTextColor(COLOR.ACCENT);
  ctx.doc.text(text, PAGE.MARGIN, ctx.y + 13);
  ctx.y += 16;
  ctx.doc.setDrawColor(COLOR.ACCENT);
  ctx.doc.setLineWidth(1);
  ctx.doc.line(PAGE.MARGIN, ctx.y, PAGE.MARGIN + 48, ctx.y);
  ctx.y += 8;
}

function h3(ctx: GuideContext, text: string): void {
  ensureSpace(ctx, 22);
  ctx.y += 4;
  ctx.doc.setFont('helvetica', 'bold');
  ctx.doc.setFontSize(11);
  ctx.doc.setTextColor(COLOR.INK);
  ctx.doc.text(text, PAGE.MARGIN, ctx.y + 11);
  ctx.y += 16;
}

function paragraph(ctx: GuideContext, text: string, indent = 0): void {
  ctx.doc.setFont('helvetica', 'normal');
  ctx.doc.setFontSize(10);
  ctx.doc.setTextColor(COLOR.INK);
  const maxW = PAGE.W - PAGE.MARGIN * 2 - indent;
  const lines = ctx.doc.splitTextToSize(text, maxW) as string[];
  for (const line of lines) {
    ensureSpace(ctx, LINE_H);
    ctx.doc.text(line, PAGE.MARGIN + indent, ctx.y + 10);
    ctx.y += LINE_H;
  }
  ctx.y += 4;
}

function bullet(ctx: GuideContext, text: string): void {
  ctx.doc.setFont('helvetica', 'normal');
  ctx.doc.setFontSize(10);
  ctx.doc.setTextColor(COLOR.INK);
  const maxW = PAGE.W - PAGE.MARGIN * 2 - 14;
  const lines = ctx.doc.splitTextToSize(text, maxW) as string[];
  for (let i = 0; i < lines.length; i++) {
    ensureSpace(ctx, LINE_H);
    if (i === 0) {
      ctx.doc.setFont('helvetica', 'bold');
      ctx.doc.text('•', PAGE.MARGIN + 4, ctx.y + 10);
      ctx.doc.setFont('helvetica', 'normal');
    }
    ctx.doc.text(lines[i], PAGE.MARGIN + 14, ctx.y + 10);
    ctx.y += LINE_H;
  }
}

function calloutBox(ctx: GuideContext, label: string, body: string, tone: 'info' | 'warn' = 'info'): void {
  ctx.doc.setFont('helvetica', 'bold');
  ctx.doc.setFontSize(10);
  const maxW = PAGE.W - PAGE.MARGIN * 2 - 20;
  const bodyLines = ctx.doc.splitTextToSize(body, maxW) as string[];
  const boxH = 20 + bodyLines.length * LINE_H;
  ensureSpace(ctx, boxH + 6);

  ctx.doc.setFillColor(tone === 'warn' ? '#fff4f2' : '#fffbea');
  ctx.doc.setDrawColor(tone === 'warn' ? COLOR.RED : COLOR.ACCENT);
  ctx.doc.setLineWidth(1);
  ctx.doc.rect(PAGE.MARGIN, ctx.y, PAGE.W - PAGE.MARGIN * 2, boxH, 'FD');

  ctx.doc.setTextColor(tone === 'warn' ? COLOR.RED : COLOR.ACCENT);
  ctx.doc.setFontSize(9);
  ctx.doc.text(label.toUpperCase(), PAGE.MARGIN + 10, ctx.y + 14);

  ctx.doc.setFont('helvetica', 'normal');
  ctx.doc.setFontSize(10);
  ctx.doc.setTextColor(COLOR.INK);
  for (let i = 0; i < bodyLines.length; i++) {
    ctx.doc.text(bodyLines[i], PAGE.MARGIN + 10, ctx.y + 28 + i * LINE_H);
  }
  ctx.y += boxH + 8;
}

/**
 * Draw a table with `cols` columns and `rows` of data. Column widths
 * are proportional to `colWeights`. Header row is bolded + filled.
 */
function table(
  ctx: GuideContext,
  headers: string[],
  rows: string[][],
  colWeights: number[],
  fontSize = 9,
): void {
  const contentW = PAGE.W - PAGE.MARGIN * 2;
  const totalW = colWeights.reduce((a, b) => a + b, 0);
  const colWidths = colWeights.map((w) => (w / totalW) * contentW);
  const rowH = fontSize + 8;
  const padding = 4;

  const drawRow = (cells: string[], isHeader: boolean): void => {
    ctx.doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
    ctx.doc.setFontSize(fontSize);
    ctx.doc.setTextColor(isHeader ? COLOR.BLACK : COLOR.INK);

    // Compute row height based on wrapped content
    const cellLines = cells.map((cell, i) =>
      ctx.doc.splitTextToSize(cell, colWidths[i] - padding * 2) as string[],
    );
    const maxLines = Math.max(1, ...cellLines.map((l) => l.length));
    const dynamicH = Math.max(rowH, maxLines * (fontSize + 4) + 4);

    ensureSpace(ctx, dynamicH);

    if (isHeader) {
      ctx.doc.setFillColor(COLOR.SURFACE);
      ctx.doc.rect(PAGE.MARGIN, ctx.y, contentW, dynamicH, 'F');
    }

    ctx.doc.setDrawColor(COLOR.RULE);
    ctx.doc.setLineWidth(0.5);
    let x = PAGE.MARGIN;
    for (let i = 0; i < cells.length; i++) {
      ctx.doc.rect(x, ctx.y, colWidths[i], dynamicH, 'S');
      for (let li = 0; li < cellLines[i].length; li++) {
        ctx.doc.text(cellLines[i][li], x + padding, ctx.y + fontSize + 2 + li * (fontSize + 4));
      }
      x += colWidths[i];
    }
    ctx.y += dynamicH;
  };

  drawRow(headers, true);
  for (const row of rows) drawRow(row, false);
  ctx.y += 4;
}

// ─── Content blocks ─────────────────────────────────────────

function coverPage(ctx: GuideContext): void {
  const d = ctx.doc;
  const cx = PAGE.W / 2;

  // Gold bar at top
  d.setFillColor(COLOR.ACCENT);
  d.rect(0, 120, PAGE.W, 6, 'F');

  d.setFont('helvetica', 'bold');
  d.setFontSize(32);
  d.setTextColor(COLOR.BLACK);
  d.text('DISPATCH CONSOLE', cx, 220, { align: 'center' });

  d.setFontSize(22);
  d.text('Training & Quick Reference Guide', cx, 258, { align: 'center' });

  d.setFont('helvetica', 'normal');
  d.setFontSize(12);
  d.setTextColor(COLOR.MUTED);
  d.text('Rocky Mountain Protective Group', cx, 300, { align: 'center' });
  d.text('Salt Lake City, Utah', cx, 318, { align: 'center' });

  // Gold bar
  d.setFillColor(COLOR.ACCENT);
  d.rect(0, 390, PAGE.W, 6, 'F');

  d.setFont('helvetica', 'normal');
  d.setFontSize(10);
  d.setTextColor(COLOR.INK);
  const tocY = 410;
  d.setFont('helvetica', 'bold');
  d.setFontSize(11);
  d.text('CONTENTS', cx, tocY, { align: 'center' });
  d.setFont('helvetica', 'normal');
  d.setFontSize(10);
  const toc = [
    '1. Console Overview',
    '2. Taking a Call End-to-End',
    '3. Unit Status & 10-Codes',
    '4. Safety Flags & Priority Levels',
    '5. F-Key Hotkeys',
    '6. CAD Command Line',
    '7. Voice Features (Dispatcher Brain)',
    '8. Common Workflows',
    '9. Troubleshooting',
    '10. Radio Etiquette & Voice Protocols',
    '11. Documentation Standards',
    '12. Using the Map',
    '13. Shift Change Procedure',
    'Appendix A — Incident Type Reference',
    'Appendix B — Disposition Codes',
    'Appendix C — Architecture for Dispatchers',
    '— Quick-Reference Card (last page) —',
  ];
  for (let i = 0; i < toc.length; i++) {
    d.text(toc[i], cx, tocY + 20 + i * 15, { align: 'center' });
  }

  // Bottom stamp
  d.setFontSize(9);
  d.setTextColor(COLOR.MUTED);
  d.text(`${generatedStamp()}  •  CONFIDENTIAL — AUTHORIZED USE ONLY`, cx, PAGE.H - 48, { align: 'center' });
}

function section1(ctx: GuideContext): void {
  title(ctx, '1. Console Overview');

  paragraph(ctx,
    'The Dispatch Console is the control center for managing active calls-for-service, unit status, and field activity. It combines a real-time call stack, unit roster, map, and a command line that mirrors traditional CAD radio shorthand. Everything you see updates live across every connected workstation via WebSocket — when another dispatcher changes a unit\'s status, your screen reflects it within roughly one second. There is no manual refresh; the authoritative state lives on the server, and your screen is always rendering the latest snapshot.',
  );

  paragraph(ctx,
    'The console is designed around one principle: the dispatcher should never have to hunt for information. Everything an officer might ask you for — nearest unit, premise alerts, outstanding warrants on a subject, priority call count, beat assignment — should be visible or one hotkey away. If you find yourself clicking through more than two menus to answer a question, there is almost certainly a command-line shortcut that gets you there instantly. Section 6 covers those.',
  );

  h2(ctx, 'Screen Layout');
  paragraph(ctx,
    'The desktop layout has six regions. On mobile and tablet the same panels collapse into a drawer, but the keyboard-first workflow is designed for the desktop console:',
  );
  bullet(ctx, 'Brand bar (52px tall) — agency logo, workstation identifier, and the current dispatcher\'s name and role. The role badge is color-coded: gold for admin, gray for dispatcher, blue for supervisor.');
  bullet(ctx, 'Menu bar (22px) — File, View, Tools, Help dropdowns plus the global search box. Press Alt-F / Alt-V / Alt-T / Alt-H to open each menu with the keyboard.');
  bullet(ctx, 'Icon toolbar (46px) — quick-jump buttons to Dispatch, Map, Records, BOLO, Warrants, Incidents, Citations, Cases. Each icon has an F-key mapping listed in Help → Keyboard Shortcuts.');
  bullet(ctx, 'Call list (left column, default 320px wide) — every active call sorted by priority descending, then by age. Pending calls float to the top within their priority class. Priority tint: red background for P1, orange for P2, yellow for P3, gray for P4.');
  bullet(ctx, 'Unit roster (center column, default 280px) — grouped by status: Available, Dispatched, Enroute, On Scene, Busy, Out of Service, Off Duty. The group header shows the count; click it to collapse. An LED dot next to each call sign indicates GPS freshness: green = updated within 2 minutes, amber = 2-10 minutes, red = stale beyond 10 minutes.');
  bullet(ctx, 'Detail pane (right column, default 480px) — everything about the selected call: address with map pin, caller info, narrative notes (newest at top), linked persons and vehicles, safety flags, disposition, and the full audit log.');
  bullet(ctx, 'Map (bottom half or separate tab depending on your view) — unit GPS pins, active call markers, beat polygons colored by sector, optional offline tile layer. Click any pin to jump the detail pane to that unit or call.');
  bullet(ctx, 'Status bar (22px tall at the bottom, always visible) — live counts of P1/P2 calls, units dispatched, F-key hint strip, system clock (America/Denver), WebSocket connection indicator, and the master sound toggle.');

  h2(ctx, 'Reading the Screen at a Glance');
  paragraph(ctx,
    'The Spillman-Flex-inspired visual language is dense by design — every pixel of screen real estate carries information. The colors and LEDs mean specific things:',
  );
  bullet(ctx, 'Green LED (solid) — in service, fresh GPS, healthy connection.');
  bullet(ctx, 'Amber LED (solid) — attention needed, stale GPS, moderate-severity alert in the brain queue.');
  bullet(ctx, 'Red LED (solid or pulsing) — emergency, panic, officer-down, or major-severity alert. Pulsing means active and unresolved.');
  bullet(ctx, 'Gold text (#d4a017) — actionable brand accent. Buttons with gold borders are the primary action on their panel.');
  bullet(ctx, 'Gray text (#888888) — passive label text. Values and data use light gray (#dddddd).');
  bullet(ctx, 'Red priority stripe on a call card — the call has one or more safety flags. Hover for the flag list.');
  bullet(ctx, 'Flashing red banner across the top of the map — active pursuit in progress.');
  bullet(ctx, 'Italic white on gold — the currently-selected call or unit. Only one item at a time carries this treatment.');

  h2(ctx, 'Resizable Panels');
  paragraph(ctx,
    'Every vertical divider between panels is draggable. Your layout persists in local storage per workstation, so the view you leave at the end of one shift is the view you pick up on the next. Two common layouts are worth knowing:',
  );
  bullet(ctx, 'Busy-shift layout — widen the call list to ~40% of the screen and narrow the map to the bottom 25%. You can see a dozen pending calls at once and triage by priority without scrolling.');
  bullet(ctx, 'Shift-change layout — widen the unit roster to 40% so the whole fleet fits without scrolling. Use this during the five-minute window after shift change when you are verifying every unit has logged in.');
  bullet(ctx, 'Map-heavy layout — collapse the detail pane to its minimum width and expand the map to two-thirds of the screen. Useful during pursuits, multi-unit tactical operations, or when coordinating a search grid.');

  calloutBox(ctx, 'Tip',
    'Press F1 at any time to open the on-screen keyboard-shortcut overlay. It highlights the active hotkeys for whatever panel currently has focus. Press F1 again or Escape to dismiss.',
  );

  h2(ctx, 'Keyboard-First Philosophy');
  paragraph(ctx,
    'Traditional CAD systems were built for keyboard operators who never lifted their hands from the home row. RMPG Flex preserves that model wherever possible: every action that happens more than once in a shift has an F-key or command-line shortcut. The mouse is useful for map inspection and reviewing historical records, but for live call management you should be faster with the keyboard. Accept the learning curve — a dispatcher who has memorized the command line will out-triage a dispatcher who clicks through menus by roughly three-to-one on a busy night.',
  );
  paragraph(ctx,
    'A good dispatcher-in-training drill: pick five common actions (new call, assign unit, mark on-scene, clear call, run plate) and practice doing each without touching the mouse. Section 5 and Section 6 together cover every hotkey and verb you need for those five and many more.',
  );

  h2(ctx, 'Connectivity & Offline Behavior');
  paragraph(ctx,
    'The console degrades gracefully when the network flakes. The WebSocket connection indicator in the status bar shows four states: CONNECTED (green), RECONNECTING (amber pulse), DISCONNECTED (red), and OFFLINE-READ-ONLY (red with a lock icon). In disconnected mode, the console continues to display the last-known state and queues your local writes in IndexedDB — when the WebSocket reconnects, writes replay to the server in the order you made them. Offline mode exists primarily for the Electron desktop wrapper on mobile patrol laptops; production dispatch workstations should never lose connectivity for more than a few seconds.',
  );

  paragraph(ctx,
    'If you see the reconnecting indicator for more than thirty seconds, manually refresh the page (Ctrl+R on Windows, Cmd+R on Mac). If the page does not load after a refresh, move to the next workstation and notify the on-call admin. The fastest path to restored service is almost always another healthy workstation and a ticket to IT — not troubleshooting on the broken one.',
  );

  calloutBox(ctx, 'Emergency Fallback',
    'If the console is fully unreachable during a shift (server down, network severed), fall back to radio plus paper logs immediately. When service returns, the dispatch audit log can be reconstructed from the radio recording system. Never delay a response waiting for the console to come back.',
    'warn',
  );
}

function section2(ctx: GuideContext): void {
  title(ctx, '2. Taking a Call End-to-End');

  paragraph(ctx,
    'A typical call flows through six states: pending, dispatched, enroute, on-scene, clearing, archived. Every transition is audited with a server-side timestamp, the dispatcher who triggered it, and the unit involved. That audit trail is what makes dispatch a legal record — you cannot erase it, you can only add correcting notes on top. Assume everything you type, click, or say through the voice channel is permanent and discoverable in court.',
  );

  paragraph(ctx,
    'This section walks through a typical call from ring-in to archive, with the keystrokes, the required fields, and the judgment calls that only a human can make. Section 8 covers specific workflows (pursuits, multi-unit, mental-health response) in detail.',
  );

  h2(ctx, 'Step 1 — Create the call');
  paragraph(ctx,
    'The clock starts when the phone rings. Your first obligation is life safety — get enough information to send help quickly, then refine as the caller talks. Do not wait for a complete picture before opening the call record.',
  );
  bullet(ctx, 'Press F2 or click "New Call" in the call list. The intake form opens with your cursor already in the incident-type field.');
  bullet(ctx, 'Type the incident type. Autocomplete surfaces matching types as you type — "dom" shows "Domestic Disturbance", "Domestic Violence", "Domestic Medical"; "sus" shows "Suspicious Person", "Suspicious Vehicle", "Suspicious Circumstances". Tab to accept a suggestion.');
  bullet(ctx, 'Address: start typing, the map geocodes as you go. Utah-specific addresses (e.g. "1234 S 500 E, SLC") and apartment numbers are supported. Verify the pin on the map before saving — a misgeocoded address sends units to the wrong block and costs minutes.');
  bullet(ctx, 'If the caller cannot give an address, use cross streets ("Main and Center") or a landmark ("Smith\'s Grocery parking lot"). The geocoder understands these but the pin will be less precise.');
  bullet(ctx, 'Caller info: name, callback number (required for any incident that may need follow-up), relationship to incident (victim, witness, involved, reporting party).');
  bullet(ctx, 'Priority auto-populates from incident type but you can override in the P1-P4 dropdown. If the caller describes active violence, weapons, or immediate threat to life, upgrade to P1 regardless of the default.');
  bullet(ctx, 'Flag safety concerns BEFORE saving: weapons, DV, felony in progress, mental health crisis, officer safety caution, pursuit, hazmat, juvenile involved. Section 4 details each.');
  bullet(ctx, 'Click Save (or press Ctrl+Enter). The call appears at the top of the pending list and broadcasts to every connected workstation. All dispatchers see it immediately.');

  calloutBox(ctx, 'Save Early, Refine Often',
    'It is better to save a call with incomplete information and dispatch a unit in 30 seconds than to wait 90 seconds for complete information before saving. Units can be enroute while you continue gathering details from the caller. The notes field accepts updates in real time and broadcasts every change.',
  );

  h2(ctx, 'Step 1.5 — Key intake questions');
  paragraph(ctx,
    'Whatever your agency\'s intake script requires, these eight questions cover ninety percent of calls and should become automatic:',
  );
  bullet(ctx, 'Where is this happening? (address or cross streets)');
  bullet(ctx, 'What is happening? (nature of the incident in one sentence)');
  bullet(ctx, 'Is anyone hurt? Do you need medical?');
  bullet(ctx, 'Are weapons involved or has anyone mentioned weapons?');
  bullet(ctx, 'Is the suspect still there? If not, which direction did they go? How long ago?');
  bullet(ctx, 'Description of suspect: height, build, clothing, hair, distinctive features.');
  bullet(ctx, 'Your name and a callback number in case we get disconnected.');
  bullet(ctx, 'Is there anything else responding officers should know before they arrive?');

  h2(ctx, 'Step 2 — Assign a unit');
  paragraph(ctx,
    'Who you send depends on three things: proximity, specialty, and availability. The unit roster shows each unit\'s current status and GPS-derived distance from the call (when GPS is fresh). Availability ordering is: Available > Busy-but-clearing-soon > Dispatched-to-lower-priority > Out-of-service.',
  );
  bullet(ctx, 'Select the call (click it or use CI <call#> in the command line — see Section 6).');
  bullet(ctx, 'Press F3 or click Dispatch, then pick a unit from the available roster. The roster reorders to put the closest available units at the top.');
  bullet(ctx, 'Specialty calls need specialty units: K9 requests go to K9-capable units, mental-health calls go to CIT-trained officers when available, hazmat requires HazMat-certified responders.');
  bullet(ctx, 'The unit receives the call on their mobile/MDT within two seconds; status changes to "dispatched" and they acknowledge by setting 10-4 or their own status.');
  bullet(ctx, 'For P1 or multi-unit calls, dispatch a second unit immediately. The Dispatcher Brain (Section 7) will prompt you to do this if it detects a felony-in-progress with only one unit assigned.');
  bullet(ctx, 'EMS and Fire: coordinate through their own dispatch (separate radio + separate CAD) but record your coordination in the call notes so the audit trail is complete.');

  h2(ctx, 'Step 3 — Track status transitions');
  paragraph(ctx,
    'Units drive their own status in the field — the F-keys on your console are for cases where you need to force a status change (bad GPS, unit cannot reach their MDT, verbal request over the radio). Expected transition times on a typical response:',
  );
  bullet(ctx, 'Dispatched to Enroute: under 60 seconds. If longer, check radio.');
  bullet(ctx, 'Enroute to On Scene: varies by distance and priority. P1 lights-and-siren calls within three miles should arrive in 3-5 minutes. If a P1 has been enroute for more than eight minutes with no on-scene, that is a red flag — radio check.');
  bullet(ctx, 'On Scene to Clear: varies wildly by call type. Welfare checks may clear in 10 minutes, DV investigations may take 90.');
  bullet(ctx, 'F5 = En Route (unit acknowledged and is moving).');
  bullet(ctx, 'F6 = On Scene (unit has arrived). The eight-minute welfare-check timer starts automatically when you or the unit sets this status.');
  bullet(ctx, 'F7 = Clear (call resolved). Prompts for disposition code.');

  calloutBox(ctx, 'Red Flag',
    'A unit that stops updating status or moving on GPS while on a call is a welfare-check trigger. Radio the unit. No response within two minutes, dispatch a cover unit and escalate to supervisor. The brain\'s overdue-status rule (8 minutes on-scene with no status update) is your safety net, not your primary awareness — you should notice before the brain speaks.',
    'warn',
  );

  h2(ctx, 'Step 4 — Document during the call');
  paragraph(ctx,
    'Use the notes field continuously. Every note timestamps and broadcasts so another dispatcher can pick up mid-call without asking "what is happening?". The rule of thumb: anything you would say on the radio to brief a supervisor should also appear as a note.',
  );
  h3(ctx, 'What makes a good note');
  bullet(ctx, 'Timestamped by the system — you do not need to write the time yourself.');
  bullet(ctx, 'Attributable — your note is saved under your user account; readers know who wrote it.');
  bullet(ctx, 'Objective and observational — "caller states subject is in the garage" not "caller sounds nervous, probably lying".');
  bullet(ctx, 'Specific — "male, 30s, red hoodie, black backpack, last seen WB on 400 S" beats "suspect ran".');
  bullet(ctx, 'Linked — add persons and vehicles to the call as structured records rather than just mentioning them in prose. Structured records carry into incident reports and searches.');

  h3(ctx, 'What NOT to put in notes');
  bullet(ctx, 'Speculation about guilt or innocence. "Looks guilty" has no place in a permanent record.');
  bullet(ctx, 'Protected health information beyond what is operationally necessary. "Subject appears intoxicated" is fine; specific diagnoses are not.');
  bullet(ctx, 'Opinions about officers, colleagues, or supervisors. Use the appropriate HR or supervisor-feedback channel instead.');
  bullet(ctx, 'Personal information about uninvolved third parties.');
  bullet(ctx, 'Profanity or slang that would embarrass the agency if read in court.');

  h2(ctx, 'Step 5 — Convert to incident (if required)');
  paragraph(ctx,
    'Many calls resolve without generating a formal incident report. A welfare check where the subject is fine, a noise complaint that quiets down, a suspicious vehicle that turns out to be a neighbor — these clear without a report. But a call requires an incident report any time any of the following is true:',
  );
  bullet(ctx, 'An arrest was made.');
  bullet(ctx, 'Any person was injured, whether by suspect, officer, or accident.');
  bullet(ctx, 'Property damage occurred or was reported.');
  bullet(ctx, 'A crime victim wants a report for insurance, protection order, or prosecution.');
  bullet(ctx, 'A use-of-force event happened.');
  bullet(ctx, 'The call involved a domestic-violence incident (regardless of arrest).');
  bullet(ctx, 'A juvenile was the victim, subject, or witness to a crime.');
  bullet(ctx, 'A supervisor, officer, or prosecutor requests a report for any reason.');

  paragraph(ctx,
    'From the detail pane of the open call, click "Convert to Incident". Persons, vehicles, the full notes timeline, and all linked records auto-carry into the incident — the officer only adds the narrative and any evidence or charges that the call record did not already capture.',
  );

  h2(ctx, 'Step 6 — Clear the call');
  paragraph(ctx,
    'Clearing is the final act on a call and should never be rushed. Once archived, the disposition cannot be edited — you can only add correction notes on top. Verify with the officer that they are actually clear before pressing F7.',
  );
  bullet(ctx, 'Press F7 with the call selected. The disposition dialog opens.');
  bullet(ctx, 'Choose a disposition code — "Arrest Made", "Report Taken", "Gone On Arrival", "Unfounded", "Assistance Rendered", "Referred to Other Agency", "Canceled by Caller", etc.');
  bullet(ctx, 'Add a brief disposition note summarizing the outcome. One or two sentences is enough.');
  bullet(ctx, 'Save. The call moves to "archived" and becomes searchable from Records.');
  bullet(ctx, 'The unit automatically returns to "available" unless they have separately requested out-of-service, are assigned to another call, or have logged off duty.');

  h2(ctx, 'Handoffs Mid-Call');
  paragraph(ctx,
    'Every call is a shared state across every dispatcher in the room. If you have to step away mid-call — restroom, phone call, another dispatcher\'s emergency — the call continues living in the pending or active lists and any dispatcher can take over. The handoff itself is implicit in the system design, but a verbal handoff to the dispatcher sitting next to you is still best practice on any non-trivial call.',
  );
  bullet(ctx, 'On P1 / active-violence calls, never leave without verbally handing off.');
  bullet(ctx, 'On routine calls, a quick "I have call CN-26-0457 under control, stepping away for 5 minutes" is enough.');
  bullet(ctx, 'The audit log shows every dispatcher who has touched the call, so there is no ambiguity about who did what.');
  bullet(ctx, 'If a call crosses shift change, the outgoing dispatcher should bring the incoming dispatcher up to speed verbally AND in the shift handoff note field. Section 8 covers shift-change procedure in detail.');
}

function section3(ctx: GuideContext): void {
  title(ctx, '3. Unit Status & 10-Codes');

  paragraph(ctx,
    'RMPG Flex accepts the standard 10-codes used across Utah law enforcement, plus a set of agency-specific signal codes. Officers can speak codes through the voice channel, type them on the command line, click status chips in the roster, or tap them on their mobile MDT. However they are triggered, the status transition broadcasts to every dispatcher in real time.',
  );

  paragraph(ctx,
    'A common question during training is "why 10-codes instead of plain English?" The answer is threefold: brevity on a crowded radio channel, privacy from bystanders and scanners, and unambiguous meaning. "Ten-ninety-seven" is impossible to confuse with any other transmission; "on scene" can get cut off in radio traffic and become "scene" which means nothing specific.',
  );

  h2(ctx, '10-Code Reference');
  paragraph(ctx,
    'This is the full set recognized by the CAD command line and voice channel. Cells in the Status column match the unit-status values that appear in the roster.',
  );
  table(ctx,
    ['Code', 'Status', 'Meaning'],
    [
      ['10-1',  '-',           'Receiving poorly / signal weak'],
      ['10-2',  '-',           'Receiving well'],
      ['10-3',  '-',           'Stop transmitting'],
      ['10-4',  'ACK',         'Acknowledged / understood'],
      ['10-5',  '-',           'Relay (pass message to third party)'],
      ['10-6',  'BUSY',        'Busy — not immediately available'],
      ['10-7',  'OUT SERVICE', 'Out of service (meals, fuel, admin)'],
      ['10-7B', 'OUT SERVICE', 'Out of service for restroom'],
      ['10-7C', 'OUT SERVICE', 'Out of service for court'],
      ['10-8',  'AVAILABLE',   'In service, available for calls'],
      ['10-9',  '-',           'Repeat last transmission'],
      ['10-10', 'BREAK',       'On break / off duty temporarily'],
      ['10-15', '-',           'Prisoner in custody / transport'],
      ['10-19', '-',           'Return to station'],
      ['10-20', 'LOCATION',    'What is your location?'],
      ['10-22', '-',           'Disregard'],
      ['10-23', 'STANDBY',     'Stand by'],
      ['10-25', '-',           'Can you meet?'],
      ['10-27', '-',           'Driver\'s license check'],
      ['10-28', '-',           'Vehicle registration check'],
      ['10-29', '-',           'Want / warrant check'],
      ['10-32', '-',           'Subject with gun / weapons'],
      ['10-33', '-',           'EMERGENCY — all units hold traffic'],
      ['10-50', 'TC',          'Traffic collision'],
      ['10-55', '-',           'Intoxicated driver'],
      ['10-70', '-',           'Fire alarm / fire'],
      ['10-76', 'EN ROUTE',    'En route / responding'],
      ['10-97', 'ON SCENE',    'Arrived / on scene'],
      ['10-98', '-',           'Assignment completed'],
      ['10-99', 'EMERGENCY',   'Officer emergency (triggers panic)'],
    ],
    [2, 3, 6],
  );

  h2(ctx, 'Status Transitions');
  paragraph(ctx,
    'Units move through a predictable set of status values during a shift. The console enforces legal transitions: a unit cannot go from Off Duty directly to On Scene, for example — they must Log On first. The valid transitions are:',
  );
  bullet(ctx, 'Off Duty -> Available (unit logs on at start of shift).');
  bullet(ctx, 'Available -> Dispatched (assigned to a call).');
  bullet(ctx, 'Dispatched -> Enroute (unit acknowledged and is moving).');
  bullet(ctx, 'Enroute -> On Scene (arrived at location).');
  bullet(ctx, 'On Scene -> Available (call cleared, back in service).');
  bullet(ctx, 'Any in-service status -> Busy (temporarily engaged, not available).');
  bullet(ctx, 'Any in-service status -> Out of Service (meals, fuel, court, admin).');
  bullet(ctx, 'Out of Service / Busy -> Available (resumed in-service status).');
  bullet(ctx, 'Available -> Off Duty (unit logs off at end of shift).');

  paragraph(ctx,
    'The Dispatcher Brain timer-rule (Section 7) watches for stuck states — a unit in Dispatched for more than 90 seconds without an Enroute, or On Scene for more than 8 minutes without a status update. Both trigger spoken reminders to the dispatcher responsible for the call.',
  );

  h2(ctx, 'Signal Codes (Agency-Specific)');
  paragraph(ctx,
    'In addition to 10-codes, RMPG uses signal codes for operational categories that do not have standard 10-code equivalents. Signal codes are typed as "S" followed by a number and always spoken in full ("signal fifty").',
  );
  table(ctx,
    ['Signal', 'Meaning'],
    [
      ['S-3',   'Shots fired'],
      ['S-10',  'Bomb threat'],
      ['S-20',  'Robbery in progress'],
      ['S-30',  'Burglary in progress'],
      ['S-40',  'Prowler'],
      ['S-50',  'Suicide attempt / threat'],
      ['S-60',  'Missing person'],
      ['S-70',  'Mental health subject'],
      ['S-99',  'Officer needs assistance — not life threatening'],
      ['S-100', 'Disturbance'],
    ],
    [2, 8],
  );

  calloutBox(ctx, 'Safety',
    '10-99 and Signal-3 (shots fired) are the two signals that MUST never be used casually. Saying either through the voice channel broadcasts an emergency to every workstation, plays the panic tone, clears the speak-queue of lower-priority items, and pages the on-call supervisor. False activations require an incident report and a supervisor conversation.',
    'warn',
  );

  h2(ctx, 'Looking Up a Code');
  paragraph(ctx,
    'If an officer says a code you do not recognize, three ways to look it up without interrupting radio traffic:',
  );
  bullet(ctx, 'Press F8, type "LE 29" (or whatever the code is), Enter. The lookup pops in the command line response area.');
  bullet(ctx, 'Help menu -> Quick Reference -> 10-Codes Reference. Opens a searchable popover.');
  bullet(ctx, 'Hover over any code chip in the unit roster — the tooltip shows meaning.');
}

function section4(ctx: GuideContext): void {
  title(ctx, '4. Safety Flags & Priority Levels');

  paragraph(ctx,
    'Priority and safety flags do two things: they tell responding officers what they are walking into, and they tell the CAD system how urgently to dispatch. Priority is a single P1-P4 level; safety flags are one or more tags that describe specific hazards. A call can have any combination of flags regardless of priority.',
  );

  h2(ctx, 'Priority Levels');
  paragraph(ctx,
    'Every call must be assigned a priority. The system auto-populates based on incident type (e.g. "robbery in progress" defaults to P1; "vandalism report" defaults to P3) but the dispatcher always has final say and can override.',
  );
  table(ctx,
    ['Priority', 'Meaning', 'Typical Response', 'Color'],
    [
      ['P1', 'Emergency — immediate life or safety threat', 'Lights + siren, nearest unit, second unit coming',  'Red'],
      ['P2', 'Urgent — crime in progress or imminent',      'Respond promptly, no lights/siren unless needed',   'Orange'],
      ['P3', 'Routine — reported, delay acceptable',        'Standard response, closest available unit',         'Yellow'],
      ['P4', 'Cold — report only, no on-scene response',    'Phone report, deferred visit, or online report',    'Gray'],
    ],
    [2, 5, 5, 3],
  );

  h3(ctx, 'Priority Escalation & De-escalation');
  paragraph(ctx,
    'Priority can change during a call. A P3 welfare check that turns into a weapons threat upgrades to P1. A P1 robbery-in-progress where the suspect has clearly fled becomes P2 or P3 for the follow-up investigation. Use the PRI <call#> <level> command or the priority dropdown in the detail pane. Every priority change is audited with who changed it, when, and what it was before.',
  );
  paragraph(ctx,
    'Upgrade rules — err toward upgrading when in doubt:',
  );
  bullet(ctx, 'Caller reports weapons that were not initially mentioned -> upgrade to at least P2, P1 if weapons are currently displayed.');
  bullet(ctx, 'Caller reports active violence -> P1.');
  bullet(ctx, 'Caller reports they cannot safely stay on the phone -> P1 regardless of original nature.');
  bullet(ctx, 'Officer on scene requests upgrade -> immediately, no questions asked.');

  paragraph(ctx,
    'Downgrade rules — be cautious:',
  );
  bullet(ctx, 'Suspect has clearly fled and is no longer a threat -> P2 or P3 for investigation.');
  bullet(ctx, 'Call turns out to be a false alarm -> keep priority as-is until officers clear; then disposition as unfounded.');
  bullet(ctx, 'Caller changes story -> do NOT downgrade unilaterally. Update notes, keep priority, let officers investigate.');

  h2(ctx, 'Safety Flags — In Detail');
  paragraph(ctx,
    'Every call can carry one or more safety flags. Flags trigger Dispatcher Brain voice warnings to responding units (Section 7), add priority score, and become part of the permanent record. Flags are set at intake but can be added or corrected as new information comes in.',
  );

  h3(ctx, 'Weapons Involved');
  paragraph(ctx,
    'Triggers: caller mentions any firearm, knife, or other weapon on scene or involved in the incident. Also set when a subject has a documented weapons history at the address from prior calls.',
  );
  paragraph(ctx,
    'Required actions: notify the responding unit immediately (verbally and via flag). For firearms specifically, consider adding a second unit and positioning for tactical approach. If the caller reports the weapon is currently displayed or used, upgrade to P1.',
  );

  h3(ctx, 'Domestic Violence');
  paragraph(ctx,
    'Triggers: any call involving intimate partners, family members in the same household, or current/former dating partners with any physical, verbal, or emotional conflict. Also set for welfare checks on known DV victims.',
  );
  paragraph(ctx,
    'Required actions: two-unit response strongly recommended. Check prior call history at address for DV patterns. Brain will speak "approach with caution — domestic, weapons history on location" if history exists. Document injuries, visible weapons, presence of children, any statements that bear on protective-order violation. Utah mandatory-arrest law applies; the officer on scene decides but the dispatcher should have full history ready.',
  );

  h3(ctx, 'Felony in Progress');
  paragraph(ctx,
    'Triggers: armed robbery, burglary-in-progress, carjacking, kidnapping, sexual assault in progress, any other Class A or B felony currently occurring.',
  );
  paragraph(ctx,
    'Required actions: minimum two units, P1 priority. Consider perimeter units if suspect may flee. BOLO broadcast to neighboring agencies (SLCPD, UHP, Sandy PD, etc.) for any outbound directional info. Brain prompts "felony in progress, recommend second unit" automatically if only one unit is assigned.',
  );

  h3(ctx, 'Mental Health Crisis');
  paragraph(ctx,
    'Triggers: caller or subject exhibits confusion, disorientation, suicidal ideation, hallucinations, recent psychiatric history, or is off their medication with visible distress. Also set for welfare checks on subjects with known mental-health flags in Records.',
  );
  paragraph(ctx,
    'Required actions: request CIT (Crisis Intervention Team) trained officer when available. Request non-lethal staging — less-lethal tools (Taser, beanbag) ready but not deployed unless needed. EMS coordination for potential medical component. Brain says "mental health crisis — CIT response preferred, non-lethal staging" to remind responders.',
  );

  h3(ctx, 'Officer Safety Caution');
  paragraph(ctx,
    'Triggers: prior encounters at this address or with this subject resulted in resistance, assault on officer, weapons, or other documented safety issues. The system surfaces this flag automatically from historical call data at the address.',
  );
  paragraph(ctx,
    'Required actions: brief responding officer verbally on the specific caution — "officer-safety flag from 2025 call, subject threatened officer with knife". Details matter; a vague "be careful" is less useful than the specific prior incident number.',
  );

  h3(ctx, 'Vehicle Pursuit');
  paragraph(ctx,
    'Triggers: officer is actively pursuing a fleeing vehicle.',
  );
  paragraph(ctx,
    'Required actions: activate the pursuit banner on all workstations. Designate a supervisor to monitor. Log every direction, speed, and major intersection update in the notes in real time. Notify neighboring agencies. Prepare for termination criteria — supervisor decides, but you should have the information ready: speed, public risk, crime severity, weather, visibility. Document the termination reason immediately when pursuit ends, whether by apprehension, suspect flight, or supervisor termination.',
  );

  h3(ctx, 'Foot Pursuit');
  paragraph(ctx,
    'Triggers: officer is actively pursuing a fleeing subject on foot.',
  );
  paragraph(ctx,
    'Required actions: maintain continuous radio contact — foot pursuits are higher-risk than vehicle pursuits because officers are isolated from their radios. Track direction changes and cross streets. Dispatch a cover unit to the last known direction of travel. If pursuit enters a building or obstructed area, escalate immediately — this is when officers get hurt.',
  );

  h3(ctx, 'Hazmat');
  paragraph(ctx,
    'Triggers: chemical, biological, radiological, or explosive materials reported or suspected.',
  );
  paragraph(ctx,
    'Required actions: do not let officers approach until hazmat-trained responders clear. Establish upwind staging area. Contact local hazmat team (SLC Fire HazMat for most cases). Evacuate bystanders to safe distance. Call-taker should ask about smell, color, container markings — all are critical for hazmat identification.',
  );

  h3(ctx, 'Juvenile Involved');
  paragraph(ctx,
    'Triggers: any person under 18 is involved as victim, subject, witness, or reporting party.',
  );
  paragraph(ctx,
    'Required actions: follow juvenile-handling protocols. If a crime against a minor, incident report is mandatory. Do not release juvenile personal information over unsecured channels. Coordinate with School Resource Officer if incident is school-related. Note any parental or guardian notifications.',
  );

  h3(ctx, 'EMS / Medical');
  paragraph(ctx,
    'Triggers: any injury, unconsciousness, severe intoxication, mental-health with overdose risk, pregnancy complications, or caller specifically requests medical.',
  );
  paragraph(ctx,
    'Required actions: coordinate with EMS dispatch (separate radio). Give EMS the address, nature of medical, and any safety concerns (weapons on scene, combative subject). Request PD secure the scene before EMS enters when applicable.',
  );

  h2(ctx, 'Setting Flags After a Call Is Open');
  paragraph(ctx,
    'New information during a call frequently requires adding a flag. From the detail pane, use the flag chips to toggle on or off. Every change is audited. You can also use the command line:',
  );
  bullet(ctx, 'NT <call#> FLAG WEAPONS — adds a weapons flag AND creates a note documenting the source.');
  bullet(ctx, 'NT <call#> FLAG DV — adds a DV flag.');
  bullet(ctx, 'Multiple flags in one command: NT <call#> FLAG WEAPONS FLAG DV.');

  calloutBox(ctx, 'Policy — Flags Never Come Off',
    'Flags set on a call follow the call into the incident report and into the permanent history at the address. Never remove a safety flag to "clean up" a record — even if the original reason turned out to be unfounded, add a correcting note instead. Removed flags are auditable, and removing them without justification is a policy violation.',
    'warn',
  );
}

function section5(ctx: GuideContext): void {
  title(ctx, '5. F-Key Hotkeys');

  paragraph(ctx,
    'F-keys are the fastest way to drive the console. They work from anywhere in the dispatch screen unless a text field has focus — if a hotkey is not responding, press Escape to release focus from whatever input you are currently in, then try again.',
  );

  paragraph(ctx,
    'Memorizing the F-key row is the single highest-value training investment you can make. A dispatcher who knows F2-F7 by muscle memory will triage calls noticeably faster than one who hunts through menus. Print the quick-reference card at the end of this guide and tape it to the side of your monitor until the keys become automatic.',
  );

  h2(ctx, 'Primary F-Keys');
  table(ctx,
    ['Key', 'Action', 'When to Use'],
    [
      ['F1',  'Shortcut overlay',      'Any time you forget a key. Highlights active shortcuts for the focused panel.'],
      ['F2',  'New Call',              'Phone rings and you need to open an intake form in under a second.'],
      ['F3',  'Dispatch Unit',         'Call is open and selected; assign the nearest available unit.'],
      ['F5',  'Set En Route',          'Unit acknowledged by radio and you need to set status without them logging in.'],
      ['F6',  'Set On Scene',          'Unit arrives and confirms by radio; starts the 8-minute welfare timer.'],
      ['F7',  'Clear Call',            'Call is resolved; prompts for disposition code.'],
      ['F8',  'Focus Command Line',    'Need to run a CAD verb (NC, CI, AS, etc.) — see Section 6.'],
      ['F9',  'Advanced Search',       'Records search across persons, vehicles, addresses, incidents.'],
      ['F10', 'BOLO Alert',            'Issue a broadcast alert for a suspect or vehicle.'],
      ['F11', 'Full Screen',           'Toggles browser full-screen — hides tabs and address bar for maximum real estate.'],
      ['F12', 'NCIC Query',            'Opens NCIC / records query panel for plates, persons, warrants.'],
    ],
    [2, 4, 7],
  );

  h2(ctx, 'Letter Hotkeys');
  paragraph(ctx,
    'Single-letter hotkeys are context-dependent: they activate only when no text input has focus. Press Escape first if a letter key seems to do nothing.',
  );
  table(ctx,
    ['Key', 'Action', 'Context'],
    [
      ['V',   'Open Voice Channel',     'Manual listen mode when brain is enabled — starts mic for command.'],
      ['T',   'Toggle Transcript Pane', 'Shows the drawer listing every spoken announcement with severity LEDs.'],
      ['N',   'New (context-sensitive)','On Dispatch page: new call. On Records: new record. On Incidents: new incident.'],
      ['?',   'Keyboard Shortcuts',     'Full shortcut help overlay. Same as F1 but works from modifier-free context.'],
      ['/',   'Focus Global Search',    'Jumps cursor to the top search bar. Esc returns focus to call list.'],
      ['Esc', 'Release Focus / Cancel', 'Unfocuses the current input. Cancels open dialogs. Returns to call list.'],
    ],
    [2, 4, 7],
  );

  h2(ctx, 'Navigation Hotkeys');
  paragraph(ctx,
    'Alt+number jumps between major modules without touching the mouse. These use the numeric row, not the numpad.',
  );
  table(ctx,
    ['Key', 'Destination'],
    [
      ['Alt+1', 'Dashboard'],
      ['Alt+2', 'Dispatch Console'],
      ['Alt+3', 'Map'],
      ['Alt+4', 'Records / Master Name Index'],
      ['Alt+5', 'Incidents'],
      ['Alt+6', 'Citations'],
      ['Alt+7', 'Reports'],
      ['Alt+8', 'Communications / BOLO'],
      ['Alt+9', 'Admin (admin role only)'],
    ],
    [2, 5],
  );

  h2(ctx, 'Focus Management');
  paragraph(ctx,
    'Three rules that save a lot of "why does my hotkey not work?" frustration:',
  );
  bullet(ctx, 'F-keys always work regardless of focus — they are global. If F-key is not responding, the browser may be intercepting it (F11 especially — press Esc to exit browser full-screen first).');
  bullet(ctx, 'Letter keys only work when no text input has focus. A call with the caller-name field open will swallow "N" as a letter instead of triggering "New".');
  bullet(ctx, 'Escape is the universal "release focus" key. Pressing Escape from any input returns focus to the parent panel, at which point letter hotkeys work again.');

  h2(ctx, 'Browser Shortcuts to Avoid');
  paragraph(ctx,
    'A few browser shortcuts conflict with dispatch actions or have side effects you do not want during a shift:',
  );
  bullet(ctx, 'Ctrl+W / Cmd+W — closes the browser tab. Easy to hit accidentally. Re-open with Ctrl+Shift+T but any unsaved work is lost.');
  bullet(ctx, 'Ctrl+Tab — switches browser tabs. Use Alt-number within RMPG Flex instead; stay on one tab.');
  bullet(ctx, 'Ctrl+R / Cmd+R — reloads the page. Safe and sometimes necessary, but reopens connections and loses map pan/zoom state.');
  bullet(ctx, 'Ctrl+Shift+R — hard reload. Use this when the page seems stuck or the cache is serving stale assets.');

  calloutBox(ctx, 'Tip',
    'If you are curious which shortcut is doing something, press F1 to open the overlay. It shows every active shortcut for whatever panel currently has focus, including those bound by the current page component. The overlay updates as you move focus between panels.',
  );
}

function section6(ctx: GuideContext): void {
  title(ctx, '6. CAD Command Line');

  paragraph(ctx,
    'The CAD command line is the dispatcher\'s power tool. Press F8 to focus it, type a verb followed by arguments, press Enter. The command line understands both the terse two-letter verbs below and full 10-codes. Most actions you can do through the GUI have a command-line equivalent that is two to five times faster once you know the syntax.',
  );

  paragraph(ctx,
    'Commands are case-insensitive — "nc domestic 123 main" works identically to "NC DOMESTIC 123 MAIN". Arguments are space-separated; quote values that contain spaces ("NC \\"open container\\" 123 main"). Press Tab to cycle autocomplete suggestions, Up/Down arrows to recall recent commands.',
  );

  h2(ctx, 'Call Management Commands');
  table(ctx,
    ['Verb', 'Syntax', 'Purpose'],
    [
      ['NC',  'NC <type> [location]',                 'New call for service'],
      ['CI',  'CI <call#>',                           'Select / show call info'],
      ['AS',  'AS <unit> <call#>',                    'Assign unit to call'],
      ['UN',  'UN <unit> <call#>',                    'Unassign unit from call'],
      ['ST',  'ST <unit> <status>',                   'Change unit status'],
      ['US',  'US <unit> <status>',                   'Update unit status (alias)'],
      ['CL',  'CL <call#> [disposition]',             'Clear call with disposition'],
      ['HD',  'HD <call#> [minutes]',                 'Hold call for N minutes'],
      ['HOLD','HOLD <call#> [minutes]',               'Alias for HD'],
      ['NT',  'NT <call#> <note>',                    'Append note to call'],
      ['PRI', 'PRI <call#> <P1..P4>',                 'Change priority'],
      ['TR',  'TR <call#> <to-dispatcher>',           'Transfer call ownership'],
    ],
    [2, 5, 6],
  );

  h3(ctx, 'Worked examples — Call Management');
  bullet(ctx, 'NC domestic 123 Main St — opens new-call form pre-filled with type "domestic" at 123 Main Street.');
  bullet(ctx, 'CI 2026-CFS-00142 — selects that call in the list and populates the detail pane.');
  bullet(ctx, 'CI 142 — shorthand: system expands to the most recent matching call.');
  bullet(ctx, 'AS 3A 142 — assigns unit 3-Adam to call 142. Works on the selected call if you omit the number.');
  bullet(ctx, 'ST 3A 10-97 — sets unit 3-Adam to "On Scene" via the 10-code.');
  bullet(ctx, 'NT 142 caller states suspect has left, heading north on State St — appends note.');
  bullet(ctx, 'CL 142 Report Taken — clears call 142 with disposition.');
  bullet(ctx, 'HD 142 30 — holds call 142 for 30 minutes (useful for scheduled follow-ups).');

  h2(ctx, 'Broadcast / Alert Commands');
  table(ctx,
    ['Verb', 'Syntax', 'Purpose'],
    [
      ['BO',  'BO <description>',                     'Broadcast BOLO (be on the lookout)'],
      ['QB',  'QB <beat>',                            'Query calls in a beat'],
      ['AA',  'AA <message>',                         'All-units announcement (non-emergency)'],
      ['EM',  'EM <message>',                         'Emergency all-units broadcast (P1-level tone)'],
    ],
    [2, 5, 6],
  );

  h2(ctx, 'Query / Lookup Commands');
  paragraph(ctx,
    'Lookups are non-destructive — they fetch and display information without changing any records. Use them liberally during a traffic stop or when an officer radios in for information.',
  );
  table(ctx,
    ['Verb', 'Syntax', 'Purpose'],
    [
      ['QP',  'QP <name>',                            'Query person records (criminal + field history)'],
      ['QH',  'QH <name>',                            'Query person history (alias of QP)'],
      ['QV',  'QV <VIN or tag>',                      'Query vehicle by VIN or license plate'],
      ['QW',  'QW <name>',                            'Query active warrants'],
      ['QT',  'QT <tag> [state]',                     'Traffic-stop query — plate + state for ownership + warrants'],
      ['PR',  'PR <address>',                         'Premise alerts for address (prior call history, flags)'],
      ['PI',  'PI <property-id>',                     'Property info by ID or address'],
      ['DU',  'DU <unit>',                            'Duty / shift info for unit (officer assigned, times)'],
      ['FI',  'FI <person_name>',                     'Start Field Interview card for the named person'],
      ['LE',  'LE <code>',                            '10-code lookup (returns meaning + category)'],
    ],
    [2, 5, 6],
  );

  h3(ctx, 'Worked examples — Queries');
  bullet(ctx, 'QT 8IDA745 UT — queries Utah plate 8-Ida-745 for registration, owner, warrants, prior stops.');
  bullet(ctx, 'QP Doe, John 1985-03-15 — queries person by name + DOB (reduces false matches).');
  bullet(ctx, 'QW Smith — queries active warrants for subjects named Smith. Results include warrant number, bail, court.');
  bullet(ctx, 'PR 123 Main St — returns premise alerts (prior DV flag, officer safety caution) for the address.');
  bullet(ctx, 'LE 29 — returns "10-29: want/warrant check".');
  bullet(ctx, 'FI Jones, Mary — opens a Field Interview card pre-filled with subject name.');

  h2(ctx, 'Status & Informational');
  table(ctx,
    ['Verb', 'Purpose'],
    [
      ['STATUS',   'Current dispatcher workstation status (active calls, assigned units)'],
      ['CHECK',    'Call count + unit metrics overview (pending, active by priority, units by status)'],
      ['ETA',      'Estimated time of arrival for assigned unit on selected call'],
      ['WEATHER',  'Current weather for the operational zone (via local feed)'],
      ['TIME',     'System time (Mountain Time) with UTC offset'],
      ['ACK',      'Acknowledge (equivalent to 10-4)'],
      ['HANDOFF',  'Open shift-handoff notes for read/write'],
    ],
    [2, 6],
  );

  h2(ctx, 'Administrative Commands');
  paragraph(ctx,
    'These require admin or supervisor role and are used for corrections, system checks, and operational oversight.',
  );
  table(ctx,
    ['Verb', 'Syntax', 'Purpose'],
    [
      ['ML',   'ML <unit> <start|end> <mi>',          'Log mileage at start or end of shift'],
      ['OR',   'OR <call#> <field> <value>',          'Override a call field (audited, supervisor only)'],
      ['UNDO', 'UNDO <call#>',                        'Reverse the last change to a call (supervisor only)'],
      ['AUDIT','AUDIT <call#>',                       'Show full audit log for a call'],
    ],
    [2, 5, 6],
  );

  h2(ctx, 'Command Chaining & Autocomplete');
  paragraph(ctx,
    'A few patterns that save keystrokes on common sequences:',
  );
  bullet(ctx, 'Up arrow recalls recent commands. Keep pressing Up to go further back; Ctrl+R starts a reverse search if your recent history is long.');
  bullet(ctx, 'Tab completes verbs and common arguments. "N<Tab>" cycles through NC, NT. "ST 3A 10<Tab>" cycles through 10-4, 10-6, 10-7, etc.');
  bullet(ctx, 'Selecting a call first makes subsequent commands shorter: click a call, then "ST 3A 10-97" works on the selected call without needing the number.');
  bullet(ctx, 'Use the Up-arrow recall to repeat the last command with edits — great for updating multiple units to the same status in quick succession.');

  h2(ctx, 'Common Typos to Avoid');
  bullet(ctx, 'CL vs CI — CL clears a call (destructive), CI selects it (harmless). When in doubt, select first to verify you have the right call.');
  bullet(ctx, 'PRI requires a P1-P4 value, not a number. "PRI 142 1" fails; "PRI 142 P1" works.');
  bullet(ctx, 'Unit call signs: use the canonical form. "3A" and "3-Adam" both work; "3Adam" without separator does NOT match.');
  bullet(ctx, 'Plates: omit dashes and spaces ("8IDA745" not "8-IDA-745"). State is optional but recommended.');

  calloutBox(ctx, 'Error Messages',
    'The command line returns red text for errors, green for success. Errors always tell you the problem: "Unit 9Z not found", "Call 999 not found", "Usage: NC <type> [location]". Read the error carefully — the system is quite specific about what went wrong.',
  );
}

function section7(ctx: GuideContext): void {
  title(ctx, '7. Voice Features (Dispatcher Brain)');

  paragraph(ctx,
    'RMPG Flex includes a Dispatcher Brain — an optional layer that speaks alerts, coaching, and event notifications through a neural voice. The brain was built in four phases and the features described below are all live in production. Every feature is opt-in per user, default off, configurable in User Profile -> Voice.',
  );

  paragraph(ctx,
    'The design philosophy: the brain should be an attentive second dispatcher who never gets tired. It speaks up when safety flags are relevant, reminds you of overdue checks, and announces events you might have missed — but it never barks, never repeats itself, and always defers to human judgment.',
  );

  h2(ctx, 'Voice Persona');
  paragraph(ctx,
    'Voice persona controls every spoken line in the system, not just the brain. The Phase 1 voice work applies to standard dispatch announcements too — your new-call chimes and priority alerts will use whatever voice you pick here.',
  );

  h3(ctx, 'The four curated voices');
  bullet(ctx, 'Female Calm (Jenny) — default. Measured, slightly warm. Easiest to listen to across an 8-hour shift.');
  bullet(ctx, 'Female Crisp (Aria) — sharper articulation, slightly faster natural pace. Preferred by dispatchers who find Jenny too soft to hear over radio traffic.');
  bullet(ctx, 'Male Baritone (Guy) — lower frequency, authoritative. Some dispatchers report it cuts through headphone noise better.');
  bullet(ctx, 'Male Tactical (Davis) — crisp male voice with a harder edge. Good for tactical environments; can feel abrupt in quiet periods.');

  paragraph(ctx,
    'There is no "right" voice. Try each with the Preview button and keep whichever you find least fatiguing after thirty minutes of listening. You can change anytime; the choice follows your user across workstations because it is stored on the server.',
  );

  h3(ctx, 'Rate & pitch');
  bullet(ctx, 'Rate: 0.7x to 1.4x in 0.05 steps. Default 1.0 (neutral). Urgent alerts automatically get a +10% bump on top of your baseline.');
  bullet(ctx, 'Pitch: -20 to +20 Hz in 1-unit steps. Default 0. Urgent alerts add +5 Hz. Pitch offsets are subtle — try -10 to get a slightly deeper male voice, +5 for a slightly brighter female voice.');
  bullet(ctx, 'Both are real-time previewable. Adjust, press Preview, adjust again. Once you commit, the PUT request saves to your user record within a second.');

  h3(ctx, 'Terseness modes');
  paragraph(ctx,
    'Terseness controls how much the system says about a new call. Different dispatchers prefer different verbosity.',
  );
  paragraph(ctx,
    'Example spoken output for a new P1 domestic at 123 Main Street, Delta-2 beat 14, unit 3-Adam assigned:',
  );
  bullet(ctx, 'Narrative (full prose): "New call, priority one, domestic disturbance at 123 Main Street, apartment 4B, zone Delta-2 beat 14. Suspect is a white male, 30s, black hoodie. Unit 3-Adam assigned."');
  bullet(ctx, 'Standard (CAD shorthand): "P1 domestic, 123 Main, Delta-2-14, 3-Adam." — default, preserves existing cadence.');
  bullet(ctx, 'Terse (minimum): "P1 domestic, 123 Main, 3-Adam." — fastest, skips zone and detailed description.');

  paragraph(ctx,
    'Dispatchers working busy shifts often prefer Terse; trainees and those working quieter beats often prefer Narrative so they absorb context. Supervisors may standardize the mode for their shift — if your agency has a policy, follow it.',
  );

  h2(ctx, 'Transcript Drawer');
  paragraph(ctx,
    'The transcript drawer is a persistent record of every spoken announcement. Press T anywhere in the app to toggle it.',
  );
  bullet(ctx, 'Severity color LEDs: red = major (officer down, panic), amber = moderate (coaching, approach warning), green = minor (event notice, status).');
  bullet(ctx, 'Timestamps are shown in Mountain Time, HH:MM:SS.');
  bullet(ctx, 'The drawer holds the 100 most recent entries — older ones roll off as new arrive.');
  bullet(ctx, 'Hidden ARIA live regions mirror every announcement to screen readers using aria-live="polite" for normal severity and aria-live="assertive" for major.');
  bullet(ctx, 'Use it for shift review — "what exactly did the brain say at 14:23?" — or for audit purposes when an officer asks what you were told.');

  h2(ctx, 'Dispatcher Brain (Master Toggle)');
  paragraph(ctx,
    'Once you toggle "Dispatcher Brain (Beta)" on in the Voice tab and reload the page, the brain activates and begins speaking proactively across six rule categories.',
  );

  h3(ctx, 'Event rules (minor severity)');
  paragraph(ctx,
    'These fire when a corresponding database mutation is broadcast on the WebSocket. You hear them for every event across every workstation unless cooldown suppresses a repeat.',
  );
  bullet(ctx, 'Citation issued — "Citation RN-26-0142 issued by 4-Bravo, $85 fine."');
  bullet(ctx, 'Incident opened — "Incident RN-26-0301 opened from call CN-26-0457."');
  bullet(ctx, 'Warrant entered (moderate severity) — "New warrant on Smith John, felony, $50,000 bail."');
  bullet(ctx, 'Evidence logged — "Evidence tag E-26-0089 logged for case 26-0301."');
  bullet(ctx, 'Arrest booked (moderate severity) — "Arrest booked: Doe John, felony theft, by 4-Bravo."');
  bullet(ctx, 'Leave approved — "Leave request approved for Smith."');

  h3(ctx, 'Coaching rules (moderate severity)');
  paragraph(ctx,
    'These fire when call flags and context suggest an officer needs a reminder. Each has a 5-10 minute cooldown keyed to the call number, so a call updating repeatedly does not spam the same warning.',
  );
  bullet(ctx, 'DV approach warning — "Approach with caution — domestic, weapons history on location." Fires on any call with the DV flag.');
  bullet(ctx, 'Felony backup suggest — "Felony in progress, recommend second unit." Fires when felony_in_progress is flagged AND fewer than 2 units are assigned.');
  bullet(ctx, 'Mental-health protocol — "Mental health crisis — CIT response preferred, non-lethal staging." Fires on any call with the MH flag.');

  h3(ctx, 'Timer-triggered rules (moderate severity)');
  paragraph(ctx,
    'A 30-second background timer checks for time-dependent conditions:',
  );
  bullet(ctx, 'Overdue status check — "3-Adam, status check, 8 minutes on scene." Fires once per call, 5-minute cooldown, when your unit has been on-scene for 8+ minutes without a status update. Useful welfare-check prompt but never a replacement for human attention.');

  h3(ctx, 'Geofence rules (minor severity)');
  bullet(ctx, 'Geofence breach — "3-Adam is outside assigned beat Delta-2." Fires when a unit\'s GPS position is identified as outside the beat assigned to that unit. Requires the unit to have an assigned_beat configured by admin. 3-minute cooldown per unit.');

  h2(ctx, 'Cooldowns & Rate Limiting');
  paragraph(ctx,
    'The brain has three layers of noise control so it never becomes a distraction:',
  );
  bullet(ctx, 'Per-rule entity cooldown: the same rule for the same call/unit/citation does not repeat within its cooldown window. A DV warning speaks once per call, not every time the call updates.');
  bullet(ctx, 'Global non-major rate limit: at most one non-major utterance every 6 seconds. Coaching and event rules queue up and drain one at a time with the gap; major alerts preempt.');
  bullet(ctx, 'Severity preemption: a major-severity item jumps to the front of the queue and clears any pending lower-severity items. Officer-down always beats "citation issued".');

  h2(ctx, 'Conversational Queries');
  paragraph(ctx,
    'With the brain enabled and voice channel active (press V to open the microphone manually, or enable auto-listen in Voice settings), you can speak queries and the brain responds. The referent resolver rewrites pronouns and deictics using conversational context.',
  );

  h3(ctx, 'Working query patterns');
  bullet(ctx, '"Tell me more about that call" — speaks a narrative summary of the last-mentioned call. "That" resolves to whichever call is currently in context.');
  bullet(ctx, '"Describe call CN-26-0457" — explicit form; speaks the narrative regardless of context.');
  bullet(ctx, '"Who is assigned to that call?" — speaks the assigned unit.');
  bullet(ctx, '"Who\'s on CN-26-0457?" — casual form of the same query.');
  bullet(ctx, '"What is the status of that call?" — speaks the call\'s current status and elapsed time.');

  h3(ctx, 'Ambiguity handling');
  paragraph(ctx,
    'If you use a pronoun or deictic with no prior context (e.g. "tell me about that call" as the first thing you say after a fresh session), the brain cannot resolve what "that" refers to. Instead of guessing, it asks:',
  );
  bullet(ctx, '"Which call did you mean?" — with the mic re-opened for four seconds so you can answer with a call number.');
  bullet(ctx, '"Which person did you mean?" — when "him" or "the subject" appears without a prior person reference.');
  bullet(ctx, '"Which unit did you mean?" — when "that unit" is unresolvable.');

  paragraph(ctx,
    'The resolver supports: "that call" / "this call" / "the call", "that location" / "the address", "him" / "her" / "the subject" / "that person", "that unit" / "the unit", "that plate" / "the plate". Patterns are case-insensitive but preserve the rest of your utterance\'s case.',
  );

  h2(ctx, 'When the Brain Speaks vs. When It Stays Quiet');
  paragraph(ctx,
    'Two rules of thumb that help predict brain behavior:',
  );
  bullet(ctx, 'The brain speaks the FIRST time a condition is true and stays quiet during the cooldown even if the condition remains true. DV approach fires on the first update of a DV call, not every update.');
  bullet(ctx, 'The brain speaks as soon as it can — it does not batch or summarize. If two events fire within a second, you hear both back-to-back with the 6-second gap between non-major items.');

  calloutBox(ctx, 'Rollback',
    'If brain output ever becomes distracting on a live shift, turn it off in your Voice settings — the change takes effect on next page load. Admin can force it off globally by clearing voice_brain_enabled for every user in the database. The flag exists specifically so a bad rule or a misbehaving deploy can be silenced without redeploying code.',
  );

  h2(ctx, 'Privacy & Audit');
  paragraph(ctx,
    'Every spoken line appears in the transcript drawer and, for mutating voice commands, an audit log entry. The referent resolver logs every rewrite so a supervisor reviewing a shift can see exactly what "that call" was resolved to before a command fired. There is no hidden state — if the brain did something, you can reconstruct why.',
  );

  paragraph(ctx,
    'Voice audio itself is not recorded or persisted by default. The hybrid STT pipeline uses the browser\'s Web Speech API (local, no audio leaves the machine) in parallel with a server-side Whisper endpoint for fallback transcription. Whisper audio is processed in memory and discarded; only the resulting text enters the audit log.',
  );
}

function section8(ctx: GuideContext): void {
  title(ctx, '8. Common Workflows');

  paragraph(ctx,
    'Every dispatcher develops patterns for routine calls. This section documents agency-preferred workflows for fifteen of the most common dispatch scenarios. Treat them as starting points — the facts of each call may require deviation, but these patterns cover the typical case.',
  );

  h2(ctx, 'Call Intake Workflows');

  h3(ctx, '911 transfer (emergency)');
  bullet(ctx, 'Open new call (F2) as soon as the transfer announcement begins — do not wait for full details.');
  bullet(ctx, 'Paste caller info from the 911 transfer. Verify the callback number by reading it back to the caller.');
  bullet(ctx, 'Set priority based on reported facts — P1 for any in-progress violence, active medical with unconsciousness, or imminent threat to life.');
  bullet(ctx, 'Flag weapons / DV / MH / hazmat as the caller mentions them. These upgrade the brain\'s response even if you forget to increase priority.');
  bullet(ctx, 'Save -> dispatch nearest available unit (F3). Second unit on P1.');
  bullet(ctx, 'Stay on the line with the caller. Append notes continuously — caller movement, suspect activity, new information — until officers are on-scene.');
  bullet(ctx, 'Relay information to responding officers every 30-60 seconds during active calls. Silence from dispatch implies "nothing new" which can miss updates.');

  h3(ctx, 'Non-emergency phone call');
  bullet(ctx, 'Most non-emergency calls come in on the business line, not 911. Priority defaults to P3 or P4 unless facts escalate.');
  bullet(ctx, 'Still open a call record (F2). Never take a complaint verbally without documenting.');
  bullet(ctx, 'Get caller name, phone, and enough detail that an officer can follow up even if the caller cannot stay on the line.');
  bullet(ctx, 'Ask whether they want an officer to call, visit, or whether the online report option is appropriate (for P4 cold reports like vandalism with no suspect, lost property, etc.).');

  h3(ctx, 'Online report intake');
  bullet(ctx, 'When an online report comes in, it appears as a pending call with source="online".');
  bullet(ctx, 'Review for completeness. Online reports often lack detail — call the reporting party if anything critical is missing.');
  bullet(ctx, 'If the report describes an in-progress or high-priority incident, upgrade priority and dispatch immediately — people sometimes file online when they should have called 911.');

  h2(ctx, 'Multi-Unit Response Workflows');

  h3(ctx, 'Multi-unit response');
  bullet(ctx, 'Dispatch primary unit first (F3).');
  bullet(ctx, 'Use AS <unit> <call#> to add each additional unit, or click Dispatch again on the detail pane.');
  bullet(ctx, 'Assign roles verbally if not obvious — "3-Adam primary, 3-Bravo contact, 3-Charlie cover".');
  bullet(ctx, 'Track every unit\'s on-scene time; if one is significantly late, radio check.');

  h3(ctx, 'Mutual aid from another agency');
  bullet(ctx, 'Mutual-aid responders (SLCPD, UHP, Sandy PD, etc.) are not in your unit roster. Create a note documenting their response ("SLCPD 3A5 on scene 14:23").');
  bullet(ctx, 'Communicate through their dispatch, not directly. Their dispatcher is your counterpart.');
  bullet(ctx, 'Document any mutual-aid assistance clearly for after-action review and any cost-sharing obligations.');

  h3(ctx, 'EMS coordination');
  bullet(ctx, 'EMS has their own CAD. You coordinate, not dispatch.');
  bullet(ctx, 'Give EMS dispatch the address, nature of medical, and any safety concerns (weapons, combative subject, unsecured scene).');
  bullet(ctx, 'For scene safety, PD should be on-scene before EMS enters for any call with weapons or violence. "Stage EMS at [cross street] until scene is secure" is a common phrase.');

  h3(ctx, 'Fire coordination');
  bullet(ctx, 'Fire has their own CAD too. Coordinate on structure fires, vehicle fires with possible fatality, hazmat, rescue operations.');
  bullet(ctx, 'Your responsibility during a joint response is traffic control and scene security around the fire operation.');

  h2(ctx, 'Tactical Workflows');

  h3(ctx, 'Vehicle pursuit');
  bullet(ctx, 'Officer initiates pursuit over radio. Acknowledge immediately.');
  bullet(ctx, 'Set the pursuit flag on the call — activates pursuit banner on every workstation.');
  bullet(ctx, 'Designate a supervisor to monitor in real time. Notify them by name.');
  bullet(ctx, 'Track continuously: direction of travel, speed, major intersections, description of fleeing vehicle, number of occupants, any violations observed.');
  bullet(ctx, 'Broadcast BOLO (BO command) with description to neighboring agencies as pursuit crosses jurisdictions.');
  bullet(ctx, 'Prepare termination criteria: speed, weather, public risk, crime severity. Supervisor decides to terminate; document the exact moment and reason.');
  bullet(ctx, 'Termination outcomes: apprehension, suspect escape, agency termination, traffic termination (unit loses line-of-sight safely). Document which and why.');

  h3(ctx, 'Foot pursuit');
  bullet(ctx, 'Highest-risk pursuit type — officer isolated from vehicle and radio.');
  bullet(ctx, 'Dispatch cover unit IMMEDIATELY to last known direction of travel.');
  bullet(ctx, 'Maintain continuous radio contact. Ask "status?" every 30 seconds until officer either catches up with suspect, loses sight, or requests cover.');
  bullet(ctx, 'If pursuit enters a building, confined space, or obstructed area, escalate to supervisor and request additional units.');
  bullet(ctx, 'Document exit point (direction suspect fled from officer) for search grid planning.');

  h3(ctx, 'Officer requests cover / backup');
  bullet(ctx, 'Treat any cover request as P1 until proven otherwise. Dispatch nearest available unit with lights and siren.');
  bullet(ctx, 'Ask the requesting officer whether they need silent approach (no lights/siren) or full emergency response — tactical situations may require silent.');
  bullet(ctx, 'If officer voice sounds stressed, elevated, or signals distress, assume worst case: dispatch multiple units and notify supervisor.');

  h3(ctx, 'Officer down / 10-99 / Signal 3');
  bullet(ctx, 'Absolute highest priority. Every available unit responds immediately.');
  bullet(ctx, 'Broadcast all-units emergency (EM command or voice "officer down" / "ten-ninety-nine").');
  bullet(ctx, 'Request EMS simultaneously — do not wait for scene security.');
  bullet(ctx, 'Notify SLCPD and UHP if within their response radius.');
  bullet(ctx, 'Pull up the officer\'s last known GPS position on the map and keep the map pane visible.');
  bullet(ctx, 'Do NOT clear the call until the officer confirms 10-4 on their own radio, in their own voice.');
  bullet(ctx, 'Notify command staff and the on-call supervisor immediately.');

  h3(ctx, 'Active shooter');
  bullet(ctx, 'P1, every unit responds.');
  bullet(ctx, 'Establish incident command radio channel — supervisor becomes IC.');
  bullet(ctx, 'Broadcast description, last known location, direction of movement on primary channel.');
  bullet(ctx, 'Activate school / business emergency notification if applicable.');
  bullet(ctx, 'Coordinate with SLCPD SWAT and tactical mutual-aid units.');
  bullet(ctx, 'Evacuate surrounding area — establish perimeter.');
  bullet(ctx, 'Document everything in real time; this call will be reviewed extensively.');

  h2(ctx, 'Routine Workflows');

  h3(ctx, 'Traffic stop');
  bullet(ctx, 'Officer calls in stop: plate, location, reason. Acknowledge with 10-4.');
  bullet(ctx, 'Run QT <plate> [state] automatically — return registration, owner, warrants to officer.');
  bullet(ctx, 'If plate returns warrants or prior officer-safety caution, notify officer BEFORE they approach the vehicle.');
  bullet(ctx, 'Start the traffic-stop timer — officers should update status every 5-10 minutes during a stop.');
  bullet(ctx, 'If officer does not update in 10 minutes, radio check.');

  h3(ctx, 'Welfare check');
  bullet(ctx, 'Intake: who is being checked, why the concern, where, any medical / mental-health history.');
  bullet(ctx, 'Run PR <address> — premise alerts may reveal prior MH flags, weapons history, DV.');
  bullet(ctx, 'Dispatch available unit. If history suggests risk, dispatch two.');
  bullet(ctx, 'Document outcome: subject contacted and well, subject contacted with concerns (EMS or MH referral), no contact (leave a note), crime discovered, subject deceased.');

  h3(ctx, 'BOLO broadcast');
  bullet(ctx, 'Use BO command or File -> New -> BOLO Alert.');
  bullet(ctx, 'Include: subject/vehicle description, direction of travel, last seen time + location, reason for BOLO, officer-safety notes (armed, violent, known to resist).');
  bullet(ctx, 'BOLO broadcasts to every workstation AND to neighboring agencies via inter-agency message.');
  bullet(ctx, 'Cancel the BOLO when the subject is apprehended or the incident resolves — stale BOLOs create confusion.');

  h3(ctx, 'Warrant service');
  bullet(ctx, 'Unit requests to serve a warrant — check the warrant record for bail, charges, officer-safety notes, court requirements.');
  bullet(ctx, 'For felony warrants or warrants with weapons history, recommend two-unit response.');
  bullet(ctx, 'If subject is arrested, link the arrest to the warrant record (WRN command from the arrest form).');
  bullet(ctx, 'If subject is not there or not the person named, document attempt and outcome; warrant remains active.');

  h3(ctx, 'Welfare check on overdue unit');
  bullet(ctx, 'Brain speaks overdue-status warning at 8 minutes. Do not wait — respond to your own awareness first.');
  bullet(ctx, 'Radio the unit on their channel: "3-Adam, status check."');
  bullet(ctx, 'No response within 2 minutes -> dispatch cover unit to last known location AND escalate to supervisor.');
  bullet(ctx, 'Log every check attempt as a note on the call, with timestamps.');
  bullet(ctx, 'If unit responds and is fine, confirm status with them explicitly ("10-4, continuing investigation, will update in 10").');

  h3(ctx, 'Shift handoff');
  bullet(ctx, 'Start 10 minutes before end of shift. Do not rush.');
  bullet(ctx, 'Walk through each active call with the incoming dispatcher — pending, in progress, unit assignments, any notable flags.');
  bullet(ctx, 'Use the Shift Handoff Notes field (F8 -> HANDOFF command) for asynchronous handoffs or notes that do not belong on a specific call.');
  bullet(ctx, 'Verify every on-scene unit has an entry timestamp so incoming dispatcher knows the clock and can anticipate overdue checks.');
  bullet(ctx, 'Do not log off until the incoming dispatcher has acknowledged and taken over. Both of you should confirm verbally.');
}

function section9(ctx: GuideContext): void {
  title(ctx, '9. Troubleshooting');

  paragraph(ctx,
    'When the console misbehaves, the fix is almost always one of four things: refresh the page, clear the browser cache, switch to another workstation, or page the on-call admin. This section walks through specific symptoms, their likely causes, and the fastest fix.',
  );

  h2(ctx, 'Connectivity & Sync');

  h3(ctx, 'WebSocket disconnected (status bar shows red)');
  paragraph(ctx,
    'Auto-reconnect runs every 3 seconds, backing off to a maximum of 30 seconds between retries. Up to 50 retries are attempted (roughly 25 minutes). If it does not recover on its own:',
  );
  bullet(ctx, 'Help -> System Status -> Reconnect.');
  bullet(ctx, 'Ctrl+R / Cmd+R to reload the page.');
  bullet(ctx, 'If the page itself will not load, move to the next workstation immediately and notify the on-call admin.');
  bullet(ctx, 'Your work is not lost — the server is the source of truth and has everything you committed. Queued offline writes replay on reconnect.');

  h3(ctx, 'Updates not appearing on my screen but other dispatchers see them');
  paragraph(ctx,
    'Your WebSocket is half-disconnected — still connected enough to not trigger the reconnect banner but not receiving broadcasts. This rarely happens but is distinctive. Force-reload (Ctrl+Shift+R) to rebuild the socket.',
  );

  h3(ctx, 'I can see calls but cannot save changes');
  paragraph(ctx,
    'Your session token may have expired or your role changed. Check top-right for your user badge — if it shows "logged out" reload and log back in. If still failing, logout via Help menu and log back in to force a fresh token.',
  );

  h2(ctx, 'GPS & Mapping');

  h3(ctx, 'Unit GPS not updating');
  bullet(ctx, 'Check unit\'s device has GPS permission granted in the browser/app.');
  bullet(ctx, 'Desktop workstations use WiFi geolocation which is less accurate than phone GPS and updates less often. Units on a mobile MDT or phone app will have fresher positions.');
  bullet(ctx, 'The server prefers higher-priority sources — a desktop sample will not overwrite a recent mobile sample. If desktop shows stale but mobile is fresh, the server may be ignoring the desktop update on purpose.');
  bullet(ctx, 'If a unit genuinely has no GPS, use ST <unit> command and location notes in the call instead of relying on the map.');

  h3(ctx, 'Map shows no units');
  paragraph(ctx,
    'All units have stale GPS (>10 minutes old) and have been filtered out by the freshness layer. Toggle "Show stale units" in the map controls, or investigate why the fleet is not reporting — dispatch check-in over radio.',
  );

  h3(ctx, 'Map tiles not loading');
  paragraph(ctx,
    'Tile layers are served from Mapbox GL JS with server-side access tokens. If tiles are blank, verify the access token is configured in Admin → Integrations. The map should work online with any valid Mapbox token.',
  );

  h2(ctx, 'Voice');

  h3(ctx, 'Voice not working at all');
  bullet(ctx, 'Confirm master sound toggle (speaker icon in the status bar — click to toggle).');
  bullet(ctx, 'Confirm voice-alerts toggle in User Profile -> Voice.');
  bullet(ctx, 'Test with the Preview button in the Voice tab — if that is silent, check system audio output and browser audio permission.');
  bullet(ctx, 'If Edge TTS is unreachable (server issue), the system falls back to browser SpeechSynthesis automatically. The voice will sound different but will still announce.');
  bullet(ctx, 'If neither works, your browser may be blocking audio autoplay. Click anywhere on the page to grant interaction-based audio permission, then retry.');

  h3(ctx, 'Voice speaks wrong name or pronunciation');
  paragraph(ctx,
    'Edge TTS sometimes mispronounces unusual names or street names. Override by adding a custom pronunciation in Admin -> TTS -> Custom Words (admin only). For one-off lines, spell phonetically in the note ("Nguyen (NG-WEN)").',
  );

  h3(ctx, 'Dispatcher Brain is too chatty / not chatty enough');
  bullet(ctx, 'Too chatty: turn off Dispatcher Brain in Voice settings. Your standard dispatch announcements keep working.');
  bullet(ctx, 'Not chatty enough: confirm Dispatcher Brain toggle is on AND terseness is not set to Terse (which suppresses some coaching).');
  bullet(ctx, 'Specific missing rule: check the transcript drawer (T key) to see whether the rule fired but was suppressed by cooldown.');

  h3(ctx, 'Voice command (speaking to dispatcher) not working');
  bullet(ctx, 'Confirm brain is enabled AND voice channel is set to Manual listen mode (V key opens mic).');
  bullet(ctx, 'Check browser microphone permission. Chrome shows a mic icon in the address bar when permission is granted.');
  bullet(ctx, 'Speak clearly and include the full reference — "tell me about call CN-26-0457" works more reliably than fast slang.');
  bullet(ctx, 'If the brain always says "which call did you mean?", you may not have a conversational context yet — mention a call number explicitly in your first utterance to seed the resolver.');

  h2(ctx, 'Call Management');

  h3(ctx, 'Call missing from list');
  bullet(ctx, 'Check filter chips (pending / active / archived) at top of call list — a stray filter setting hides calls.');
  bullet(ctx, 'Use CI <call#> to jump directly — bypasses filters.');
  bullet(ctx, 'If the call was created by another dispatcher and should be visible to you, your role may not have permission. Check with a supervisor.');
  bullet(ctx, 'If truly missing, Admin -> Audit Log will show any deletion record.');

  h3(ctx, 'Cannot assign a unit');
  bullet(ctx, 'Unit may be off-duty (logged off or status = off_duty). Log the unit on first or pick another unit.');
  bullet(ctx, 'Call status may not allow assignment (e.g. archived). Use CI to verify call status.');
  bullet(ctx, 'Unit may already be assigned to another call. Check the unit\'s row in the roster.');

  h3(ctx, 'Wrong disposition saved');
  paragraph(ctx,
    'Dispositions cannot be edited after clear, by design — the audit trail must reflect what was actually recorded at the time. Open the archived call from Records, add a correction note explaining the actual outcome, and flag for supervisor review. The supervisor can add a supervisor-override note if formal correction is required.',
  );

  h3(ctx, 'Duplicate call (same incident reported twice)');
  bullet(ctx, 'Select both calls.');
  bullet(ctx, 'Use the Merge button in the detail pane header (supervisor only).');
  bullet(ctx, 'The older call absorbs the newer; both audit trails are preserved.');
  bullet(ctx, 'Do NOT just clear the duplicate with "Cancelled by Caller" — it loses the link. Merge preserves the relationship.');

  h2(ctx, 'Browser & Performance');

  h3(ctx, 'Console feels slow or laggy');
  bullet(ctx, 'First suspect: too many browser tabs open. Close everything except RMPG Flex.');
  bullet(ctx, 'Check CPU usage via Task Manager / Activity Monitor. If Chrome is at 100%, reload the page — a memory leak in the browser can accumulate over a long shift.');
  bullet(ctx, 'Clear browser cache (Ctrl+Shift+Delete -> Cached images and files).');
  bullet(ctx, 'If consistently slow on one workstation but fine on others, file an IT ticket — that machine may need maintenance.');

  h3(ctx, 'Browser shows "memory low" warning');
  paragraph(ctx,
    'Long shifts accumulate DOM nodes. Reload every 8-12 hours proactively — start-of-shift is a good time.',
  );

  h3(ctx, 'Page renders blank / white after reload');
  bullet(ctx, 'Force cache-bust: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac).');
  bullet(ctx, 'If still blank, check DevTools Console (F12 -> Console) for red errors and screenshot them for IT.');
  bullet(ctx, 'Try a different browser. Chrome is primary-supported; Edge and Firefox are secondary.');
  bullet(ctx, 'If blank on every workstation in the room, the server may have crashed. Check https://rmpgutah.us/api/health — if that is also down, page the on-call admin immediately.');

  h2(ctx, 'Printing & PDFs');

  h3(ctx, 'Downloaded PDF is blank or corrupted');
  bullet(ctx, 'Retry the download — generation is fast but can race conditions on slow machines.');
  bullet(ctx, 'Disable any browser extensions (ad blockers especially) that might interfere with blob URLs.');
  bullet(ctx, 'Try from a different browser.');

  h3(ctx, 'Cannot print from the browser');
  paragraph(ctx,
    'Open the downloaded PDF in your OS PDF viewer (Preview on Mac, Adobe Reader on Windows) and print from there. Browser-based printing sometimes mangles complex layouts.',
  );

  calloutBox(ctx, 'Emergency Contact',
    'Production issues during a shift that block dispatch: page the on-call admin immediately. System lockups: Ctrl+Shift+R to hard reload. If the app is unreachable on multiple workstations, fall back to radio + paper logs and resync from dispatch recordings when service returns. Never delay a response waiting for the console to come back.',
    'warn',
  );
}

function section10(ctx: GuideContext): void {
  title(ctx, '10. Radio Etiquette & Voice Protocols');

  paragraph(ctx,
    'The console is only half the job. Radio discipline — how you talk on the air — shapes how officers perceive dispatch and directly affects officer safety. A dispatcher who is calm, clear, and brief on the radio is worth more to the officers than any feature in this system.',
  );

  h2(ctx, 'Core Radio Principles');
  bullet(ctx, 'Calm first. Your voice sets the emotional tone for the entire shift. If you sound panicked, officers hear danger even when the facts do not warrant it.');
  bullet(ctx, 'Clear second. Pronounce every word fully. Avoid regional or personal slang.');
  bullet(ctx, 'Brief third. Every second of your airtime is a second that officers cannot use. Plan what you are going to say BEFORE you press the push-to-talk.');
  bullet(ctx, 'Acknowledge everything. Silence from dispatch feels like abandonment. A simple "10-4" confirms you received.');

  h2(ctx, 'Call Formats');
  paragraph(ctx,
    'Structure your transmissions so officers can predict what is coming. The agency-standard format for dispatching a call:',
  );
  paragraph(ctx,
    '"[Unit call sign], [dispatch]. [Priority], [nature of call] at [address or cross streets]. [Caller info or notable flags]."',
  );
  paragraph(ctx,
    'Example: "3-Adam, dispatch. P1, domestic in progress, 123 Main Street, apartment 4B. Caller states weapons involved, male subject in the garage."',
  );
  paragraph(ctx,
    'For status acknowledgments:',
  );
  bullet(ctx, 'Enroute acknowledgement: "3-Adam, enroute, 10-4."');
  bullet(ctx, 'On-scene acknowledgement: "3-Adam, 10-97."');
  bullet(ctx, 'Clear with disposition: "3-Adam, clear, report taken, 10-4."');

  h2(ctx, 'Phonetic Alphabet');
  paragraph(ctx,
    'Use the NATO phonetic alphabet for any letter that could be confused (most of them). Utah law enforcement standard phonetic set:',
  );
  table(ctx,
    ['Letter', 'Word', 'Letter', 'Word', 'Letter', 'Word'],
    [
      ['A', 'Adam',    'J', 'John',    'S', 'Sam'],
      ['B', 'Boy',     'K', 'King',    'T', 'Tom'],
      ['C', 'Charles', 'L', 'Lincoln', 'U', 'Union'],
      ['D', 'David',   'M', 'Mary',    'V', 'Victor'],
      ['E', 'Edward',  'N', 'Nora',    'W', 'William'],
      ['F', 'Frank',   'O', 'Ocean',   'X', 'X-ray'],
      ['G', 'George',  'P', 'Paul',    'Y', 'Young'],
      ['H', 'Henry',   'Q', 'Queen',   'Z', 'Zebra'],
      ['I', 'Ida',     'R', 'Robert',  '',  ''],
    ],
    [1, 3, 1, 3, 1, 3],
  );

  paragraph(ctx,
    'Example: plate 8-IDA-745 is spoken "eight, ida, seven four five" or "eight, india, seven four five" if your agency uses NATO instead of the law-enforcement variant. The RMPG standard is the law-enforcement set shown above.',
  );

  h2(ctx, 'Timing & Cadence');
  bullet(ctx, 'Pause one second after pressing the push-to-talk before you start speaking — otherwise the first syllable gets clipped.');
  bullet(ctx, 'Pause one second before releasing the push-to-talk, too — otherwise the last word gets clipped.');
  bullet(ctx, 'Speak slightly slower than conversational pace. Officers in moving vehicles with partial audio need every syllable.');
  bullet(ctx, 'Do not stack transmissions. If multiple units are calling, respond to one, then the next. "Stand by, 3-Bravo" tells a waiting unit they have been heard.');

  h2(ctx, 'Sensitive Transmissions');
  paragraph(ctx,
    'Anything that is audible on the main radio channel is heard by scanner listeners, bystanders, and media. Be mindful:',
  );
  bullet(ctx, 'Do not broadcast subject medical details over open radio. "Subject is in distress" is fine; "Subject has HIV, mental illness, and heart condition" is not.');
  bullet(ctx, 'Do not broadcast undercover or plainclothes officer names or locations. Use call signs only.');
  bullet(ctx, 'Do not broadcast surveillance target details. Move sensitive calls to a tactical channel (Tac 1 / Tac 2).');
  bullet(ctx, 'For juvenile-involved crimes, use "J/V" rather than "juvenile" when possible and never broadcast juvenile names.');

  h2(ctx, 'Voice Commands (Using the Brain)');
  paragraph(ctx,
    'With the Dispatcher Brain enabled (Section 7), you can speak commands to the console itself — not over the radio, but into the voice channel (V key or auto-listen). The system treats your voice as CAD command input.',
  );
  bullet(ctx, 'Speak naturally: "put 3-Adam on scene" works, "three adam ten ninety-seven" works, "ST 3A 10-97" works.');
  bullet(ctx, 'Confirmation: if the command mutates anything (status change, dispatch, clear), the system speaks confirmation back.');
  bullet(ctx, 'Low-confidence recognition: if the brain is uncertain, it asks "did you say X? please confirm" and waits for yes/no.');
  bullet(ctx, 'Mistakes: speak "cancel" or "nevermind" to void a pending command before it executes.');

  calloutBox(ctx, 'Voice + Radio',
    'Never mix the two channels. Voice commands to the brain are INPUT to the console. Radio transmissions are conversations with officers. If you press push-to-talk while the brain is listening, the brain will hear your radio-talk and try to parse it as a command. Toggle the voice channel off during radio traffic.',
  );
}

function section11(ctx: GuideContext): void {
  title(ctx, '11. Documentation Standards');

  paragraph(ctx,
    'Every keystroke in the dispatch console is potentially discoverable in legal proceedings. This section covers what to document, how to phrase it, and what belongs on which channel — dispatch notes vs. radio vs. email vs. supervisor memo.',
  );

  h2(ctx, 'The Dispatcher Notes Standard');
  paragraph(ctx,
    'Every call should have enough notes that a supervisor reading six months later can reconstruct what happened without talking to anyone. Good notes answer the journalistic five Ws plus one: who, what, when, where, why, how.',
  );

  h3(ctx, 'A good note example');
  paragraph(ctx,
    '"Caller (Sarah Miller, 801-555-0100) reports ex-boyfriend (John Doe, 34, last seen black hoodie black pants) banging on front door, threatening, possibly armed with bat. Subject left SB on State Street in blue Honda Civic, UT 8IDA745, approximately 5 minutes prior. Caller inside with two children, doors locked, staying on line."',
  );

  h3(ctx, 'A poor note example');
  paragraph(ctx,
    '"DV call. Guy left before we got there. Car was Honda."',
  );

  paragraph(ctx,
    'The poor example omits the caller identity, the subject\'s description, the direction of travel, the license plate, the timeline, the weapon, and the location of the caller inside the residence. A responding officer does not know whether to approach the address or try to intercept the vehicle.',
  );

  h2(ctx, 'Objective vs. Subjective');
  paragraph(ctx,
    'Objective notes record observations. Subjective notes record interpretations. Both have a place, but they must be clearly separated.',
  );
  bullet(ctx, 'Objective: "Caller is speaking in a low voice and asking dispatcher to stay on the line."');
  bullet(ctx, 'Subjective: "Caller sounds scared."');
  bullet(ctx, 'Both acceptable if framed: "Caller volume is low and breathing is rapid; audible fear in voice."');
  bullet(ctx, 'Unacceptable: "Caller is panicking and probably exaggerating."');

  h2(ctx, 'What Goes Where');
  table(ctx,
    ['Content', 'Channel'],
    [
      ['Factual call details, suspect description, timeline', 'Call notes (visible to all dispatchers + officers)'],
      ['Radio acknowledgements, unit status confirmations',   'Automatic audit log; no dispatcher action needed'],
      ['Operational coordination with another agency',        'Call notes (so your colleague can take over if needed)'],
      ['Personal observations about an officer or colleague', 'Supervisor email — NOT call notes'],
      ['Medical details of a subject',                        'Call notes only if operationally necessary; no diagnoses'],
      ['Juvenile personal information',                       'Redacted in call notes; full details only in secure incident report'],
      ['Your theories about guilt or motive',                 'Nowhere in the dispatch record'],
    ],
    [4, 6],
  );

  h2(ctx, 'Attribution & Timestamps');
  paragraph(ctx,
    'You do not need to write your name or the time in a note — the system stamps both automatically. Every note shows who wrote it and when. This means you can write shorter notes (just the content) and the reader can trace who did what.',
  );

  h2(ctx, 'Corrections');
  paragraph(ctx,
    'Once a note is committed it cannot be edited or deleted — the audit trail must be intact. To correct a note, add a new note that references the earlier entry: "Correction to note at 14:23: subject\'s last name is Doe, not Dow."',
  );
  paragraph(ctx,
    'This rule is important: the audit log is a legal record. Changing past notes after the fact destroys that legal weight. Your agency\'s policy (and Utah public-records law) require append-only notes.',
  );

  calloutBox(ctx, 'Policy',
    'Any attempt to edit or remove a committed note requires supervisor override and generates a mandatory review. "I fat-fingered the address" is corrected by a follow-up note, not by editing.',
    'warn',
  );
}

function section12(ctx: GuideContext): void {
  title(ctx, '12. Using the Map');

  paragraph(ctx,
    'The map is the spatial complement to the call list and unit roster. During a pursuit, tactical operation, or area search, the map becomes your primary situational-awareness surface.',
  );

  h2(ctx, 'Map Layers');
  bullet(ctx, 'Base map — dark CartoDB (Spillman-style) by default. Switch to Google Satellite for aerial imagery when searching outdoors.');
  bullet(ctx, 'Beat polygons — semi-transparent colored overlays showing sector and beat boundaries. Toggle visibility with the layer selector.');
  bullet(ctx, 'Unit GPS pins — live positions of all units with fresh GPS. Pin color matches unit status (green available, amber busy, red dispatched, etc.).');
  bullet(ctx, 'Active call markers — call icons at call locations. Priority-tinted same as the call list.');
  bullet(ctx, 'Breadcrumb trail — optional historical position trail for a selected unit; shows last 30 minutes.');
  bullet(ctx, 'Speed zones — admin-defined overlays for school zones, highways, etc.');
  bullet(ctx, 'Geofences — beat boundaries used by the Dispatcher Brain\'s geofence-breach rule.');

  h2(ctx, 'Common Map Actions');
  bullet(ctx, 'Click a unit pin — detail pane jumps to that unit. Shows live GPS, last update, current call.');
  bullet(ctx, 'Click a call marker — detail pane jumps to that call.');
  bullet(ctx, 'Right-click anywhere on the map — context menu with options including "New call at this location", "Run PR on this address", "Measure distance".');
  bullet(ctx, 'Drag and zoom as normal. Map state (center + zoom + active layers) persists per-workstation.');

  h2(ctx, 'Finding the Nearest Unit');
  paragraph(ctx,
    'When a call comes in at a known address, the map automatically lights up the three nearest available units. Their distance from the call is shown in the roster. Assign based on distance unless specialty is required.',
  );

  h2(ctx, 'Pursuit Tracking');
  paragraph(ctx,
    'During an active pursuit, pin the pursued unit and watch their GPS trail. The map auto-pans to keep them centered if you enable "Follow selected unit". Trail length increases to 60 minutes during pursuits for post-incident review.',
  );

  h2(ctx, 'Area Searches');
  bullet(ctx, 'Draw a search grid with the rectangle tool in the map toolbar.');
  bullet(ctx, 'Assign units to sectors of the grid verbally; track each unit\'s sector assignment in call notes.');
  bullet(ctx, 'Watch coverage by observing the breadcrumb trails.');

  h2(ctx, 'Map Troubleshooting');
  paragraph(ctx,
    'Map blank: tile cache may be empty. Admin -> Tiles -> Reseed. Unit pins missing: see "GPS not updating" in Section 9. Lag on pan/zoom: close other browser tabs and reload.',
  );
}

function section13(ctx: GuideContext): void {
  title(ctx, '13. Shift Change Procedure');

  paragraph(ctx,
    'Shift change is the riskiest 15-minute window of any dispatch day. Calls get dropped, units get double-counted, context disappears. A disciplined shift-change procedure prevents all of that.',
  );

  h2(ctx, 'Ten Minutes Before End of Shift');
  bullet(ctx, 'Stop taking new routine calls if possible — let the incoming dispatcher take them so they start fresh on their own work.');
  bullet(ctx, 'Exception: you still take P1/P2 calls; those cannot wait.');
  bullet(ctx, 'Begin the walkthrough with the incoming dispatcher if they are logged in early.');
  bullet(ctx, 'Open the Shift Handoff Notes (F8 -> HANDOFF) and jot anything that is not on a specific call: weather, road closures, BOLOs still active, supervisor reminders.');

  h2(ctx, 'Five Minutes Before');
  bullet(ctx, 'Walk through each active call in the detail pane. Summarize verbally: caller, location, nature, current status, what the officer is doing.');
  bullet(ctx, 'Walk through the unit roster. Which units are where, what each is doing, any units overdue for a status check.');
  bullet(ctx, 'Verify every on-scene unit has a recent status update — flag anything older than 6 minutes for the incoming dispatcher to watch.');

  h2(ctx, 'At End of Shift');
  bullet(ctx, 'Incoming dispatcher logs into their workstation.');
  bullet(ctx, 'Say out loud: "I am handing off [N] active calls and [M] units. You have command." Incoming dispatcher confirms "I have command." Both of you log the handoff verbally.');
  bullet(ctx, 'Incoming dispatcher takes over the call list; outgoing logs off and leaves the workstation clear.');
  bullet(ctx, 'Do NOT log off until the incoming dispatcher has explicitly taken command.');

  h2(ctx, 'Incoming Dispatcher Responsibilities');
  bullet(ctx, 'Arrive 10 minutes early. Log in, set up headset, read shift handoff notes.');
  bullet(ctx, 'Do the walkthrough actively — ask questions, repeat back key facts, verify you understand.');
  bullet(ctx, 'Note your start time in the dispatch log.');
  bullet(ctx, 'Ask about any ongoing investigations, BOLOs, or tactical operations that span shifts.');

  h2(ctx, 'Cross-Shift Calls');
  paragraph(ctx,
    'Some calls span shifts — long welfare investigations, continuing pursuits, DV investigations that take hours. These are the highest-risk handoffs because the incoming dispatcher has no context. For any call that has been active more than 30 minutes, treat the handoff as a formal briefing: what happened, what is happening now, what the next expected event is.',
  );

  calloutBox(ctx, 'Worst Case',
    'If a shift change happens during an active P1 pursuit or tactical operation, the outgoing dispatcher stays on until the incident is resolved. Do not hand off mid-pursuit. Continuity outweighs scheduled shift ends.',
    'warn',
  );
}

function appendixA(ctx: GuideContext): void {
  title(ctx, 'Appendix A — Incident Type Reference');

  paragraph(ctx,
    'The incident-type autocomplete in the intake form recognizes the types below. Typing the first few letters surfaces matching types; Tab accepts. The default priority is agency-configurable in Admin -> Incident Types.',
  );

  h2(ctx, 'Crimes Against Persons');
  table(ctx,
    ['Type', 'Default Priority'],
    [
      ['Homicide', 'P1'],
      ['Assault in progress', 'P1'],
      ['Assault — delayed report', 'P3'],
      ['Robbery in progress', 'P1'],
      ['Robbery — delayed report', 'P2'],
      ['Sexual assault in progress', 'P1'],
      ['Sexual assault — delayed report', 'P2'],
      ['Kidnapping', 'P1'],
      ['Domestic violence in progress', 'P1'],
      ['Domestic disturbance', 'P2'],
      ['Threats', 'P3'],
      ['Harassment', 'P3'],
    ],
    [6, 2],
  );

  h2(ctx, 'Crimes Against Property');
  table(ctx,
    ['Type', 'Default Priority'],
    [
      ['Burglary in progress', 'P1'],
      ['Burglary — delayed report', 'P3'],
      ['Theft in progress', 'P2'],
      ['Theft — delayed report', 'P3'],
      ['Vehicle theft in progress', 'P1'],
      ['Vehicle theft — delayed report', 'P3'],
      ['Vandalism', 'P3'],
      ['Trespass', 'P3'],
      ['Shoplifting in progress', 'P2'],
      ['Fraud', 'P4'],
      ['Arson', 'P1'],
    ],
    [6, 2],
  );

  h2(ctx, 'Traffic');
  table(ctx,
    ['Type', 'Default Priority'],
    [
      ['Traffic accident with injuries', 'P1'],
      ['Traffic accident — no injuries', 'P3'],
      ['Traffic accident — hit and run', 'P2'],
      ['Reckless driver', 'P2'],
      ['DUI in progress', 'P2'],
      ['Traffic stop', '-'],
      ['Road hazard', 'P3'],
    ],
    [6, 2],
  );

  h2(ctx, 'Public Safety / Service');
  table(ctx,
    ['Type', 'Default Priority'],
    [
      ['Suspicious person', 'P3'],
      ['Suspicious vehicle', 'P3'],
      ['Suspicious circumstances', 'P3'],
      ['Welfare check', 'P3'],
      ['Mental health crisis', 'P1'],
      ['Suicidal subject', 'P1'],
      ['Missing person — juvenile', 'P1'],
      ['Missing person — adult', 'P2'],
      ['Disturbance', 'P2'],
      ['Noise complaint', 'P3'],
      ['Civil standby', 'P4'],
      ['Lost / found property', 'P4'],
    ],
    [6, 2],
  );
}

function appendixB(ctx: GuideContext): void {
  title(ctx, 'Appendix B — Disposition Codes');

  paragraph(ctx,
    'When you clear a call (F7 or CL), the system prompts for a disposition code. The code is permanent — choose carefully. Most calls can be cleared with one of the codes below.',
  );

  table(ctx,
    ['Code', 'Disposition', 'When to Use'],
    [
      ['ARR',  'Arrest Made',          'Subject taken into custody on this call.'],
      ['RPT',  'Report Taken',         'Officer wrote or will write a formal incident report.'],
      ['GOA',  'Gone On Arrival',      'Subject left before officer arrived; no further action this call.'],
      ['UNF',  'Unfounded',            'Investigation determined no crime occurred.'],
      ['AST',  'Assistance Rendered',  'Aid provided, no report or arrest needed.'],
      ['REF',  'Referred to Agency',   'Matter handled by another agency (SLCPD, UHP, CPS, etc.).'],
      ['CAN',  'Cancelled by Caller',  'Caller cancelled before officer dispatched or arrived.'],
      ['CIV',  'Civil Matter',         'Not a criminal matter; parties directed to civil remedies.'],
      ['INF',  'Information Only',     'Call was informational; no action required.'],
      ['WAR',  'Warning Issued',       'Verbal or written warning given in lieu of citation.'],
      ['CIT',  'Citation Issued',      'Traffic or misdemeanor citation written.'],
      ['TRN',  'Transported',          'Subject transported (hospital, detox, shelter, jail).'],
      ['NOC',  'No Contact',           'Unable to contact subject; left note or will follow up.'],
      ['DUP',  'Duplicate Call',       'Already logged elsewhere; merged into primary record.'],
      ['REQ',  'Caller Requested Cancellation', 'Caller asked officer not to respond.'],
      ['OTH',  'Other (see notes)',    'Use sparingly; always include explanatory note.'],
    ],
    [2, 5, 7],
  );

  paragraph(ctx,
    'Do NOT use OTH as a catch-all. If you find yourself reaching for OTH more than once per shift, the disposition list may be missing a code your agency needs — talk to your supervisor about adding one.',
  );
}

function appendixC(ctx: GuideContext): void {
  title(ctx, 'Appendix C — Architecture for Dispatchers');

  paragraph(ctx,
    'A light-touch overview of how the system is put together, aimed at dispatchers who want to understand the plumbing enough to troubleshoot intelligently without becoming system administrators.',
  );

  h2(ctx, 'Where Things Live');
  bullet(ctx, 'Server — hosted at the VPS, accessible at https://rmpgutah.us. Node.js Express application running under systemd.');
  bullet(ctx, 'Database — SQLite file on the server. Every call, unit, incident, citation, person, and vehicle record lives here.');
  bullet(ctx, 'WebSocket — bidirectional connection between your browser and the server. Every dispatch event broadcasts to all connected workstations.');
  bullet(ctx, 'Your browser — renders the React client. Runs locally; no sensitive data persisted on your workstation beyond session tokens and UI preferences.');
  bullet(ctx, 'Edge TTS — server-side neural voice synthesis. Audio streams back to your browser which applies radio-bandpass filtering for the authentic dispatch sound.');
  bullet(ctx, 'Offline tiles — CartoDB dark_matter map tiles cached on your workstation by the service worker, so the map keeps working if internet flakes.');

  h2(ctx, 'What Persists Where');
  table(ctx,
    ['Data', 'Lives In'],
    [
      ['Calls, units, incidents, citations, people, vehicles', 'Server database (authoritative)'],
      ['Your session token', 'Browser localStorage (valid until session expiry)'],
      ['Voice persona, terseness, brain enabled', 'Server users table + browser localStorage (sync)'],
      ['Panel sizes, map center/zoom',              'Browser localStorage (per-workstation)'],
      ['Offline map tiles',                          'Browser service worker cache'],
      ['Spoken transcript (in-memory buffer)',       'Browser memory only; cleared on reload'],
      ['Audit log',                                  'Server database (authoritative; immutable)'],
    ],
    [5, 7],
  );

  h2(ctx, 'Why This Matters');
  paragraph(ctx,
    'Knowing what lives where helps you troubleshoot smarter. If your voice persona follows you across workstations, that is because it is stored server-side. If your map reset to Utah-wide view after a reload, that is because the zoom level is stored in your browser, not the server. If you see a call on one workstation but not another, that is a sync issue, not a call-creation issue.',
  );

  h2(ctx, 'Who to Contact for What');
  table(ctx,
    ['Problem', 'Who'],
    [
      ['Console bug, feature request, training question', 'Your supervisor first; IT if system-level'],
      ['Server down, database corruption, hard lockup',   'On-call admin via pager'],
      ['Password reset, account lockout',                 'Admin user; supervisor can escalate'],
      ['Data correction requiring audit override',        'Supervisor; supervisor escalates to admin'],
      ['Policy question about documentation',             'Agency supervisor (not IT)'],
      ['Legal request for records',                       'Chief / legal counsel, not dispatch'],
    ],
    [5, 5],
  );
}

function quickReferenceCard(ctx: GuideContext): void {
  // This is the final page — a dense cheat sheet designed to be torn off.
  newPage(ctx);
  const d = ctx.doc;

  d.setFillColor(COLOR.ACCENT);
  d.rect(0, 50, PAGE.W, 6, 'F');

  d.setFont('helvetica', 'bold');
  d.setFontSize(16);
  d.setTextColor(COLOR.BLACK);
  d.text('QUICK-REFERENCE CARD', PAGE.W / 2, 80, { align: 'center' });
  d.setFont('helvetica', 'normal');
  d.setFontSize(9);
  d.setTextColor(COLOR.MUTED);
  d.text('Dispatch Console — Rocky Mountain Protective Group', PAGE.W / 2, 96, { align: 'center' });

  ctx.y = 110;

  // Compact 3-column layout: F-keys, 10-codes, common CAD verbs
  const colW = (PAGE.W - PAGE.MARGIN * 2 - 16) / 3;
  const colX = [PAGE.MARGIN, PAGE.MARGIN + colW + 8, PAGE.MARGIN + colW * 2 + 16];
  const topY = ctx.y;

  const writeList = (x: number, heading: string, rows: Array<[string, string]>): number => {
    d.setFont('helvetica', 'bold');
    d.setFontSize(10);
    d.setTextColor(COLOR.ACCENT);
    d.text(heading, x, topY);
    d.setDrawColor(COLOR.ACCENT);
    d.setLineWidth(1);
    d.line(x, topY + 3, x + 48, topY + 3);

    let yy = topY + 20;
    d.setFontSize(9);
    d.setTextColor(COLOR.INK);
    for (const [k, v] of rows) {
      d.setFont('helvetica', 'bold');
      d.text(k, x, yy);
      d.setFont('helvetica', 'normal');
      // Wrap the description if needed
      const lines = d.splitTextToSize(v, colW - 52) as string[];
      for (let i = 0; i < lines.length; i++) {
        d.text(lines[i], x + 44, yy + i * 11);
      }
      yy += Math.max(14, lines.length * 11 + 3);
    }
    return yy;
  };

  const fKeyBottom = writeList(colX[0], 'F-KEYS', [
    ['F2', 'New call'],
    ['F3', 'Dispatch unit'],
    ['F5', 'En route'],
    ['F6', 'On scene'],
    ['F7', 'Clear'],
    ['F8', 'CAD command line'],
    ['F12', 'NCIC query'],
    ['V', 'Open voice channel'],
    ['T', 'Toggle transcript'],
    ['?', 'Shortcut help'],
  ]);

  const tenCodeBottom = writeList(colX[1], '10-CODES', [
    ['10-4', 'Acknowledge'],
    ['10-6', 'Busy'],
    ['10-7', 'Out of service'],
    ['10-8', 'Available'],
    ['10-10', 'On break'],
    ['10-20', 'Location?'],
    ['10-23', 'Stand by'],
    ['10-50', 'Traffic collision'],
    ['10-76', 'En route'],
    ['10-97', 'On scene'],
    ['10-99', 'Officer emergency'],
  ]);

  const cadBottom = writeList(colX[2], 'CAD VERBS', [
    ['NC',  'New call'],
    ['CI',  'Select call'],
    ['AS',  'Assign unit'],
    ['ST',  'Unit status'],
    ['CL',  'Clear call'],
    ['NT',  'Append note'],
    ['PRI', 'Set priority'],
    ['BO',  'Broadcast BOLO'],
    ['QP',  'Query person'],
    ['QV',  'Query vehicle'],
    ['QW',  'Query warrant'],
    ['QT',  'Query plate'],
    ['PR',  'Premise alerts'],
    ['LE',  '10-code lookup'],
  ]);

  // Priority + safety flags stripe across bottom
  let bottomY = Math.max(fKeyBottom, tenCodeBottom, cadBottom) + 20;
  ctx.y = bottomY;

  // Priority stripe
  d.setFont('helvetica', 'bold');
  d.setFontSize(10);
  d.setTextColor(COLOR.ACCENT);
  d.text('PRIORITY', PAGE.MARGIN, bottomY);
  d.setDrawColor(COLOR.ACCENT);
  d.line(PAGE.MARGIN, bottomY + 3, PAGE.MARGIN + 56, bottomY + 3);

  const pWidth = (PAGE.W - PAGE.MARGIN * 2) / 4;
  const priorities: Array<[string, string, [number, number, number]]> = [
    ['P1', 'Life/safety — lights + siren',   [185, 28, 28]],
    ['P2', 'In-progress — respond promptly', [217, 119, 6]],
    ['P3', 'Routine',                        [202, 138, 4]],
    ['P4', 'Cold / report only',             [107, 114, 128]],
  ];
  bottomY += 16;
  for (let i = 0; i < priorities.length; i++) {
    const [code, desc, rgb] = priorities[i];
    const px = PAGE.MARGIN + pWidth * i;
    d.setFillColor(rgb[0], rgb[1], rgb[2]);
    d.rect(px, bottomY, pWidth - 8, 40, 'F');
    d.setTextColor(255, 255, 255);
    d.setFont('helvetica', 'bold');
    d.setFontSize(14);
    d.text(code, px + 8, bottomY + 18);
    d.setFont('helvetica', 'normal');
    d.setFontSize(8);
    const wrapped = d.splitTextToSize(desc, pWidth - 20) as string[];
    for (let j = 0; j < wrapped.length; j++) {
      d.text(wrapped[j], px + 8, bottomY + 30 + j * 9);
    }
  }
  bottomY += 56;

  // Safety flags row
  d.setFont('helvetica', 'bold');
  d.setFontSize(10);
  d.setTextColor(COLOR.ACCENT);
  d.text('SAFETY FLAGS', PAGE.MARGIN, bottomY);
  d.line(PAGE.MARGIN, bottomY + 3, PAGE.MARGIN + 80, bottomY + 3);
  bottomY += 16;
  d.setFont('helvetica', 'normal');
  d.setFontSize(9);
  d.setTextColor(COLOR.INK);
  const flags = 'Weapons  •  Domestic Violence  •  Felony in Progress  •  Mental Health  •  Officer Safety Caution  •  Pursuit  •  Hazmat  •  Juvenile Involved';
  d.text(flags, PAGE.MARGIN, bottomY);
  bottomY += 20;

  // Voice summary
  d.setFont('helvetica', 'bold');
  d.setTextColor(COLOR.ACCENT);
  d.setFontSize(10);
  d.text('VOICE (WHEN ENABLED)', PAGE.MARGIN, bottomY);
  d.line(PAGE.MARGIN, bottomY + 3, PAGE.MARGIN + 124, bottomY + 3);
  bottomY += 16;
  d.setFont('helvetica', 'normal');
  d.setFontSize(9);
  d.setTextColor(COLOR.INK);
  d.text('User Profile → Voice tab. Toggle Dispatcher Brain (Beta). Terseness: narrative / standard / terse.', PAGE.MARGIN, bottomY);
  d.text('Brain speaks: events (citations, incidents, warrants, evidence, arrests, HR) + coaching (DV, felony, MH,', PAGE.MARGIN, bottomY + 12);
  d.text('overdue status, geofence breach). Press V for mic. "Tell me about that call." Press T for transcript.', PAGE.MARGIN, bottomY + 24);

  // Emergency box at very bottom
  bottomY = PAGE.H - 120;
  d.setFillColor(255, 244, 242);
  d.setDrawColor(COLOR.RED);
  d.setLineWidth(1.5);
  d.rect(PAGE.MARGIN, bottomY, PAGE.W - PAGE.MARGIN * 2, 50, 'FD');
  d.setFont('helvetica', 'bold');
  d.setFontSize(11);
  d.setTextColor(COLOR.RED);
  d.text('EMERGENCY — 10-99 / OFFICER DOWN', PAGE.MARGIN + 12, bottomY + 18);
  d.setFont('helvetica', 'normal');
  d.setFontSize(9);
  d.setTextColor(COLOR.INK);
  d.text('Broadcast immediately. Dispatch all available units to last known position. Notify supervisor', PAGE.MARGIN + 12, bottomY + 32);
  d.text('and SLCPD if within city limits. Do NOT clear until officer confirms 10-4.', PAGE.MARGIN + 12, bottomY + 44);
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Build the Dispatch Guide PDF and trigger a browser download.
 * Filename includes today's date so dispatchers can see at a glance
 * which version they have on the console.
 */
export function generateDispatchGuidePdf(): void {
  const doc = new jsPDF({ format: 'letter', unit: 'pt' });
  const ctx: GuideContext = { doc, y: PAGE.MARGIN, page: 1 };

  // Cover page (no header/footer)
  coverPage(ctx);

  // Sections 1-13 — each starts on a fresh page for readability
  newPage(ctx);    section1(ctx);
  newPage(ctx);    section2(ctx);
  newPage(ctx);    section3(ctx);
  newPage(ctx);    section4(ctx);
  newPage(ctx);    section5(ctx);
  newPage(ctx);    section6(ctx);
  newPage(ctx);    section7(ctx);
  newPage(ctx);    section8(ctx);
  newPage(ctx);    section9(ctx);
  newPage(ctx);    section10(ctx);
  newPage(ctx);    section11(ctx);
  newPage(ctx);    section12(ctx);
  newPage(ctx);    section13(ctx);

  // Appendices
  newPage(ctx);    appendixA(ctx);
  newPage(ctx);    appendixB(ctx);
  newPage(ctx);    appendixC(ctx);

  // Quick-reference card on its own fresh page
  quickReferenceCard(ctx);

  // Footer pass — re-render page numbers now that total is known.
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    if (p === 1) continue; // cover page has no footer
    pageFooter({ doc, y: 0, page: p }, total);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`RMPG-Dispatch-Guide-${stamp}.pdf`);
}
