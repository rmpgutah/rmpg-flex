// ============================================================
// RMPG Flex — Affidavit of Service PDF generator
// Utah URCP 4(f) compliant template. Triggered when all attempts
// on a serve_queue row are marked complete. Writes PDF to
// uploads/serve-intake/{call_number}/ and inserts a
// call_attachments row with doc_type='affidavit'.
// ============================================================

import { jsPDF } from 'jspdf';
import { writeFileSync, mkdirSync } from 'fs';
import { join, resolve as pathResolve } from 'path';
import { getDb } from '../models/database';

export interface AffidavitInput {
  queueId: number;
  callId: number;
  caseId: number;
  callNumber: string;
  defendantName: string;
  defendantAddress: string;
  plaintiffName: string;
  courtName: string;
  courtCaseNumber: string;
  clientJobNumber: string;
  officerName: string;
  officerBadge: string;
  attempts: Array<{
    attempt_number: number;
    attempt_at: string;
    result: string;
    notes?: string;
    latitude?: number;
    longitude?: number;
  }>;
  finalResult: 'served' | 'non-serve' | 'returned';
}

export interface AffidavitOutput {
  filePath: string;
  attachmentId: number;
}

const UPLOAD_ROOT = process.env.RMPG_UPLOADS_DIR || pathResolve(process.cwd(), 'uploads');

export async function generateAffidavit(input: AffidavitInput): Promise<AffidavitOutput> {
  const db = getDb();
  const doc = new jsPDF();
  const left = 15;
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 20;

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('AFFIDAVIT OF SERVICE', pageWidth / 2, y, { align: 'center' });
  y += 10;

  // Case caption
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Case: ${input.plaintiffName} v. ${input.defendantName}`, left, y); y += 5;
  doc.text(`Court: ${input.courtName || 'N/A'}`, left, y); y += 5;
  doc.text(`Case No.: ${input.courtCaseNumber || input.clientJobNumber || 'N/A'}`, left, y); y += 10;

  // Affidavit body
  doc.text('STATE OF UTAH, COUNTY OF SALT LAKE', left, y); y += 5;
  const introLine = `I, ${input.officerName} (Badge ${input.officerBadge || 'N/A'}), being duly sworn, depose and say:`;
  doc.text(introLine, left, y); y += 8;

  // Attempts
  doc.setFont('helvetica', 'bold');
  doc.text('Service Attempts:', left, y); y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  for (const a of input.attempts) {
    const line = `${a.attempt_number}. ${a.attempt_at || ''} — ${a.result || ''}${a.notes ? ': ' + a.notes : ''}`;
    const wrapped = doc.splitTextToSize(line, pageWidth - left * 2 - 5);
    for (const w of wrapped) {
      doc.text(w, left + 5, y);
      y += 5;
    }
  }
  y += 5;

  // Final result
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`Final Result: ${input.finalResult.toUpperCase()}`, left, y); y += 8;

  // Defendant + address
  doc.setFont('helvetica', 'normal');
  doc.text(`Defendant: ${input.defendantName}`, left, y); y += 5;
  const addrLines = doc.splitTextToSize(`Address served at: ${input.defendantAddress || 'N/A'}`, pageWidth - left * 2);
  for (const w of addrLines) { doc.text(w, left, y); y += 5; }
  y += 10;

  // Signature block
  doc.text('_________________________________', left, y); y += 4;
  doc.text(`${input.officerName} (Badge ${input.officerBadge || 'N/A'})`, left, y); y += 8;
  doc.text('Subscribed and sworn before me this ____ day of __________, 20___.', left, y); y += 10;
  doc.text('_________________________________', left, y); y += 4;
  doc.text('Notary Public', left, y);

  // Save file to uploads/serve-intake/{call_number}/
  const safeCallNumber = String(input.callNumber).replace(/[^A-Za-z0-9_-]/g, '_');
  const dir = join(UPLOAD_ROOT, 'serve-intake', safeCallNumber);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'affidavit-of-service.pdf');
  const buf = Buffer.from(doc.output('arraybuffer'));
  writeFileSync(filePath, buf);

  // Relative path for DB (consistent with existing call_attachments rows)
  const relativePath = `serve-intake/${safeCallNumber}/affidavit-of-service.pdf`;

  const result = db.prepare(`
    INSERT INTO call_attachments (call_id, case_id, filename, relative_path, doc_type, mime_type, byte_size, created_at)
    VALUES (?, ?, ?, ?, 'affidavit', 'application/pdf', ?, datetime('now','localtime'))
  `).run(input.callId, input.caseId, 'affidavit-of-service.pdf', relativePath, buf.length);

  return { filePath, attachmentId: Number(result.lastInsertRowid) };
}
