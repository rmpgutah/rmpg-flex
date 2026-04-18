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
  d.setFontSize(11);
  d.setTextColor(COLOR.INK);
  const tocY = 440;
  d.setFont('helvetica', 'bold');
  d.text('CONTENTS', cx, tocY, { align: 'center' });
  d.setFont('helvetica', 'normal');
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
    '— Quick-Reference Card (last page) —',
  ];
  for (let i = 0; i < toc.length; i++) {
    d.text(toc[i], cx, tocY + 20 + i * 18, { align: 'center' });
  }

  // Bottom stamp
  d.setFontSize(9);
  d.setTextColor(COLOR.MUTED);
  d.text(`${generatedStamp()}  •  CONFIDENTIAL — AUTHORIZED USE ONLY`, cx, PAGE.H - 48, { align: 'center' });
}

function section1(ctx: GuideContext): void {
  title(ctx, '1. Console Overview');

  paragraph(ctx,
    'The Dispatch Console is the control center for managing active calls-for-service, unit status, and field activity. It combines a real-time call stack, unit roster, map, and a command line that mirrors traditional CAD radio shorthand. Everything you see updates live across every connected workstation via WebSocket — when another dispatcher changes a unit\'s status, your screen reflects it within a second.',
  );

  h2(ctx, 'Screen Layout');
  bullet(ctx, 'Top toolbar — brand bar, main menus, F-key shortcuts, status bar.');
  bullet(ctx, 'Call list (left) — active calls sorted by priority. Red = P1, orange = P2, yellow = P3.');
  bullet(ctx, 'Unit roster (center) — available, dispatched, enroute, on-scene, and out-of-service units.');
  bullet(ctx, 'Detail pane (right) — selected call details, narrative notes, linked people/vehicles, audit log.');
  bullet(ctx, 'Map (bottom or tab) — unit GPS pins + active call markers. Dark Spillman style with Utah beat overlay.');
  bullet(ctx, 'Status bar (bottom) — live call counts, F-key hints, system clock, WebSocket indicator.');

  calloutBox(ctx, 'Tip',
    'Every panel resizes. Drag the vertical dividers to give yourself more room for the list that matters most right now — typically the unit roster during shift change or the call list when things get busy.',
  );
}

function section2(ctx: GuideContext): void {
  title(ctx, '2. Taking a Call End-to-End');

  paragraph(ctx,
    'A typical call flows through six states: pending → dispatched → enroute → on-scene → clearing → archived. Every transition is audited and timestamped.',
  );

  h2(ctx, 'Step 1 — Create the call');
  bullet(ctx, 'Press F2 or click "New Call". The intake form opens.');
  bullet(ctx, 'Enter incident type (try typing "domestic" — autocomplete surfaces matching types).');
  bullet(ctx, 'Address: start typing, the map geocodes as you go. Verify the pin before saving.');
  bullet(ctx, 'Priority auto-populates from incident type but you can override (P1–P4).');
  bullet(ctx, 'Flag any safety concerns BEFORE saving: weapons, DV, felony, mental health, etc.');
  bullet(ctx, 'Click Save — the call appears in the pending list and broadcasts to all workstations.');

  h2(ctx, 'Step 2 — Assign a unit');
  bullet(ctx, 'Select the call (click it or use CI <call#> in the command line).');
  bullet(ctx, 'Press F3 or click "Dispatch", then pick a unit from the available roster.');
  bullet(ctx, 'The unit receives the call on their mobile/MDT; status changes to "dispatched".');
  bullet(ctx, 'For P1 or multi-unit calls, dispatch a second unit immediately — the brain suggests this.');

  h2(ctx, 'Step 3 — Track status transitions');
  bullet(ctx, 'F5 = En Route (unit acknowledged and is moving).');
  bullet(ctx, 'F6 = On Scene (unit has arrived). Timer starts for welfare check.');
  bullet(ctx, 'F7 = Clear (call resolved). Prompts for disposition code.');

  h2(ctx, 'Step 4 — Document during the call');
  paragraph(ctx,
    'Use the notes field continuously. Every note timestamps and broadcasts so another dispatcher can pick up mid-call without asking "what\'s happening?". Add linked persons/vehicles as they\'re identified — they auto-carry into the incident report if one is generated.',
  );

  h2(ctx, 'Step 5 — Convert to incident (if required)');
  paragraph(ctx,
    'When officers need a formal report (arrests, injury, property damage, victim interview), convert the call to an incident from the detail pane. Persons, vehicles, and the narrative all carry over — the officer only has to add what\'s new.',
  );

  h2(ctx, 'Step 6 — Clear');
  bullet(ctx, 'Press F7. Enter disposition (arrest, report taken, gone on arrival, etc.).');
  bullet(ctx, 'Call moves to "archived" — searchable from Records.');
  bullet(ctx, 'Unit automatically returns to "available" unless they requested out-of-service.');
}

