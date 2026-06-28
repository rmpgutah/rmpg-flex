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
    // splitStamp now returns MM/DD/YYYY (US legal-document convention)
    // so the table column matches the notice-date format. Raw ISO was
    // leaking through to the recipient copy.
    expect(d.attempts[0].date).toBe('06/09/2026');
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

  it('falls back to "Legal Documents" (respondent-readable) and attempt 1 when absent', () => {
    const d = buildNoticeOfCommunicationFromCall(
      { ...failedPsoCall, pso_service_type: undefined, pso_attempt_number: undefined }, ctx,
    );
    // The default fills the "DOCUMENTS" field on the respondent copy, so it
    // must read as a thing being delivered — not an internal service label.
    expect(d.serviceType).toBe('Legal Documents');
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

  it('surfaces every visit in the PSO chain as its own attempt row', () => {
    // When the same recipient has been attempted multiple times, every prior
    // visit in visit_history becomes an attempt row alongside the closing
    // attempt. Recipient's second / third notice reads as a coherent record
    // of ALL attempts, not just the latest.
    const d = buildNoticeOfCommunicationFromCall(
      {
        ...failedPsoCall,
        pso_attempt_number: 3,
        // First two attempts came from the chain; this call is the 3rd.
        visit_history: [
          {
            id: 30, call_id: '30', visit_number: 1, status: 'cleared',
            disposition: 'no_contact', note: 'No answer; lights off',
            onscene_at: '2026-06-07 14:00:00', created_at: '2026-06-07 13:55:00',
          } as any,
          {
            id: 36, call_id: '36', visit_number: 2, status: 'cleared',
            disposition: 'no_contact', note: 'Gate locked',
            onscene_at: '2026-06-08 18:30:00', created_at: '2026-06-08 18:20:00',
          } as any,
        ],
      } as CallForService,
      ctx,
    );
    expect(d.attempts).toHaveLength(3);
    // Sorted ascending by visit_number — recipient reads the chain in order.
    expect(d.attempts.map((a) => a.number)).toEqual([1, 2, 3]);
    expect(d.attempts[0].date).toBe('06/07/2026');
    expect(d.attempts[0].time).toBe('14:00');
    expect(d.attempts[0].notes).toContain('No answer');
    expect(d.attempts[1].notes).toContain('Gate locked');
    expect(d.attempts[2].number).toBe(3);
    expect(d.attempts[2].notes).toContain('No answer at door');
  });

  it('dedups attempts by visit_number so the same row never lists twice', () => {
    // Guard against a server-side change that includes the current call in
    // visit_history — the dedup keeps the merged set honest.
    const d = buildNoticeOfCommunicationFromCall(
      {
        ...failedPsoCall,
        pso_attempt_number: 2,
        visit_history: [
          {
            id: 30, call_id: '30', visit_number: 1, status: 'cleared',
            disposition: 'no_contact', note: 'First',
            onscene_at: '2026-06-07 14:00:00', created_at: '2026-06-07 13:55:00',
          } as any,
          {
            id: 42, call_id: '42', visit_number: 2, status: 'cleared',
            disposition: 'no_contact', note: 'Should be deduped',
            onscene_at: '2026-06-09 03:00:00', created_at: '2026-06-09 02:55:00',
          } as any,
        ],
      } as CallForService,
      ctx,
    );
    expect(d.attempts).toHaveLength(2);
    expect(d.attempts.map((a) => a.number)).toEqual([1, 2]);
  });
});
