// ============================================================
// Call PDF Autofill — fallback policy for blank fields on the
// Call Record PDF. Returns a SHALLOW MERGE with the original
// CallForService — only fields that are blank get a fallback.
// Original values always win.
// ============================================================

import type { CallForService } from '../../../types';

// PSO/process-service incident types — matches PROCESS_SERVICE_INCIDENT_TYPES
// in constants/dispositionCodes.ts and NewCallModal.tsx's PSO_TYPES (which
// now shows the PSO-requestor form fields for all three types, so this
// fallback must recognize all three too, or a process_service/
// civil_paper_service call that DID get pso_requestor_* filled in on the
// form would never see it flow into caller_name/phone/address on the
// printed record — caught 2026-07-03, same drift as the Serve tab).
const PSO_TYPES = new Set(['pso_client_request', 'process_service', 'civil_paper_service']);

/**
 * Apply autofill fallbacks to a call before it goes to the PDF generator.
 *
 * Called from DispatchPage's <PrintRecordButton recordData={...} /> block.
 * Operates on a copy — never mutates the input call.
 *
 * Policy lives here so it's one place to revise when operators want
 * different behavior. Keep this pure (no fetches, no React state).
 *
 * Do NOT autofill these — they require a real entry, not a guess:
 *   - process_served_to (the defendant's name — wrong fallback = perjury risk)
 *   - process_served_at / process_service_result (only true after the attempt)
 */
export function applyCallPdfAutofill(call: CallForService): CallForService {
  const filled: CallForService = { ...call };
  // Fields not in the strict CallForService type but commonly attached
  // server-side via JOINs (property_address, client_phone, etc.) — read
  // through `any` so this helper can use them as fallback sources.
  const c = call as any;

  // PSO calls: the requestor IS the contracting client (e.g., "ICU Investigations, LLC").
  // If the requestor block was left blank, fall back to the linked client record.
  if (PSO_TYPES.has(filled.incident_type)) {
    if (!filled.pso_requestor_name && filled.client_name) {
      filled.pso_requestor_name = filled.client_name;
    }
    // Requestor phone/email fallbacks from the linked client record (when
    // the client is hydrated server-side via JOIN, those columns ride along
    // on the call response).
    if (!filled.pso_requestor_phone && c.client_phone)  filled.pso_requestor_phone = c.client_phone;
    if (!filled.pso_requestor_email && c.client_email)  filled.pso_requestor_email = c.client_email;

    // Caller block on PSO calls represents the same contracting party.
    if (!filled.caller_name)         filled.caller_name         = filled.pso_requestor_name;
    if (!filled.caller_phone)        filled.caller_phone        = filled.pso_requestor_phone;
    if (!filled.caller_address && c.client_address) {
      filled.caller_address = c.client_address;
    }
    // Default relationship for PSO contracting parties — "Authorized Agent"
    // is the operationally accurate label for a contract-services requestor.
    // We only fill when blank AND a recognized contracting party is present;
    // we never overwrite an explicit relationship the dispatcher entered.
    if (!filled.caller_relationship && (filled.client_name || filled.pso_requestor_name)) {
      filled.caller_relationship = 'Authorized Agent';
    }
  }

  // Process service: service address defaults to the incident address when not
  // explicitly captured. Serve To / Served At / Result are intentionally NOT
  // autofilled — those must reflect a real attempt.
  if (filled.process_service_type && !filled.process_served_address) {
    filled.process_served_address = filled.location;
  }

  // Known truncation: legacy template stored "SERVICE WAS COMPLETED ON" without
  // appending the date. Patch it from process_served_at so the printed sentence
  // is grammatically complete and legally accurate.
  if (
    filled.action_taken &&
    filled.action_taken.trimEnd().toUpperCase().endsWith('SERVICE WAS COMPLETED ON')
  ) {
    const servedAt = (c as any).process_served_at ?? filled.process_served_at;
    if (servedAt) {
      const d = new Date(servedAt);
      const dateStr = d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
      const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      filled.action_taken = filled.action_taken.trimEnd() + ` ${dateStr} AT ${timeStr}.`;
    }
  }

  // PROPERTY field on the printed Call Record: the legacy generator reads
  // `data.property_name` (line 1700 of recordPdfGenerator.ts). When the
  // server JOINs the properties table, both `property_name` AND
  // `property_address` ride along; if `property_name` is blank but the
  // address is set, surface the address as the property label so the
  // PDF doesn't emit "N/A" for a row that clearly has property linkage.
  if (!c.property_name && c.property_address) {
    (filled as any).property_name = c.property_address;
  }

  const snap = filled.weather_snapshot;
  if (snap && !filled.weather_conditions) {
    filled.weather_conditions = snap.scene_category || snap.condition || filled.weather_conditions;
  }

  return filled;
}