function section3(ctx: GuideContext): void {
  title(ctx, '3. Unit Status & 10-Codes');

  paragraph(ctx,
    'RMPG Flex accepts the standard 10-codes used across Utah law enforcement. Officers can speak them (voice command), type them on the command line, or click status chips.',
  );

  table(ctx,
    ['Code', 'Status', 'Meaning'],
    [
      ['10-4',  'ACK',         'Acknowledged / understood'],
      ['10-6',  'BUSY',        'Busy — not available'],
      ['10-7',  'OUT SERVICE', 'Out of service (meals, fuel, admin)'],
      ['10-8',  'AVAILABLE',   'In service, available for calls'],
      ['10-10', 'BREAK',       'On break'],
      ['10-20', 'LOCATION',    'What is your location?'],
      ['10-23', 'STANDBY',     'Stand by'],
      ['10-50', 'TC',          'Traffic collision'],
      ['10-76', 'EN ROUTE',    'En route / responding'],
      ['10-97', 'ON SCENE',    'Arrived / on scene'],
      ['10-99', 'EMERGENCY',   'Officer emergency (triggers panic)'],
    ],
    [2, 3, 6],
  );

  calloutBox(ctx, 'Safety',
    '10-99 is the panic signal. Saying "ten ninety-nine" or "officer down" through the voice channel broadcasts an emergency to every workstation and plays the panic tone. Do not use casually.',
    'warn',
  );
}

function section4(ctx: GuideContext): void {
  title(ctx, '4. Safety Flags & Priority Levels');

  h2(ctx, 'Priority');
  table(ctx,
    ['Priority', 'Meaning', 'Response', 'Color'],
    [
      ['P1', 'Emergency — immediate life/safety', 'Lights + siren, nearest unit',   'Red'],
      ['P2', 'Urgent — in progress or imminent',  'Respond promptly',               'Orange'],
      ['P3', 'Routine — reported, delayed okay',  'Standard response',              'Yellow'],
      ['P4', 'Cold — report only / no response',  'Phone report or deferred visit', 'Gray'],
    ],
    [2, 5, 5, 3],
  );

  h2(ctx, 'Safety flags (set at call intake)');
  paragraph(ctx,
    'Every call can carry one or more safety flags. Flags increase the priority score, trigger voice warnings to responding units, and become part of the permanent record.',
  );

  bullet(ctx, 'Weapons Involved — subject is armed or weapons reported on location.');
  bullet(ctx, 'Domestic Violence — current or prior DV incident at this address.');
  bullet(ctx, 'Felony in Progress — ongoing felony; dispatch second unit immediately.');
  bullet(ctx, 'Mental Health Crisis — request CIT-trained responder and non-lethal staging.');
  bullet(ctx, 'Officer Safety Caution — history flag from prior encounters.');
  bullet(ctx, 'Vehicle Pursuit — active pursuit; activates pursuit protocol.');
  bullet(ctx, 'Hazmat — hazardous material present.');
  bullet(ctx, 'Juvenile Involved — minor involved as victim, subject, or witness.');

  calloutBox(ctx, 'Policy',
    'Flags set on a call follow the call into the incident report. Never remove a safety flag to "clean up" a record — add a correcting note instead.',
    'warn',
  );
}

