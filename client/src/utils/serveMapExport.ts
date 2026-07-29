import { jsPDF } from 'jspdf';

export interface QueueMapItemForExport {
  id: number;
  recipient_name: string | null;
  recipient_address: string | null;
  priority: string;
  deadline: string | null;
}

export async function exportServeMapSheet(items: QueueMapItemForExport[]): Promise<void> {
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Process Server Route Sheet', 14, 18);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  let y = 30;
  for (const item of items) {
    if (y > 280) {
      doc.addPage();
      y = 20;
    }
    const line = `${(item.priority || 'routine').toUpperCase()} — ${item.recipient_name || '(no name)'} — ${item.recipient_address || '(no address)'}${item.deadline ? ` — due ${item.deadline}` : ''}`;
    doc.text(line, 14, y);
    y += 7;
  }
  if (items.length === 0) {
    doc.text('No jobs match the current filter.', 14, y);
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  doc.save(`serve-route-sheet-${dateStr}.pdf`);
}
