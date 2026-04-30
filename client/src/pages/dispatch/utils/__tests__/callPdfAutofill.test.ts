// Tests for the Call Record PDF autofill policy.
// The helper is pure — it takes a CallForService and returns one with
// blank fields filled in from sensible derived sources. These tests lock
// the policy so changes are visible in code review.

import { describe, it, expect } from 'vitest';
import { applyCallPdfAutofill } from '../callPdfAutofill';
import type { CallForService } from '../../../../types';

const baseCall: CallForService = {
  id: '1',
  call_number: 'C-25-00001',
  incident_type: 'other',
  priority: 'P3',
  status: 'pending',
  location: '5512 SOUTH BASTILLE DRIVE, TAYLORSVILLE, UT 84129',
  description: 'Test',
  source: 'phone',
  assigned_units: [],
  notes: [],
  created_at: '2026-04-30T04:57:18Z',
  created_by: '2',
  updated_at: '2026-04-30T04:57:18Z',
};

describe('applyCallPdfAutofill', () => {
  it('returns a copy — never mutates the input', () => {
    const input = { ...baseCall, incident_type: 'pso_client_request' as const, client_name: 'ICU INVESTIGATIONS, LLC' };
    const out = applyCallPdfAutofill(input);
    expect(out).not.toBe(input);
    expect(input.pso_requestor_name).toBeUndefined();
  });

  it('leaves non-PSO calls alone (no requestor/client fallback)', () => {
    const out = applyCallPdfAutofill({ ...baseCall, client_name: 'Some Client' });
    expect(out.caller_name).toBeUndefined();
    expect(out.pso_requestor_name).toBeUndefined();
  });

  describe('PSO calls', () => {
    it('falls back pso_requestor_name to client_name when blank', () => {
      const out = applyCallPdfAutofill({
        ...baseCall,
        incident_type: 'pso_client_request',
        client_name: 'ICU INVESTIGATIONS, LLC',
      });
      expect(out.pso_requestor_name).toBe('ICU INVESTIGATIONS, LLC');
    });

    it('does not overwrite an existing pso_requestor_name', () => {
      const out = applyCallPdfAutofill({
        ...baseCall,
        incident_type: 'pso_client_request',
        client_name: 'ICU INVESTIGATIONS, LLC',
        pso_requestor_name: 'Jane Attorney',
      });
      expect(out.pso_requestor_name).toBe('Jane Attorney');
    });

    it('falls back caller_name and caller_phone to the requestor block', () => {
      const out = applyCallPdfAutofill({
        ...baseCall,
        incident_type: 'pso_client_request',
        pso_requestor_name: 'Jane Attorney',
        pso_requestor_phone: '801-555-0100',
      });
      expect(out.caller_name).toBe('Jane Attorney');
      expect(out.caller_phone).toBe('801-555-0100');
    });

    it('caller falls all the way through to client_name when requestor is blank', () => {
      const out = applyCallPdfAutofill({
        ...baseCall,
        incident_type: 'pso_client_request',
        client_name: 'ICU INVESTIGATIONS, LLC',
      });
      // requestor was filled from client; then caller filled from requestor
      expect(out.caller_name).toBe('ICU INVESTIGATIONS, LLC');
    });

    it('does not overwrite an existing caller_name', () => {
      const out = applyCallPdfAutofill({
        ...baseCall,
        incident_type: 'pso_client_request',
        caller_name: 'Direct Caller',
        pso_requestor_name: 'Jane Attorney',
      });
      expect(out.caller_name).toBe('Direct Caller');
    });
  });

  describe('process service calls', () => {
    it('defaults process_served_address to incident location when blank', () => {
      const out = applyCallPdfAutofill({
        ...baseCall,
        process_service_type: 'summons',
      });
      expect(out.process_served_address).toBe(baseCall.location);
    });

    it('does not overwrite an existing process_served_address', () => {
      const out = applyCallPdfAutofill({
        ...baseCall,
        process_service_type: 'summons',
        process_served_address: '123 OTHER ST',
      });
      expect(out.process_served_address).toBe('123 OTHER ST');
    });

    it('does NOT autofill process_served_to (defendant must be entered)', () => {
      const out = applyCallPdfAutofill({
        ...baseCall,
        process_service_type: 'summons',
        client_name: 'ICU INVESTIGATIONS, LLC',
      });
      expect(out.process_served_to).toBeUndefined();
    });

    it('does NOT autofill process_served_at or process_service_result', () => {
      const out = applyCallPdfAutofill({
        ...baseCall,
        process_service_type: 'summons',
      });
      expect(out.process_served_at).toBeUndefined();
      expect(out.process_service_result).toBeUndefined();
    });
  });
});
