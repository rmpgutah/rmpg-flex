// ═══════════════════════════════════════════════════════════════
// Intelligence Product — sanitized PDF (Intel v2 Wave 1).
// Arial-only (registerArialFont — project rule). NEVER renders the
// raw_narrative or source identity. Handling-code stamped header/footer.
// ═══════════════════════════════════════════════════════════════
import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import { drawNavyBanner } from './pdfStandaloneHeader';

export interface IntelProductData {
  report_number: string;
  title: string;
  grade_label: string;
  handling_code: string;
  threat_level: string;
  sanitized_narrative: string;
  assessment: string;
  disseminated_at: string | null;
  links: Array<{ entity_type: string; entity_id: number; role: string }>;
}

const GOLD = '#d4a017';
const SENTINELS = new Set(['', 'none', 'n/a', 'na', 'null', 'unknown']);
const real = (v: unknown) => v != null && !SENTINELS.has(String(v).trim().toLowerCase());
const show = (v: unknown) => (real(v) ? String(v) : '—');

const HANDLING: Record<string, string> = {
  H1: 'H1 — RMPG INTERNAL ONLY',
  H2: 'H2 — LAW ENFORCEMENT, NEED-TO-KNOW',
  H3: 'H3 — PARTNER/CLIENT, SANITIZED',
  H4: 'H4 — CONDITIONS APPLY — REFER TO ORIGINATOR',
  H5: 'H5 — NO FURTHER DISSEMINATION',
};

export function generateIntelProductPdf(d: IntelProductData): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  registerArialFont(doc);
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  const handling = HANDLING[d.handling_code] || d.handling_code || 'UNCLASSIFIED';

  const stamp = () => {
    drawNavyBanner(doc, {
      title: 'INTELLIGENCE PRODUCT',
      subtitle: `Grade: ${show(d.grade_label)}  ·  Threat: ${show(d.threat_level).toUpperCase()}`,
      rightLine1: `Disseminated: ${show(d.disseminated_at)}`,
      rightLine2: handling,
      y: 8,
      marginPt: 0,
    });
    doc.setFillColor(GOLD); doc.rect(0, H - 22, W, 22, 'F');
    doc.setTextColor('#000000'); doc.setFont('Arial', 'bold'); doc.setFontSize(9);
    doc.text(handling, W / 2, H - 8, { align: 'center' });
  };
  stamp();

  let y = 62;
  doc.setFontSize(11); doc.setFont('Arial', 'normal'); doc.setTextColor('#000000');
  doc.text(`${show(d.report_number)} — ${show(d.title)}`, M, y); y += 24;

  const block = (heading: string, text: string) => {
    if (y > H - 80) { doc.addPage(); stamp(); y = 62; }
    doc.setFont('Arial', 'bold'); doc.setFontSize(11); doc.text(heading, M, y); y += 16;
    doc.setFont('Arial', 'normal'); doc.setFontSize(10);
    for (const line of doc.splitTextToSize(show(text), W - 2 * M) as string[]) {
      if (y > H - 40) { doc.addPage(); stamp(); y = 62; }
      doc.text(line, M, y); y += 14;
    }
    y += 10;
  };
  block('ASSESSMENT', d.assessment);
  block('NARRATIVE (SANITIZED)', d.sanitized_narrative);
  if (d.links?.length) {
    block('LINKED ENTITIES', d.links.map((l) => `${l.entity_type} #${l.entity_id} (${l.role})`).join('\n'));
  }
  doc.save(`${d.report_number || 'intel-product'}.pdf`);
}
