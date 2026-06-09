// Tests for the PSO Notice of Communication autofill mapper.
// Pure function: failed pso_client_request call → NoticeOfCommunicationData.

import { describe, it, expect } from 'vitest';
import { buildNoticeOfCommunicationFromCall, isPsoClientRequest } from '../psoNoticeAutofill';
import type { CallForService } from '../../../../types';

const failedPsoCall: CallForService = {
  id: '42',
  call_number: 'C-26-00042',
  incident_type: 'pso_client_request',
  priority: 'P3',
  status: 'cleared',
  location: '742 EVERGREEN TER, TAYLORSVILLE, UT 84129',
  description: 'Welfare check requested by client',
  source: 'phone',
  assigned_units: [],
  notes: [],
  created_at: '2026-06-09 02:00:00',
  cleared_at: '2026-06-09 03:15:00',
  created_by: '2',
  updated_at: '2026-06-09 03:15:00',
  client_name: 'ICU INVESTIGATIONS, LLC',
  pso_service_type: 'Welfare Check',
  pso_authorization: 'PO-7781',
  pso_billing_code: 'WC-STD',
  pso_attempt_number: 2,
  disposition: 'no_contact',
  action_taken: 'No answer at door; lights off; left card',
};

const ctx = { officerName: 'Christopher Zamora', officerBadge: 'D19', dispatchPhone: '801-555-0100' };

describe('isPsoClientRequest', () => {
  it('matches only pso_client_request', () => {
    expect(isPsoClientRequest(failedPsoCall)).toBe(true);
    expect(isPsoClientRequest({ incident_type: 'process_service' as any })).toBe(false);
  });
});

describe('buildNoticeOfCommunicationFromCall', () => {
  it('falls back to the client record for the addressee (via applyCallPdfAutofill)', () => {
    const d = buildNoticeOfCommunicationFromCall(failedPsoCall, ctx);
    expect(d.clientName).toBe('ICU INVESTIGATIONS, LLC');
    expect(d.callNumber).toBe('C-26-00042');
    expect(d.serviceType).toBe('Welfare Check');
    expect(d.serviceAddress).toContain('EVERGREEN');
    expect(d.authorization).toBe('PO-7781');
    expect(d.billingCode).toBe('WC-STD');
  });

  it('represents the failed call as a single attempt row from the cleared time', () => {
    const d = buildNoticeOfCommunicationFromCall(failedPsoCall, ctx);
    expect(d.attempts).toHaveLength(1);
    expect(d.attempts[0].number).toBe(2);
    expect(d.attempts[0].date).toBe('2026-06-09');
    expect(d.attempts[0].time).toBe('03:15');
    expect(d.attempts[0].result).toBe('no_contact');
    expect(d.attempts[0].notes).toContain('No answer');
  });

  it('carries the officer + re-dispatch context through', () => {
    const d = buildNoticeOfCommunicationFromCall(failedPsoCall, {
      ...ctx, redispatchCallNumber: 'C-26-00051', nextWindow: 'Tomorrow 0800-1000',
    });
    expect(d.officerName).toBe('Christopher Zamora');
    expect(d.officerBadge).toBe('D19');
    expect(d.redispatchCallNumber).toBe('C-26-00051');
    expect(d.nextWindow).toBe('Tomorrow 0800-1000');
  });

  it('uses a service-accurate default (not "Protective Services") and attempt 1 when absent', () => {
    const d = buildNoticeOfCommunicationFromCall(
      { ...failedPsoCall, pso_service_type: undefined, pso_attempt_number: undefined }, ctx,
    );
    expect(d.serviceType).toBe('Client-Requested Service');
    expect(d.attempts[0].number).toBe(1);
  });

  it('derives service type from the client industry when pso_service_type is blank', () => {
    const d = buildNoticeOfCommunicationFromCall(
      { ...failedPsoCall, pso_service_type: undefined, client_industry: 'Process Service' } as CallForService,
      ctx,
    );
    expect(d.serviceType).toBe('Process Service');
  });

  it('derives "Process Service" from a PS disposition when no industry is set', () => {
    const d = buildNoticeOfCommunicationFromCall(
      { ...failedPsoCall, pso_service_type: undefined, disposition: 'PS Non-Service' }, ctx,
    );
    expect(d.serviceType).toBe('Process Service');
    // "PS Non-Service" maps to a client-readable result, not the raw code.
    expect(d.attempts[0].result).toBe('PS Non-Service');
  });

  it('addresses the contracting client record (name + contact + phone + address)', () => {
    const d = buildNoticeOfCommunicationFromCall(
      {
        ...failedPsoCall,
        caller_name: 'Michael Currie', // call-level caller is an individual contact
        client_name: 'ICU Investigations, LLC.',
        client_contact_name: 'Michael Currie',
        client_phone: '(435) 462-1200',
        client_address: '250 N. Red Cliffs Drive #4B-275, Saint George, UT 84790',
      } as CallForService,
      ctx,
    );
    // Addressee is the COMPANY (client record), not the individual caller.
    expect(d.clientName).toBe('ICU Investigations, LLC.');
    expect(d.clientContact).toBe('Michael Currie');
    expect(d.clientPhone).toBe('(435) 462-1200');
    expect(d.clientAddress).toContain('Red Cliffs');
  });
});
