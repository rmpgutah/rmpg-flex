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

  // PSO calls: the requestor IS the contracting client (e.g., "ICU Investigations, LLC").
  // If the requestor block was left blank, fall back to the linked client record.
  if (filled.incident_type === 'pso_client_request') {
    if (!filled.pso_requestor_name && filled.client_name) {
      filled.pso_requestor_name = filled.client_name;
    }
    // Caller block on PSO calls represents the same contracting party.
    if (!filled.caller_name)  filled.caller_name  = filled.pso_requestor_name;
    if (!filled.caller_phone) filled.caller_phone = filled.pso_requestor_phone;
  }

  // Process service: service address defaults to the incident address when not
  // explicitly captured. Serve To / Served At / Result are intentionally NOT
  // autofilled — those must reflect a real attempt.
  if (filled.process_service_type && !filled.process_served_address) {
    filled.process_served_address = filled.location;
  }

  return filled;
}
