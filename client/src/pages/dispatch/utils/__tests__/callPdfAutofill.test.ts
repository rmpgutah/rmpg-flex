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

    it('falls back caller_address to the client address (server-joined)', () => {
      const out = applyCallPdfAutofill({
        ...baseCall,
        incident_type: 'pso_client_request',
        client_name: 'ICU INVESTIGATIONS, LLC',
        // server-joined columns arrive as extra props
        client_address: '250 North Red Cliffs Drive, #4B-275, Saint George, UT',
      } as any);
      expect(out.caller_address).toBe('250 North Red Cliffs Drive, #4B-275, Saint George, UT');
    });

    it('does not overwrite an existing caller_address', () => {
      const out = applyCallPdfAutofill({
        ...baseCall,
        incident_type: 'pso_client_request',
        caller_address: '100 Specific Lane',
        client_address: '250 North Red Cliffs Drive',
      } as any);
      expect(out.caller_address).toBe('100 Specific Lane');
    });

    it('defaults caller_relationship to "Authorized Agent" when PSO + contracting party is set', () => {
      const out = applyCallPdfAutofill({
        ...baseCall,
        incident_type: 'pso_client_request',
        client_name: 'ICU INVESTIGATIONS, LLC',
      });
      expect(out.caller_relationship).toBe('Authorized Agent');
    });

    it('does not overwrite an explicit caller_relationship', () => {
      const out = applyCallPdfAutofill({
        ...baseCall,
        incident_type: 'pso_client_request',
        client_name: 'ICU INVESTIGATIONS, LLC',
        caller_relationship: 'Property Manager',
      });
      expect(out.caller_relationship).toBe('Property Manager');
    });

    it('does NOT default caller_relationship when no contracting party is present', () => {
      const out = applyCallPdfAutofill({
        ...baseCall,
        incident_type: 'pso_client_request',
      });
      expect(out.caller_relationship).toBeUndefined();
    });

    it('falls back pso_requestor_phone/email from the joined client record', () => {
      const out = applyCallPdfAutofill({
        ...baseCall,
        incident_type: 'pso_client_request',
        client_name: 'ICU INVESTIGATIONS, LLC',
        client_phone: '435-986-1200',
        client_email: 'a1processserver@gmail.com',
      } as any);
      expect(out.pso_requestor_phone).toBe('435-986-1200');
      expect(out.pso_requestor_email).toBe('a1processserver@gmail.com');
    });

    it('does not overwrite explicit requestor phone/email', () => {
      const out = applyCallPdfAutofill({
        ...baseCall,
        incident_type: 'pso_client_request',
        pso_requestor_phone: '999-999-9999',
        pso_requestor_email: 'specific@example.com',
        client_phone: '435-986-1200',
        client_email: 'a1processserver@gmail.com',
      } as any);
      expect(out.pso_requestor_phone).toBe('999-999-9999');
      expect(out.pso_requestor_email).toBe('specific@example.com');
    });
  });

  describe('property_name fallback', () => {
    it('falls back to property_address when property_name is blank but address is set', () => {
      const out: any = applyCallPdfAutofill({
        ...baseCall,
        property_address: '3854 WEST PRAIRIE',
      } as any);
      expect(out.property_name).toBe('3854 WEST PRAIRIE');
    });

    it('does not overwrite an existing property_name', () => {
      const out: any = applyCallPdfAutofill({
        ...baseCall,
        property_name: 'Plaza Tower',
        property_address: '3854 WEST PRAIRIE',
      } as any);
      expect(out.property_name).toBe('Plaza Tower');
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
