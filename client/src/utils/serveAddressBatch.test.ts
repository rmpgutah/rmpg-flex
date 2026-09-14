import { describe, it, expect } from 'vitest';
import { addressBatchKey, groupByAddress } from './serveAddressBatch';
import type { ServeJob } from '../types';

function job(overrides: Partial<ServeJob>): ServeJob {
  return {
    id: 1,
    sm_job_id: null,
    officer_id: 1,
    serve_date: '2026-09-13',
    recipient_name: 'Test',
    recipient_address: null,
    recipient_city: null,
    recipient_state: 'UT',
    recipient_zip: null,
    recipient_lat: null,
    recipient_lng: null,
    recipient_phone: null,
    recipient_email: null,
    recipient_dob: null,
    recipient_employer: null,
    recipient_employer_address: null,
    document_type: 'Summons',
    case_number: null,
    court_name: null,
    jurisdiction: null,
    client_name: null,
    attorney_name: null,
    plaintiff_name: null,
    defendant_name: null,
    serve_type: null,
    case_type: null,
    return_date: null,
    co_defendants: null,
    relationship: null,
    serve_fee: null,
    rush_fee: null,
    payment_status: null,
    diligence_required: null,
    mileage_actual: null,
    contact_restrictions: null,
    building_access_notes: null,
    priority: 'routine',
    time_window: 'anytime',
    deadline: null,
    attempt_count: 0,
    max_attempts: 3,
    status: 'pending',
    sort_order: 0,
    service_instructions: null,
    notes: null,
    next_attempt_note: null,
    call_id: null,
    created_at: '2026-09-13T00:00:00Z',
    updated_at: '2026-09-13T00:00:00Z',
    ...overrides,
  } as ServeJob;
}

describe('addressBatchKey', () => {
  it('returns null when address is missing', () => {
    expect(addressBatchKey(job({}))).toBeNull();
  });

  it('normalises case and whitespace', () => {
    const a = job({ id: 1, recipient_address: '123 Main St', recipient_city: 'Salt Lake City' });
    const b = job({ id: 2, recipient_address: '  123 MAIN ST  ', recipient_city: 'salt lake city' });
    expect(addressBatchKey(a)).toBe(addressBatchKey(b));
  });

  it('distinguishes different addresses', () => {
    const a = job({ id: 1, recipient_address: '123 Main St' });
    const b = job({ id: 2, recipient_address: '456 Oak Ave' });
    expect(addressBatchKey(a)).not.toBe(addressBatchKey(b));
  });

  it('includes unit line in the key', () => {
    const a = job({ id: 1, recipient_address: '123 Main St', recipient_address_2: 'Apt 1' });
    const b = job({ id: 2, recipient_address: '123 Main St', recipient_address_2: 'Apt 2' });
    expect(addressBatchKey(a)).not.toBe(addressBatchKey(b));
  });
});

describe('groupByAddress', () => {
  it('returns empty batches and singles for an empty list', () => {
    const { batches, singles } = groupByAddress([]);
    expect(batches).toHaveLength(0);
    expect(singles).toHaveLength(0);
  });

  it('puts jobs with no address in singles', () => {
    const j = job({ id: 1 });
    const { batches, singles } = groupByAddress([j]);
    expect(batches).toHaveLength(0);
    expect(singles).toContain(j);
  });

  it('groups two jobs at the same address into one batch', () => {
    const j1 = job({ id: 1, recipient_address: '123 Main St', recipient_city: 'Provo' });
    const j2 = job({ id: 2, recipient_address: '123 main st', recipient_city: 'provo' });
    const { batches, singles } = groupByAddress([j1, j2]);
    expect(batches).toHaveLength(1);
    expect(batches[0].jobs).toHaveLength(2);
    expect(singles).toHaveLength(0);
  });

  it('keeps unique-address jobs as singles', () => {
    const j1 = job({ id: 1, recipient_address: '123 Main St' });
    const j2 = job({ id: 2, recipient_address: '456 Oak Ave' });
    const { batches, singles } = groupByAddress([j1, j2]);
    expect(batches).toHaveLength(0);
    expect(singles).toHaveLength(2);
  });

  it('handles a mix of batched and single jobs', () => {
    const j1 = job({ id: 1, recipient_address: '123 Main St' });
    const j2 = job({ id: 2, recipient_address: '123 Main St' });
    const j3 = job({ id: 3, recipient_address: '789 Elm St' });
    const j4 = job({ id: 4 }); // no address
    const { batches, singles } = groupByAddress([j1, j2, j3, j4]);
    expect(batches).toHaveLength(1);
    expect(batches[0].jobs.map((j) => j.id)).toEqual([1, 2]);
    expect(singles.map((j) => j.id)).toContain(3);
    expect(singles.map((j) => j.id)).toContain(4);
  });
});