function section5(ctx: GuideContext): void {
  title(ctx, '5. F-Key Hotkeys');

  paragraph(ctx,
    'The F-keys work from anywhere in the dispatch screen unless a text field has focus. Press Esc first to release focus if a hotkey is not responding.',
  );

  table(ctx,
    ['Key', 'Action', 'Notes'],
    [
      ['F2',  'New Call',           'Opens intake form.'],
      ['F3',  'Dispatch Unit',      'Requires selected pending call.'],
      ['F5',  'Set En Route',       'Current user\'s unit → en_route.'],
      ['F6',  'Set On Scene',       'Starts welfare-check timer.'],
      ['F7',  'Clear Call',         'Prompts for disposition code.'],
      ['F8',  'Focus Command Line', 'See Section 6 for syntax.'],
      ['F12', 'NCIC Query',         'Opens NCIC / records query panel.'],
      ['V',   'Open Voice Channel', 'Manual listen mode (when enabled).'],
      ['T',   'Toggle Transcript',  'Shows every spoken announcement.'],
      ['?',   'Keyboard Shortcuts', 'Full shortcut help overlay.'],
    ],
    [2, 4, 7],
  );
}

function section6(ctx: GuideContext): void {
  title(ctx, '6. CAD Command Line');

  paragraph(ctx,
    'Press F8 to focus the command line. Type a verb followed by arguments. The command line accepts both 10-codes and the terser two-letter verbs below — use whichever you are faster with.',
  );

  h2(ctx, 'Most-used commands');
  table(ctx,
    ['Verb', 'Syntax', 'Purpose'],
    [
      ['NC',  'NC <type> [location]',        'New call for service'],
      ['CI',  'CI <call#>',                  'Select / show call info'],
      ['AS',  'AS <unit> <call#>',           'Assign unit to call'],
      ['ST',  'ST <unit> <status>',          'Change unit status'],
      ['CL',  'CL <call#> [disposition]',    'Clear call with disposition'],
      ['HD',  'HD <call#> [minutes]',        'Hold call for N minutes'],
      ['NT',  'NT <call#> <note>',           'Append note to call'],
      ['PRI', 'PRI <call#> <P1..P4>',        'Change priority'],
      ['US',  'US <unit> <status>',          'Update unit status'],
      ['BO',  'BO <description>',            'Broadcast BOLO'],
      ['ML',  'ML <unit> <start|end> <mi>',  'Log mileage'],
      ['FI',  'FI <person_name>',            'Start Field Interview'],
      ['LE',  'LE <code>',                   '10-code lookup'],
    ],
    [2, 5, 6],
  );

  h2(ctx, 'Query / lookup commands');
  table(ctx,
    ['Verb', 'Syntax', 'Purpose'],
    [
      ['QP',  'QP <name>',       'Query person records'],
      ['QH',  'QH <name>',       'Query person history (alias of QP)'],
      ['QV',  'QV <VIN or tag>', 'Query vehicle'],
      ['QW',  'QW <name>',       'Query warrants'],
      ['QB',  'QB <beat>',       'Query beat / zone'],
      ['QT',  'QT <tag>',        'Query plate (traffic stop)'],
      ['PR',  'PR <address>',    'Premise alerts for address'],
      ['PI',  'PI <property>',   'Property info'],
      ['DU',  'DU <unit>',       'Duty / shift info for unit'],
    ],
    [2, 5, 6],
  );

  h2(ctx, 'Status / informational');
  table(ctx,
    ['Verb', 'Purpose'],
    [
      ['STATUS',  'Show current dispatcher workstation status'],
      ['CHECK',   'Call count + unit metrics overview'],
      ['ETA',     'Estimated time of arrival for assigned unit'],
      ['WEATHER', 'Current weather for the zone'],
      ['TIME',    'System time (Mountain Time)'],
      ['ACK',     'Acknowledge (= 10-4)'],
    ],
    [2, 6],
  );

  calloutBox(ctx, 'Tip',
    'Case does not matter — "nc domestic 123 main" works identically to "NC DOMESTIC 123 MAIN". Use TAB to cycle autocomplete suggestions.',
  );
}

