import { apiPostForm } from '../hooks/useApi';
import type jsPDF from 'jspdf';
import { inferServeFileKind } from './serveAttemptFileMeta';

interface SaveServePdfOptions {
  queueId: number;
  attemptId: number;
  pdf: jsPDF;
  filename: string;
  title: string;
  documentType: 'notice' | 'affidavit' | 'posted_notice' | 'other';
  description?: string;
}

/**
 * Automatically saves a generated process server PDF (NOA, AOS, etc.)
 * directly to the job's Subject File attempt folder in the background.
 * Non-blocking / best-effort so the user flow is uninterrupted.
 */
export async function autoSaveServePdfToSubjectFile(options: SaveServePdfOptions): Promise<void> {
  const { queueId, attemptId, pdf, filename, title, documentType, description } = options;
  if (!queueId || !attemptId) {
    console.warn('[autoSaveServePdf] Missing queueId or attemptId, skipping auto-save:', { queueId, attemptId });
    return;
  }

  try {
    const blob = pdf.output('blob');
    const file = new File([blob], filename, { type: 'application/pdf' });
    const fd = new FormData();
    fd.append('files', file);
    fd.append('title', title);
    if (description) fd.append('description', description);
    fd.append('document_type', documentType);
    fd.append('copies', '1');
    fd.append('kind', inferServeFileKind(file.type, file.name));

    await apiPostForm(`/process-server/${queueId}/attempts/${attemptId}/files`, fd);
    console.info(`[autoSaveServePdf] Successfully saved ${filename} to attempt #${attemptId} folder.`);
  } catch (err) {
    // Best-effort: log error without interrupting the user's workflow
    console.error('[autoSaveServePdf] Failed to auto-save PDF to Subject File:', err);
  }
}
