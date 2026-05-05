// ============================================================
// Call PDF Autofill — fallback policy for blank fields on the
// Call Record PDF. Returns a SHALLOW MERGE with the original
// CallForService — only fields that are blank get a fallback.
// Original values always win.
// ============================================================

import type { CallForService } from '../../../types';

/**
 * Apply autofill fallbacks to a call before it goes to the PDF generator.
 *
 * Called from DispatchPage's <PrintRecordButton recordData={...} /> block.
 * Operates on a copy — never mutates the input call.
 *
 * Policy lives here so it's one place to revise when operators want
 * different behavior. Keep this pure (no fetches, no React state).
 *
 * TODO(operator): implement the fallback rules. Suggested starting point:
 *   - For PSO calls: if caller_* are blank, fall back to pso_requestor_*
 *   - For Process Service: if process_served_address is blank, fall back to location
 *   - Anywhere else where a blank field has a sensible derived value
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
  if (filled.incident_type === 'pso_client_request') {
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

  // PROPERTY field on the printed Call Record: the legacy generator reads
  // `data.property_name` (line 1700 of recordPdfGenerator.ts). When the
  // server JOINs the properties table, both `property_name` AND
  // `property_address` ride along; if `property_name` is blank but the
  // address is set, surface the address as the property label so the
  // PDF doesn't emit "N/A" for a row that clearly has property linkage.
  if (!c.property_name && c.property_address) {
    (filled as any).property_name = c.property_address;
  }

  return filled;
}