function section7(ctx: GuideContext): void {
  title(ctx, '7. Voice Features (Dispatcher Brain)');

  paragraph(ctx,
    'RMPG Flex includes an optional Dispatcher Brain that speaks alerts, coaching, and event notifications through a neural voice. Every feature below is off by default — enable them individually in User Profile → Voice.',
  );

  h2(ctx, 'Voice persona (always available)');
  bullet(ctx, 'Four curated voices: Female Calm (Jenny), Female Crisp (Aria), Male Baritone (Guy), Male Tactical (Davis).');
  bullet(ctx, 'Rate slider (0.7–1.4x) and pitch (-20 to +20) let you tune to taste.');
  bullet(ctx, 'Terseness mode changes how much the system says: Narrative (full prose), Standard (CAD shorthand), Terse (minimum).');
  bullet(ctx, 'Preview button speaks a sample line with your current settings.');

  h2(ctx, 'Transcript drawer');
  bullet(ctx, 'Press T anywhere in the app to toggle a side drawer listing every spoken line.');
  bullet(ctx, 'Severity is color-coded: red = major, amber = moderate, green = minor.');
  bullet(ctx, 'Hidden ARIA live regions mirror announcements for screen readers.');
  bullet(ctx, 'Useful for shift review — scroll back to see what was announced during a busy stretch.');

  h2(ctx, 'Dispatcher Brain (opt-in)');
  paragraph(ctx,
    'Once you toggle "Dispatcher Brain (Beta)" on in the Voice tab, the system begins speaking proactively in six categories:',
  );
  bullet(ctx, 'Event notices — citations issued, incidents opened, warrants entered, evidence logged, arrests booked, HR leave approved.');
  bullet(ctx, 'Approach warnings — DV flag on call triggers "approach with caution" before you arrive.');
  bullet(ctx, 'Backup suggestions — felony calls with fewer than two units prompt "recommend second unit".');
  bullet(ctx, 'Mental-health protocol — MH crisis calls cue CIT + non-lethal staging reminder.');
  bullet(ctx, 'Overdue status check — 8+ minutes on scene with no status update prompts a welfare check.');
  bullet(ctx, 'Geofence breach — unit leaving its assigned beat broadcasts an advisory.');

  h2(ctx, 'Conversational queries');
  paragraph(ctx,
    'With the brain enabled and voice channel active (press V to open the mic manually), you can ask:',
  );
  bullet(ctx, '"Tell me more about that call" — speaks narrative of the last-mentioned call.');
  bullet(ctx, '"Who is assigned to call CN-26-0457?" — speaks the assigned unit(s).');
  bullet(ctx, '"Run him" / "run that plate" — pronouns resolve from conversation context.');
  bullet(ctx, 'If "that call" is ambiguous (no prior context), the brain responds "Which call did you mean?"');

  calloutBox(ctx, 'Rollback',
    'If brain output ever becomes distracting on a live shift, turn it off in your Voice settings — the change takes effect on next page load. Admin can force it off globally by clearing voice_brain_enabled in the users table.',
  );
}

