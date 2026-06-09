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

  it('defaults service type and uses prior attempt number 1 when absent', () => {
    const d = buildNoticeOfCommunicationFromCall(
      { ...failedPsoCall, pso_service_type: undefined, pso_attempt_number: undefined }, ctx,
    );
    expect(d.serviceType).toBe('Protective Services');
    expect(d.attempts[0].number).toBe(1);
  });
});
