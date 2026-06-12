// ============================================================
// RMPG Flex — Pre-Contact Officer Safety Sheet (PDF)
// ============================================================
// One-page tactical brief assembled from a DL scan: identity, the
// safety-critical flags (warrants, registry, supervision, alerts),
// criminal/contact history, and vehicles. Built for the officer to
// read BEFORE approaching a subject.
//
// Danger conspicuity is the point, so this document intentionally uses
// red for danger banners (standard on real officer-safety bulletins),
// unlike the grayscale record forms. Everything else is grayscale.
// ============================================================

import jsPDF from 'jspdf';

export interface SafetySheetInput {
  ocrResult: Record<string, any> | null;
  leFields: Array<{ tag: string; label: string; value: string }> | null;
  scanAlerts: Array<{ level: string; code: string; message: string }>;
  scanMatches: any[] | null;
  deepSweep: { sources: any[]; profile?: any } | null;
  courtRecords: any[] | null;
  officerName?: string;
}

const RED: [number, number, number] = [200, 30, 30];
const BLACK: [number, number, number] = [0, 0, 0];
const GRAY: [number, number, number] = [90, 90, 90];

function real(v: any): string {
  const s = String(v ?? '').trim();
  return s && !/^(none|n\/a|na|no|0|\[\]|unknown)$/i.test(s) ? s : '';
}

