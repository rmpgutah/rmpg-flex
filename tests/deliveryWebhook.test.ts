import { describe, it, expect } from 'vitest';
import { parseDeliveryWebhookPayload } from '../src/utils/deliveryWebhook';

const VALID_BODY = {
  slot_id: 42,
  case_number: 'CASE-2026-001',
  slot_date: '2026-09-20',
  time_window: '9am-11am',
  name: 'Jane Subject',
  email: 'jane@example.com',
  phone: '555-0100',
  notes: 'Gate code 1234',
  address: '123 Main St, Salt Lake City, UT',
  subject_name: 'Jane Subject',
  status: 'confirmed',
};

describe('parseDeliveryWebhookPayload', () => {
  it('accepts a fully populated valid payload', () => {
    const result = parseDeliveryWebhookPayload(VALID_BODY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual({
        slotId: 42,
        caseNumber: 'CASE-2026-001',
        slotDate: '2026-09-20',
        timeWindow: '9am-11am',
        contactName: 'Jane Subject',
        contactPhone: '555-0100',
        contactEmail: 'jane@example.com',
        notes: 'Gate code 1234',
        address: '123 Main St, Salt Lake City, UT',
        subjectName: 'Jane Subject',
        status: 'confirmed',
      });
    }
  });

  it('accepts a minimal payload, defaulting optional fields to null', () => {
    const result = parseDeliveryWebhookPayload({
      slot_id: 7,
      case_number: 'CASE-2026-002',
      slot_date: '2026-09-21',
      time_window: '1pm-3pm',
      name: 'John Subject',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.contactPhone).toBeNull();
      expect(result.payload.contactEmail).toBeNull();
      expect(result.payload.notes).toBeNull();
      expect(result.payload.address).toBeNull();
      expect(result.payload.subjectName).toBeNull();
      expect(result.payload.status).toBe('confirmed');
    }
  });

  it.each([
    ['missing slot_id', { case_number: 'C1', slot_date: 'd', time_window: 'w', name: 'n' }],
    ['slot_id as a string', { slot_id: '42', case_number: 'C1', slot_date: 'd', time_window: 'w', name: 'n' }],
    ['missing case_number', { slot_id: 1, slot_date: 'd', time_window: 'w', name: 'n' }],
    ['missing slot_date', { slot_id: 1, case_number: 'C1', time_window: 'w', name: 'n' }],
    ['missing time_window', { slot_id: 1, case_number: 'C1', slot_date: 'd', name: 'n' }],
    ['missing name', { slot_id: 1, case_number: 'C1', slot_date: 'd', time_window: 'w' }],
    ['non-object payload', 'not-an-object'],
    ['null payload', null],
  ])('rejects payload with %s', (_label, body) => {
    const result = parseDeliveryWebhookPayload(body);
    expect(result.ok).toBe(false);
  });
});