function section8(ctx: GuideContext): void {
  title(ctx, '8. Common Workflows');

  h3(ctx, 'Receiving a 911 transfer');
  bullet(ctx, 'Open new call (F2).');
  bullet(ctx, 'Paste caller info from the 911 transfer. Verify phone callback number.');
  bullet(ctx, 'Set priority based on reported facts (P1 for in-progress violence).');
  bullet(ctx, 'Save → dispatch nearest available unit (F3).');
  bullet(ctx, 'Stay on the line with caller; append notes continuously until unit is on-scene.');

  h3(ctx, 'Multi-unit / multi-agency response');
  bullet(ctx, 'Dispatch primary unit first.');
  bullet(ctx, 'Use AS <unit> <call#> to add each additional unit.');
  bullet(ctx, 'For mutual-aid responders (SLCPD, UHP), create a note rather than adding them as units.');
  bullet(ctx, 'Broadcast BOLO (BO command) if suspect is fleeing.');

  h3(ctx, 'Pursuit');
  bullet(ctx, 'Set pursuit flag on the call — triggers pursuit protocol banner on every workstation.');
  bullet(ctx, 'Track direction + speed updates in notes.');
  bullet(ctx, 'Supervisor may terminate pursuit; document termination reason.');

  h3(ctx, 'Welfare check on overdue unit');
  bullet(ctx, 'Brain speaks overdue-status warning at 8 minutes.');
  bullet(ctx, 'Radio the unit on their channel.');
  bullet(ctx, 'No response within 2 minutes → escalate to supervisor.');
  bullet(ctx, 'Log every check attempt as a note on the call.');

  h3(ctx, 'Shift handoff');
  bullet(ctx, 'Review each active call with the incoming dispatcher.');
  bullet(ctx, 'Use the Shift Handoff Notes field (F8 → HANDOFF command) for asynchronous handoffs.');
  bullet(ctx, 'Verify every on-scene unit has an entry timestamp so the incoming dispatcher knows the clock.');
}

function section9(ctx: GuideContext): void {
  title(ctx, '9. Troubleshooting');

  h3(ctx, 'WebSocket disconnected');
  paragraph(ctx,
    'Status bar shows red "DISCONNECTED". Auto-reconnect runs every 3s up to 50 retries. If it does not recover, use Help → System Status → Reconnect, or reload the page. Your work is not lost — server is the source of truth.',
  );

  h3(ctx, 'GPS not updating');
  paragraph(ctx,
    'Check unit\'s device has GPS permission granted. Desktop workstations use WiFi geolocation which is less accurate than phone GPS. The server prefers higher-priority sources — a desktop sample will not overwrite a recent mobile sample.',
  );

  h3(ctx, 'Voice not working');
  bullet(ctx, 'Confirm master sound toggle (speaker icon in the status bar).');
  bullet(ctx, 'Confirm voice-alerts toggle in User Profile → Voice.');
  bullet(ctx, 'If Edge TTS is unreachable, the system falls back to browser SpeechSynthesis automatically.');
  bullet(ctx, 'Test with the Preview button — if that silent, check system audio output.');

  h3(ctx, 'Call missing from list');
  bullet(ctx, 'Check filter chips (pending / active / archived) at top of call list.');
  bullet(ctx, 'Use CI <call#> to jump directly — bypasses filters.');
  bullet(ctx, 'If truly missing, Admin → Audit Log will show deletion record.');

  h3(ctx, 'Wrong disposition saved');
  paragraph(ctx,
    'Dispositions cannot be edited after clear, by design. Open the archived call, add a correction note, and flag for supervisor review.',
  );

  calloutBox(ctx, 'Emergency Contact',
    'Production issues during a shift: page the on-call admin. System lockups: Ctrl+Shift+R to hard reload. If the app is unreachable, fall back to radio + paper logs and resync from dispatch recordings when service returns.',
    'warn',
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

  // Sections 1–9 — each starts on a fresh page for readability
  newPage(ctx);    section1(ctx);
  newPage(ctx);    section2(ctx);
  newPage(ctx);    section3(ctx);
  newPage(ctx);    section4(ctx);
  newPage(ctx);    section5(ctx);
  newPage(ctx);    section6(ctx);
  newPage(ctx);    section7(ctx);
  newPage(ctx);    section8(ctx);
  newPage(ctx);    section9(ctx);

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
