// ============================================================
// RMPG Flex — rmpgutahps.us delivery-scheduler CAD push (piece 1/3)
// ------------------------------------------------------------
// Pure payload validation for POST /api/deliveries/webhook. Kept
// separate from the route (src/routes/deliveriesWebhook.ts) so the
// shape checks are unit-testable without a D1 binding.
//
// Spec: docs/superpowers/specs/2026-09-14-delivery-scheduler-cad-push-design.md
// ============================================================

export interface DeliveryWebhookPayload {
  slotId: number;
  caseNumber: string;
  slotDate: string;
  timeWindow: string;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  notes: string | null;
  address: string | null;
  subjectName: string | null;
  status: string;
}

export type ParseResult =
  | { ok: true; payload: DeliveryWebhookPayload }
  | { ok: false; error: string };

function optionalString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Validates the rmpgutahps.us delivery-confirmation webhook body. Required:
 *  slot_id (number), case_number/slot_date/time_window/name (non-empty strings).
 *  Everything else is optional and defaults to null (status defaults to
 *  'confirmed' since this route is only ever called on the approve action). */
export function parseDeliveryWebhookPayload(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'payload must be an object' };
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.slot_id !== 'number' || !Number.isFinite(obj.slot_id)) {
    return { ok: false, error: 'slot_id is required and must be a number' };
  }
  if (typeof obj.case_number !== 'string' || obj.case_number.length === 0) {
    return { ok: false, error: 'case_number is required' };
  }
  if (typeof obj.slot_date !== 'string' || obj.slot_date.length === 0) {
    return { ok: false, error: 'slot_date is required' };
  }
  if (typeof obj.time_window !== 'string' || obj.time_window.length === 0) {
    return { ok: false, error: 'time_window is required' };
  }
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    return { ok: false, error: 'name is required' };
  }

  return {
    ok: true,
    payload: {
      slotId: obj.slot_id,
      caseNumber: obj.case_number,
      slotDate: obj.slot_date,
      timeWindow: obj.time_window,
      contactName: obj.name,
      contactPhone: optionalString(obj.phone),
      contactEmail: optionalString(obj.email),
      notes: optionalString(obj.notes),
      address: optionalString(obj.address),
      subjectName: optionalString(obj.subject_name),
      status: optionalString(obj.status) ?? 'confirmed',
    },
  };
}
