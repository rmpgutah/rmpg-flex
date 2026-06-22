// ============================================================
// PSO Notice of Communication — autofill mapper
//
// Maps a failed PSO Client Request CFS (the call being re-dispatched
// after an unsuccessful attempt) into the NoticeOfCommunicationData
// the PDF generator needs. The notice is RESPONDENT-facing (handed to
// or posted for the person being served), so the mapper also surfaces
// the respondent name / court case / document type. Those live on the
// linked serve_queue job, not the call — buildNoticeOfCommunicationFromCall
// stays pure (no fetches) and accepts them as an optional third arg;
// openNoticeOfCommunication does the best-effort lookup.
// Reuses applyCallPdfAutofill so the requestor/client fallbacks are
// identical to the printed Call Record.
// ============================================================

import type { CallForService } from '../../../types';
import { applyCallPdfAutofill } from './callPdfAutofill';
import { importWithRetry } from '../../../utils/importWithRetry';
import type {
  NoticeOfCommunicationData,
  NoticeOfCommunicationAttempt,
} from '../../../utils/psoNoticePdfGenerator';

export interface PsoNoticeContext {
  officerName: string;
  officerBadge?: string;
  officerPhone?: string;
  /** Agency dispatch number the respondent should call to coordinate receipt. */
  dispatchPhone?: string;
  signature?: string;
  /** Call number created by the re-dispatch, if already known (internal — not printed). */
  redispatchCallNumber?: string;
  /** Scheduled next attempt window from the re-dispatch. */
  nextWindow?: string;
}

/** Respondent / legal-matter fields pulled from the linked serve_queue job. */
export interface ServeJobInfo {
  respondentName?: string;
  /** Raw document_type from the queue (e.g. "summons", "subpoena"). */
  documentType?: string;
  courtCaseNumber?: string;
  courtName?: string;
}

/** Whether a call is a PSO client request eligible for this notice. */
export function isPsoClientRequest(call: Pick<CallForService, 'incident_type'>): boolean {
  return call.incident_type === 'pso_client_request';
}

/** Last human-entered note text on the call (CallNote[] → string). */
function lastNoteText(notes: CallForService['notes']): string {
  if (!Array.isArray(notes) || notes.length === 0) return '';
  const last = notes[notes.length - 1];
  return (last && typeof last.text === 'string') ? last.text : '';
}

/**
 * Derive the documents label shown to the respondent. Prefer the serve job's
 * document_type ("summons" → "Summons Service"); the pso_service_type column
 * is unused in practice (always null), so fall back to the contracting
 * client's industry (e.g. "Process Service") and then the disposition shape.
 */
