// ═══════════════════════════════════════════════════════════════
// Daily Activity Report — client/court-ready PDF.
// Black & gold RMPG banner, shift/officer header, the auto-compiled
// activity tables (calls / incidents / citations / patrols), the
// officer's narrative + notable events + safety concerns, and a
// signature / review block. Mirrors the navTripPdf / invoice idiom
// (manual layout, registerArialFont, Arial-only per project rule).
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import type { DailyActivityReport } from '../types';
import { drawNavyBanner } from './pdfStandaloneHeader';

const GRAY = '#888888';

// ── Pure helpers (unit-tested) ──────────────────────────────────
export function parseDarArray(json: string | undefined | null): any[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export interface DarCounts { calls: number; incidents: number; citations: number; patrols: number; }
export function darCounts(r: DailyActivityReport): DarCounts {
  return {
    calls: parseDarArray(r.calls_handled).length,
    incidents: parseDarArray(r.incidents_created).length,
    citations: parseDarArray(r.citations_issued).length,
    patrols: parseDarArray(r.patrols_completed).length,
  };
}

type SectionKind = 'calls' | 'incidents' | 'citations' | 'patrols';

function pick(o: any, keys: string[]): string {
  for (const k of keys) if (o && o[k] != null && o[k] !== '') return String(o[k]);
  return '';
}

/** Three-column [id, description, when] rows for a section's items. */
export function darSectionRows(items: any[], kind: SectionKind): string[][] {
  return items.map((it) => {
    switch (kind) {
      case 'calls': return [pick(it, ['call_number', 'number']), pick(it, ['incident_type', 'call_type', 'type']), pick(it, ['created_at', 'received_at'])];
      case 'incidents': return [pick(it, ['incident_number', 'number']), pick(it, ['incident_type', 'type']), pick(it, ['created_at'])];
      case 'citations': return [pick(it, ['citation_number', 'number']), pick(it, ['violation_description', 'violation', 'charge']), pick(it, ['violation_date', 'created_at'])];
      case 'patrols': return [pick(it, ['checkpoint', 'location', 'name']), pick(it, ['status']), pick(it, ['scanned_at', 'created_at'])];
    }
  });
}

// ── PDF rendering ───────────────────────────────────────────────
export function buildDarPdf(r: DailyActivityReport): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  registerArialFont(doc);
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = 0;

  const ensure = (need: number) => {
    if (y + need > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 40; }
  };
  const text = (str: string, x: number, size = 10, color = '#222222', bold = false) => {
    doc.setFont('Arial', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(color);
    doc.text(str, x, y);
  };

  // Header — navy banner
  y = drawNavyBanner(doc, {
    title: `DAILY ACTIVITY REPORT${r.shift_date ? ` — ${r.shift_date}` : r.dar_number ? ` — ${r.dar_number}` : ''}`,
    subtitle: 'Patrol Operations',
    rightLine1: r.dar_number || undefined,
    rightLine2: r.officer_name ? `Officer: ${r.officer_name}` : undefined,
  });
  y += 14;
  doc.setDrawColor(0); doc.setLineWidth(1.2); doc.line(M, y, W - M, y); y += 2;
  doc.setLineWidth(0.4); doc.line(M, y, W - M, y); y += 14;

  // Meta block
  const metaPairs: [string, string][] = [
    ['Officer', r.officer_name || `#${r.officer_id}`],
    ['Shift date', r.shift_date || ''],
    ['Shift', [r.shift_start, r.shift_end].filter(Boolean).join(' – ') || '—'],
    ['Status', (r.status || '').toUpperCase()],
    ['Post / property', r.property_name || r.post_assignment || '—'],
  ];
  for (const [k, v] of metaPairs) {
    ensure(16); text(k.toUpperCase(), M, 8, GRAY, true); text(v, M + 110, 10, '#222222'); y += 16;
  }
  y += 6;

  // Summary line
  const c = darCounts(r);
  ensure(20);
  text(`${c.calls} calls   ·   ${c.incidents} incidents   ·   ${c.citations} citations   ·   ${c.patrols} patrol scans`,
       M, 11, '#000000', true);
  y += 22;

  // Activity tables
  const sections: [string, SectionKind, string, [string, string, string]][] = [
    ['CALLS HANDLED', 'calls', r.calls_handled, ['Call #', 'Type', 'Time']],
    ['INCIDENTS FILED', 'incidents', r.incidents_created, ['Incident #', 'Type', 'Time']],
    ['CITATIONS ISSUED', 'citations', r.citations_issued, ['Citation #', 'Violation', 'Date']],
    ['PATROL SCANS', 'patrols', r.patrols_completed, ['Checkpoint', 'Status', 'Time']],
  ];
  const col = [M, M + 130, W - M - 130];
  for (const [title, kind, json, headers] of sections) {
    const rows = darSectionRows(parseDarArray(json), kind);
    ensure(28);
    text(title, M + 4, 9, '#000000', true); y += 12;
    doc.setDrawColor(0); doc.setLineWidth(0.5); doc.line(M, y - 2, W - M, y - 2);
    text(headers[0], col[0] + 4, 8, GRAY, true); text(headers[1], col[1], 8, GRAY, true); text(headers[2], col[2], 8, GRAY, true);
    y += 12;
    if (rows.length === 0) { text('None recorded.', M + 4, 9, GRAY); y += 14; }
    for (const row of rows) {
      ensure(14);
      text(row[0], col[0] + 4, 9, '#222222');
      text(row[1].slice(0, 48), col[1], 9, '#222222');
      text(row[2].slice(0, 22), col[2], 9, '#222222');
      y += 13;
    }
    y += 8;
  }

  // Narrative blocks
  const blocks: [string, string | undefined][] = [
    ['NOTABLE EVENTS', r.notable_events],
    ['SAFETY CONCERNS', r.safety_concerns],
    ['EQUIPMENT ISSUES', r.equipment_issues],
    ['RECOMMENDATIONS', r.recommendations],
    ['NARRATIVE', r.activities_narrative],
  ];
  for (const [title, body] of blocks) {
    if (!body || !body.trim()) continue;
    ensure(30); text(title, M, 9, '#000000', true); y += 14;
    doc.setFont('Arial', 'normal'); doc.setFontSize(9); doc.setTextColor('#222222');
    for (const line of doc.splitTextToSize(body, W - M * 2) as string[]) {
      ensure(12); doc.text(line, M, y); y += 12;
    }
    y += 8;
  }

  // Signature / review block
  ensure(64); y += 10;
  doc.setDrawColor(GRAY); doc.line(M, y, M + 200, y);
  doc.line(W - M - 200, y, W - M, y); y += 12;
  text('Officer signature' + (r.submitted_at ? ` — submitted ${r.submitted_at}` : ''), M, 8, GRAY);
  text('Reviewed' + (r.reviewed_by_name ? ` by ${r.reviewed_by_name}` : '') + (r.reviewed_at ? ` ${r.reviewed_at}` : ''),
       W - M - 200, 8, GRAY);

  return doc;
}

/** Build the DAR PDF and immediately save it to disk (same filename/behaviour
 *  as before this function was split into a builder + saver). */
export function generateDarPdf(r: DailyActivityReport): void {
  const doc = buildDarPdf(r);
  doc.save(`DAR_${(r.dar_number || r.id).toString().replace(/[^\w-]/g, '_')}.pdf`);
}
