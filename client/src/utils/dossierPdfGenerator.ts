// ═══════════════════════════════════════════════════════════════
// Person Dossier — PDF export (Palantir Phase 2)
//
// Portrait letter, Arial-only (registerArialFont — project rule),
// black & gold RMPG banner. Sections mirror the /intel/person/:id
// workspace: identity, flags, vehicles, addresses, associates,
// unified timeline. Per-section try/catch so one malformed row can
// never kill the whole export.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import { COLOR } from './pdfTokens';

export interface DossierData {
  person: Record<string, any>;
  cluster: Array<{ person_id: number; name: string }>;
  flags: string[];
  timeline: Array<{ kind: string; id: number; date: string | null; title: string; subtitle: string; status: string }>;
  associates: Array<{ person_id: number; name: string; shared_events: number; kinds: string[] }>;
  vehicles: Array<Record<string, any>>;
  addresses: Array<{ address: string; source: string }>;
}

const GOLD = '#d4a017';
const SENTINELS = new Set(['', 'none', 'n/a', 'na', 'null', '0', 'unknown']);
const real = (v: unknown) => v != null && !SENTINELS.has(String(v).trim().toLowerCase());
const show = (v: unknown) => (real(v) ? String(v) : '—');

export function generateDossierPdf(data: DossierData): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  registerArialFont(doc);
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = 0;
  const p = data.person;
  const name = [p.first_name, p.middle_name, p.last_name].filter(real).join(' ') || `Person #${p.id}`;

  const ensureRoom = (need: number) => {
    if (y + need > doc.internal.pageSize.getHeight() - 50) { doc.addPage(); y = M; }
  };
  const sectionHeader = (label: string) => {
    ensureRoom(30);
    y += 16;
    doc.setFontSize(9); doc.setTextColor(GOLD); doc.setFont('Arial', 'bold');
    doc.text(label, M, y);
    doc.setDrawColor(212, 160, 23); doc.setLineWidth(0.5);
    doc.line(M, y + 3, W - M, y + 3);
    y += 14;
    doc.setFont('Arial', 'normal'); doc.setTextColor(20);
  };
  const row = (text: string, indent = 0, size = 8.5) => {
    ensureRoom(12);
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, W - M * 2 - indent);
    doc.text(lines, M + indent, y);
    y += lines.length * (size + 2.5);
  };

  // Banner — dark grey (matches the report-wide BG_SECTION_HDR header treatment)
  doc.setFillColor(...COLOR.BG_SECTION_HDR); doc.rect(0, 0, W, 64, 'F');
  doc.setTextColor(GOLD); doc.setFontSize(15); doc.setFont('Arial', 'bold');
  doc.text('RMPG FLEX — PERSON DOSSIER', M, 27);
  doc.setFontSize(11); doc.setTextColor(255);
  doc.text(`${name}${real(p.dob) ? `   DOB ${p.dob}` : ''}`, M, 46);
  if (data.flags.length) {
    doc.setFontSize(8); doc.setTextColor(255, 80, 80);
    doc.text(data.flags.join('   '), M, 58);
  }
  y = 84;

  try {
    sectionHeader('IDENTITY');
    row(`Name: ${name}    DOB: ${show(p.dob)}    Gender: ${show(p.gender)}    Race: ${show(p.race)}`);
    row(`Height: ${show(p.height)}    Weight: ${show(p.weight)}    Hair: ${show(p.hair_color)}    Eyes: ${show(p.eye_color)}`);
    row(`DL: ${show(p.dl_number)} (${show(p.dl_state)})    SSN: ${real(p.ssn_last4) ? `***-**-${p.ssn_last4}` : '—'}    Phone: ${show(p.phone)}`);
    if (real(p.alias_nickname)) row(`Aliases: ${p.alias_nickname}`);
    if (real(p.gang_affiliation)) row(`Gang affiliation: ${p.gang_affiliation}`);
    if (real(p.probation_parole)) row(`Probation/parole: ${p.probation_parole}${real(p.probation_parole_officer) ? ` (PO: ${p.probation_parole_officer})` : ''}`);
    if (real(p.scars_marks_tattoos)) row(`Scars/marks/tattoos: ${p.scars_marks_tattoos}`);
    if (data.cluster.length) row(`Linked identities: ${data.cluster.map((m) => `${m.name} (#${m.person_id})`).join(', ')}`);
  } catch { /* section degraded */ }

  try {
    if (data.addresses.length) {
      sectionHeader('ADDRESSES');
      for (const a of data.addresses) row(`${a.address}  —  ${a.source}`);
    }
  } catch { /* section degraded */ }

  try {
    if (data.vehicles.length) {
      sectionHeader('VEHICLES');
      for (const v of data.vehicles)
        row(`${[v.color, v.year, v.make, v.model].filter(real).join(' ')}    Plate: ${show(v.plate_number)}    VIN: ${show(v.vin)}`);
    }
  } catch { /* section degraded */ }

  try {
    if (data.associates.length) {
      sectionHeader('KNOWN ASSOCIATES');
      for (const a of data.associates)
        row(`${a.name} (#${a.person_id})  —  ${a.shared_events} shared event${a.shared_events === 1 ? '' : 's'} (${a.kinds.join(', ')})`);
    }
  } catch { /* section degraded */ }

  try {
    if (data.timeline.length) {
      sectionHeader(`CONTACT TIMELINE (${data.timeline.length})`);
      for (const e of data.timeline.slice(0, 150)) {
        const date = e.date ? String(e.date).slice(0, 10) : '—';
        row(`${date}  [${e.kind.replace(/_/g, ' ').toUpperCase()}]  ${e.title}${e.status ? `  (${e.status})` : ''}${e.subtitle ? `  —  ${e.subtitle}` : ''}`);
      }
      if (data.timeline.length > 150) row(`… ${data.timeline.length - 150} older events omitted`);
    }
  } catch { /* section degraded */ }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7); doc.setTextColor(136);
    doc.text(
      `RMPG Flex Intel — generated ${new Date().toLocaleString('en-US', { timeZone: 'America/Denver' })} — LAW ENFORCEMENT SENSITIVE — page ${i}/${pages}`,
      M, doc.internal.pageSize.getHeight() - 24,
    );
  }

  doc.save(`dossier-${name.replace(/\s+/g, '-').toLowerCase()}-${p.id}.pdf`);
}
