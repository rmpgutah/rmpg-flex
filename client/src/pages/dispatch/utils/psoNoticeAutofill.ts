// ============================================================
// PSO Notice of Communication — autofill mapper
//
// Maps a failed PSO Client Request CFS (the call being re-dispatched
// after an unsuccessful attempt) into the NoticeOfCommunicationData
// the PDF generator needs. Pure — no fetches, no React state.
// Reuses applyCallPdfAutofill so the requestor/client fallbacks are
// identical to the printed Call Record.
// ============================================================

import type { CallForService } from '../../../types';
import { applyCallPdfAutofill } from './callPdfAutofill';
import type {
  NoticeOfCommunicationData,
  NoticeOfCommunicationAttempt,
} from '../../../utils/psoNoticePdfGenerator';

export interface PsoNoticeContext {
  officerName: string;
  officerBadge?: string;
  officerPhone?: string;
  /** Agency dispatch number the client should call to coordinate. */
  dispatchPhone?: string;
  signature?: string;
  /** Call number created by the re-dispatch, if already known. */
  redispatchCallNumber?: string;
  /** Scheduled next attempt window from the re-dispatch. */
  nextWindow?: string;
}

/** Whether a call is a PSO client request eligible for this notice. */
export function isPsoClientRequest(call: Pick<CallForService, 'incident_type'>): boolean {
  return call.incident_type === 'pso_client_request';
}

/** Format an arbitrary pso_service_windows value into a short human string. */
function formatWindow(w: unknown): string | undefined {
  if (!w) return undefined;
  if (typeof w === 'string') return w.trim() || undefined;
  if (Array.isArray(w)) {
    const parts = w.map((x) => (typeof x === 'string' ? x : (x?.label ?? x?.window ?? ''))).filter(Boolean);
    return parts.length ? parts.join(', ') : undefined;
  }
  if (typeof w === 'object') {
    const o = w as Record<string, unknown>;
    const label = (o.label ?? o.window ?? o.preferred) as string | undefined;
    return label && String(label).trim() ? String(label) : undefined;
  }
  return undefined;
}

/** Last human-entered note text on the call (CallNote[] → string). */
function lastNoteText(notes: CallForService['notes']): string {
  if (!Array.isArray(notes) || notes.length === 0) return '';
  const last = notes[notes.length - 1];
  return (last && typeof last.text === 'string') ? last.text : '';
}

/**
 * Derive a client-facing service type. The pso_service_type column is unused in
 * practice (always null), so fall back to the contracting client's industry
 * (e.g. "Process Service") and then to the disposition shape. Avoids the old
 * generic "Protective Services" label, which was wrong for the process-service
 * work these calls actually represent.
 */
function deriveServiceType(industry?: unknown, disposition?: string): string | undefined {
  const ind = typeof industry === 'string' ? industry.trim() : '';
  if (ind && !['', 'other', 'n/a', 'none'].includes(ind.toLowerCase())) return ind;
  const disp = (disposition || '').trim().toLowerCase();
  // "PS Served" / "PS Non-Service" / "PS No Access" … and anything mentioning
  // serve/service all indicate process service.
  if (/^ps\b/.test(disp) || /serv/.test(disp)) return 'Process Service';
  return undefined;
}

/** Split a stored 'YYYY-MM-DD HH:MM:SS' (or ISO) timestamp into date + time. */
function splitStamp(ts?: string): { date: string; time: string } {
  if (!ts) return { date: '', time: '' };
  const norm = ts.replace('T', ' ');
  const date = norm.slice(0, 10);
  const time = norm.slice(11, 16);
  return { date, time };
}

/**
 * Build the Notice of Communication payload from a failed PSO call.
 * `call` is the attempt that did not complete (the one being re-dispatched).
 */
export function buildNoticeOfCommunicationFromCall(
  call: CallForService,
  ctx: PsoNoticeContext,
): NoticeOfCommunicationData {
  const filled = applyCallPdfAutofill(call);
  const c = filled as unknown as Record<string, unknown>;

  // Addressee = the contracting CLIENT record (authoritative), then the
  // requestor block, then the call-level caller (which is sometimes an
  // individual contact rather than the company). Phone/address likewise prefer
  // the client record over the inconsistent call-level caller block.
  const clientName =
    filled.client_name || filled.pso_requestor_name || filled.caller_name || 'Contracting Client';
  const clientContact = (c.client_contact_name as string | undefined) || undefined;
  const clientPhone =
    (c.client_phone as string | undefined) || filled.pso_requestor_phone || filled.caller_phone || undefined;
  const clientAddress =
    (c.client_address as string | undefined) || filled.caller_address || undefined;

  // The failed call IS the unsuccessful attempt. Represent it as one row.
  const stamp = splitStamp(filled.cleared_at || filled.closed_at || filled.created_at);
  const attempt: NoticeOfCommunicationAttempt = {
    number: filled.pso_attempt_number || 1,
    date: stamp.date,
    time: stamp.time,
    result: filled.disposition || 'no_contact',
    notes: filled.action_taken || lastNoteText(filled.notes) || '',
  };

  const noticeDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return {
    noticeDate,
    callNumber: filled.call_number || '',
    clientName,
    clientContact,
    clientAddress,
    clientPhone,
    serviceType: filled.pso_service_type
      || deriveServiceType(c.client_industry, filled.disposition)
      || 'Client-Requested Service',
    serviceAddress: filled.location || clientAddress || 'Address on file',
    requestedWindow: formatWindow(filled.pso_service_windows),
    authorization: filled.pso_authorization || undefined,
    billingCode: filled.pso_billing_code || undefined,
    attempts: [attempt],
    redispatchCallNumber: ctx.redispatchCallNumber,
    nextWindow: ctx.nextWindow,
    officerName: ctx.officerName,
    officerBadge: ctx.officerBadge || '',
    officerPhone: ctx.officerPhone,
    dispatchPhone: ctx.dispatchPhone,
    signature: ctx.signature,
  };
}

/**
 * Build + render + open the Notice of Communication for a failed PSO call.
 * Lazy-imports the generator so jsPDF stays out of the dispatch bundle.
 * Opens the REAL PDF bytes in a new tab (openPdfDocument) — the old
 * dataurlnewwindow path opened an HTML wrapper around a session-bound blob
 * URL, and anything saved from that wrapper was a ~240-byte HTML shell that
 * rendered as a blank page in every PDF viewer (the
 * "Notice-of-Communication-CFS26-00055.pdf is blank" incident).
 * Throws on failure so callers can toast.
 */
export async function openNoticeOfCommunication(call: CallForService, ctx: PsoNoticeContext): Promise<void> {
  const data = buildNoticeOfCommunicationFromCall(call, ctx);
  const { generateNoticeOfCommunication } = await import('../../../utils/psoNoticePdfGenerator');
  const doc = await generateNoticeOfCommunication(data);
  const { openPdfDocument } = await import('../../../utils/openPdfDocument');
  openPdfDocument(doc, `Notice-of-Communication-${data.callNumber || 'PSO'}.pdf`);
}
