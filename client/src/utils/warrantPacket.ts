import { jsPDF } from 'jspdf';
import { renderWarrantIntoDoc, type WarrantPdfData } from './recordPdfGenerator';
import { apiFetch } from '../hooks/useApi';

export async function buildWarrantPacketPdf(
  warrantIds: number[],
  currentUser?: { full_name?: string; badge_number?: string }
): Promise<void> {
  const doc = new jsPDF();
  let first = true;
  for (const id of warrantIds) {
    const res = await apiFetch<any>(`/warrants/${id}`);
    const raw = (res && typeof res === 'object' && 'data' in res ? res.data : res) || {};
    const data: WarrantPdfData = {
      ...raw,
      printed_by_name: currentUser?.full_name,
      printed_by_badge: currentUser?.badge_number,
      printed_at: new Date().toISOString(),
    };
    if (!first) doc.addPage();
    first = false;
    await renderWarrantIntoDoc(doc, data);
  }
  doc.save(`warrant-packet-${new Date().toISOString().slice(0, 10)}.pdf`);
}