export function generateSafetySheet(input: SafetySheetInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const M = 36;                 // margin
  const CW = W - M * 2;         // content width
  let y = M;

  const o = input.ocrResult || {};
  const prof = input.deepSweep?.profile?.person || null;
  const sources = input.deepSweep?.sources || [];
  const fullName = `${o.last_name || ''}, ${o.first_name || ''} ${o.middle_name || ''}`.replace(/\s+/g, ' ').replace(/^,\s*|,\s*$/g, '').trim() || 'UNKNOWN SUBJECT';

  // ── Build the danger list ──
  const dangers: string[] = [];
  const activeWarrants = (input.scanMatches || []).reduce((n, m) => n + (m.active_warrants || 0), 0);
  if (activeWarrants > 0) dangers.push(`${activeWarrants} ACTIVE WARRANT${activeWarrants > 1 ? 'S' : ''}`);
  if (prof) {
    if (prof.is_sex_offender === 1 || prof.is_sex_offender === true || real(prof.sor_number)) dangers.push('REGISTERED SEX OFFENDER');
    if (real(prof.watchlist_match)) dangers.push(`WATCHLIST: ${prof.watchlist_match}`);
    if (real(prof.gang_affiliation)) dangers.push(`GANG: ${prof.gang_affiliation}`);
    if (real(prof.probation_parole)) dangers.push(`ON SUPERVISION: ${prof.probation_parole}`);
    if (real(prof.caution_flags)) dangers.push(`CAUTION: ${String(prof.caution_flags).replace(/[[\]"]/g, '')}`);
  }
  for (const s of sources) {
    if (s.danger && s.key === 'utah_sor') dangers.push('UTAH SEX OFFENDER REGISTRY HIT');
    if (s.danger && s.key === 'utah_warrants') dangers.push('UTAH STATEWIDE WARRANT');
    if (s.danger && s.key === 'gang_intel') dangers.push('GANG INTELLIGENCE FILE');
    if (s.danger && s.key === 'bolos') dangers.push('ACTIVE BOLO');
  }
  for (const a of input.scanAlerts) if (a.level === 'danger') dangers.push(a.message);
  const uniqDangers = [...new Set(dangers)];

  // ── Header band ──
  doc.setFillColor(...BLACK);
  doc.rect(M, y, CW, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('OFFICER SAFETY — PRE-CONTACT BRIEF', M + 8, y + 20);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  const stamp = new Date().toLocaleString();
  doc.text(`${stamp}${input.officerName ? `  ·  ${input.officerName}` : ''}`, W - M - 8, y + 20, { align: 'right' });
  y += 30;

  // Sub-bar: subject name
  doc.setFillColor(40, 40, 40);
  doc.rect(M, y, CW, 18, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(fullName.toUpperCase(), M + 8, y + 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  const idline = [o.dob && `DOB ${o.dob}`, o.dl_number && `DL ${o.dl_number} ${o.dl_state || ''}`].filter(Boolean).join('   ');
  if (idline) doc.text(idline, W - M - 8, y + 13, { align: 'right' });
  y += 18 + 6;

  // ── Danger banner ──
  if (uniqDangers.length > 0) {
    const lines: string[] = [];
    for (const d of uniqDangers) lines.push(...doc.splitTextToSize(`▲ ${d}`, CW - 16));
    const bh = 16 + lines.length * 11 + 6;
    doc.setFillColor(...RED);
    doc.rect(M, y, CW, bh, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('⚠ HAZARD ALERTS', M + 8, y + 13);
    doc.setFontSize(8.5);
    let ly = y + 26;
    for (const l of lines) { doc.text(l, M + 10, ly); ly += 11; }
    y += bh + 6;
  } else {
    doc.setDrawColor(...GRAY);
    doc.setFillColor(245, 245, 245);
    doc.rect(M, y, CW, 16, 'FD');
    doc.setTextColor(...GRAY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('No hazard flags returned on this scan — verify identity; absence of record is not a guarantee of safety.', M + 8, y + 11);
    y += 16 + 6;
  }

  // ── helper: section ──
  const section = (title: string): void => {
    if (y > 720) { doc.addPage(); y = M; }
    doc.setFillColor(...BLACK);
    doc.rect(M, y, CW, 13, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(title.toUpperCase(), M + 6, y + 9);
    y += 13 + 2;
  };
  const line = (text: string, indent = 0, bold = false): void => {
    if (y > 760) { doc.addPage(); y = M; }
    doc.setTextColor(...BLACK);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(8);
    const wrapped = doc.splitTextToSize(text, CW - 8 - indent);
    for (const w of wrapped) { doc.text(w, M + 4 + indent, y + 7); y += 10; }
  };

  // ── Identity / descriptors ──
  section('Subject Identity & Descriptors');
  const idFields = (input.leFields || []).filter(f => ['NAM', 'DOB', 'SEX', 'RAC', 'HGT', 'WGT', 'EYE', 'HAI', 'OLN', 'OLS', 'OLC', 'EXP', 'ADR', 'CTY', 'STA', 'ZIP'].includes(f.tag));
  if (idFields.length) {
    // two-column grid
    const colW = CW / 2;
    let col = 0;
    let rowY = y;
    for (const f of idFields) {
      const x = M + 4 + col * colW;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...GRAY);
      doc.text(`${f.label}:`, x, rowY + 7);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...BLACK);
      doc.text(String(f.value).slice(0, 40), x + 90, rowY + 7);
      col++;
      if (col === 2) { col = 0; rowY += 11; }
    }
    y = rowY + (col ? 11 : 0) + 4;
  } else {
    line('No structured identity fields decoded.');
  }
  if (prof) {
    const marks = real(prof.scars_marks_tattoos) || real(prof.tattoo_description) || real(prof.distinguishing_features);
    if (marks) line(`Scars/Marks/Tattoos: ${marks}`, 0, false);
    const ids = [real(prof.ncic_number) && `NCIC# ${prof.ncic_number}`, real(prof.fbi_number) && `FBI# ${prof.fbi_number}`, real(prof.aliases) && `AKA: ${prof.aliases}`].filter(Boolean).join('   ');
    if (ids) line(ids);
  }
  y += 4;

  // ── Status alerts (non-danger too) ──
  if (input.scanAlerts.length) {
    section('License & Status Alerts');
    for (const a of input.scanAlerts) line(`• ${a.message}`, 0, a.level === 'danger');
    y += 4;
  }

  // ── Warrants ──
  const warrMatches = (input.scanMatches || []).filter(m => m.active_warrants > 0 || m.total_warrants > 0);
  if (warrMatches.length) {
    section('Warrants');
    for (const m of warrMatches) {
      line(`${m.last_name}, ${m.first_name} (#${m.id}) — ${m.active_warrants || 0} active / ${m.total_warrants || 0} total`, 0, (m.active_warrants || 0) > 0);
    }
    y += 4;
  }

  // ── Deep sweep sources ──
  const sweepWith = sources.filter((s: any) => s.rows?.length);
  if (sweepWith.length) {
    section('Records Sweep');
    for (const s of sweepWith) {
      line(`${s.label} (${s.rows.length})`, 0, !!s.danger);
      for (const r of s.rows.slice(0, 5)) line(`– ${r.summary}`, 10, !!r.danger);
    }
    y += 4;
  }

  // ── Profile histories ──
  if (prof) {
    const p = input.deepSweep?.profile;
    const blocks: Array<[string, any[], (r: any) => string]> = [
      ['Criminal History', p.criminal_history || [], (r) => `${r.offense_date || 'n/d'} — ${r.offense || r.record_type}${r.disposition ? ` · ${r.disposition}` : ''}`],
      ['Incident Reports', p.incidents || [], (r) => `${r.incident_number || ''} ${r.occurred_date || ''} — ${r.incident_type || ''} (${r.role || 'party'})`],
      ['Vehicles', p.vehicles || [], (r) => `${r.plate_number || 'NO PLATE'} ${r.state || ''} — ${[r.year, r.color, r.make, r.model].filter(Boolean).join(' ')}${r.is_stolen ? ' · STOLEN' : ''}`],
    ];
    for (const [title, rows, fmt] of blocks) {
      if (!rows.length) continue;
      section(`${title} (${rows.length})`);
      for (const r of rows.slice(0, 8)) line(`– ${fmt(r)}`, 6);
      y += 4;
    }
  }

  // ── Federal court records ──
  if (input.courtRecords && input.courtRecords.length) {
    section('Federal Court Records (CourtListener / PACER)');
    line('Name match only — verify identity before relying on these.', 0, false);
    for (const r of input.courtRecords.slice(0, 6)) line(`– ${r.is_criminal ? '[CRIMINAL] ' : ''}${r.case_name} · ${r.court} · ${r.date_filed}`, 6, r.is_criminal);
    y += 4;
  }

  // ── Footer on every page ──
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const ph = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...GRAY);
    doc.line(M, ph - 26, W - M, ph - 26);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...GRAY);
    doc.text('RMPG Flex — Pre-Contact Safety Brief. Data is from law-enforcement and open sources; matches may be name-only — VERIFY IDENTITY before acting. Not a substitute for NCIC/UCJIS confirmation.', M, ph - 16, { maxWidth: CW });
    doc.text(`Page ${i} of ${pages}`, W - M, ph - 16, { align: 'right' });
  }

  return doc;
}