function deriveServiceType(
  docType?: string,
  industry?: unknown,
  disposition?: string,
): string | undefined {
  const dt = (docType || '').trim();
  if (dt) {
    const base = dt.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    return /serv/i.test(base) ? base : `${base} Service`;
  }
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
 * Best-effort lookup of the serve_queue job linked to a call — the
 * respondent name, document type, and court case live there, not on the
 * CFS row (process_served_to is null in practice). Returns null on any
 * failure; the notice degrades to "Occupant / Respondent" wording.
 */
export async function fetchServeJobForCall(callId: string | number): Promise<ServeJobInfo | null> {
  try {
    const { apiFetch } = await importWithRetry(() => import('../../../hooks/useApi'));
    const rows = await apiFetch<any[]>('/process-server?limit=500');
    const list = Array.isArray(rows) ? rows : [];
    const row = list.find((r) => r && r.call_id != null && String(r.call_id) === String(callId));
    if (!row) return null;
    return {
      respondentName: row.recipient_name || row.defendant_name || undefined,
      documentType: row.document_type || undefined,
      courtCaseNumber: row.case_number || undefined,
      courtName: row.court_name || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Build the Notice of Communication payload from a failed PSO call.
 * `call` is the attempt that did not complete (the one being re-dispatched).
 * `serveJob` (optional) supplies the respondent/legal-matter fields from the
 * linked serve_queue row — see fetchServeJobForCall.
 */
export function buildNoticeOfCommunicationFromCall(
  call: CallForService,
  ctx: PsoNoticeContext,
  serveJob?: ServeJobInfo | null,
): NoticeOfCommunicationData {
  const filled = applyCallPdfAutofill(call);
  const c = filled as unknown as Record<string, unknown>;

  // Contracting client — printed only as a one-line "requested by" reference
  // on the respondent copy. Client record (authoritative), then the requestor
  // block, then the call-level caller.
  const clientName =
    filled.client_name || filled.pso_requestor_name || filled.caller_name || 'Contracting Client';
  const clientContact = (c.client_contact_name as string | undefined) || undefined;
  const clientPhone =
    (c.client_phone as string | undefined) || filled.pso_requestor_phone || filled.caller_phone || undefined;
  const clientAddress =
    (c.client_address as string | undefined) || filled.caller_address || undefined;

  // The respondent — serve job is authoritative; process_served_to is the
  // only call-level fallback (usually null in practice).
  const respondentName = serveJob?.respondentName || filled.process_served_to || undefined;

  // The failed call IS the unsuccessful attempt. The TIME OF ARRIVAL on
  // the notice should reflect when the officer actually arrived on scene
  // (onscene_at), not when the dispatcher cleared the call (cleared_at).
  // Falls back through the lifecycle stamps so a call closed without an
  // onscene transition still gets a meaningful timestamp.
  const filledAny = filled as Record<string, any>;
  const stamp = splitStamp(
    filledAny.onscene_at
    || filledAny.enroute_at
    || filled.cleared_at
    || filled.closed_at
    || filled.created_at,
  );
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
    respondentName,
    // Prefer the linked serve job's case/court (the serve queue is the
    // authoritative system of record for legal-matter detail), but FALL
    // BACK to the call's own case_number / court_name (now an ext column
    // per mig 0145) so dispatch operators can capture the court even
    // before a serve_queue row exists.
    courtCaseNumber: serveJob?.courtCaseNumber || filled.case_number || undefined,
    courtName: serveJob?.courtName || (filledAny.court_name as string | undefined) || undefined,
    clientName,
    clientContact,
    clientAddress,
    clientPhone,
    serviceType: filled.pso_service_type
      || deriveServiceType(serveJob?.documentType, c.client_industry, filled.disposition)
      || 'Legal Documents',
    serviceAddress: filled.location || filled.process_served_address || 'Address on file',
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
 * Looks up the linked serve_queue job first (best-effort) so the notice is
 * addressed to the respondent by name with the court case reference.
 * Lazy-imports the generator so jsPDF stays out of the dispatch bundle.
 * Opens the REAL PDF bytes in a new tab (openPdfDocument) — the old
 * dataurlnewwindow path opened an HTML wrapper around a session-bound blob
 * URL, and anything saved from that wrapper was a ~240-byte HTML shell that
 * rendered as a blank page in every PDF viewer (the
 * "Notice-of-Communication-CFS26-00055.pdf is blank" incident).
 * Throws on failure so callers can toast.
 */
export async function openNoticeOfCommunication(call: CallForService, ctx: PsoNoticeContext): Promise<void> {
  const serveJob = await fetchServeJobForCall(call.id);
  const data = buildNoticeOfCommunicationFromCall(call, ctx, serveJob);
  const { generateNoticeOfCommunication } = await importWithRetry(() => import('../../../utils/psoNoticePdfGenerator'));
  const doc = await generateNoticeOfCommunication(data);
  const { openPdfDocument } = await importWithRetry(() => import('../../../utils/openPdfDocument'));
  openPdfDocument(doc, `Notice-of-Communication-${data.callNumber || 'PSO'}.pdf`);
}
