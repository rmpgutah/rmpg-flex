import { describe, it, expect } from 'vitest';
import {
  tipsToCsv, communityReportsToCsv, crashReportsToCsv, formatRadioLine,
  agendaToCsv, qaReviewsToCsv, assetsToCsv, errorLogsToCsv, recordingsToCsv,
  modulesToCsv, mutualAidToCsv, plateHistoryToCsv,
  jailBookingsToCsv, partnersToCsv, recruitmentPipelineToCsv, invoicesToCsv,
} from '../rmsListExport';

describe('rmsListExport', () => {
  it('redacts anonymous community contact', () => {
    const csv = communityReportsToCsv([{
      tracking_number: 'CR-9', report_type: 'noise', status: 'submitted', location: '400 S',
      anonymous: true, reporter_name: 'Jane Doe', reporter_phone: '8015551212',
      reporter_email: 'jane@example.com', description: 'loud music',
    }]);
    expect(csv).not.toContain('Jane Doe');
    expect(csv).toContain('[anonymous]');
  });

  it('covers crash, radio, agenda, qa, assets, logs, recordings, modules, aid, plates', () => {
    expect(tipsToCsv([{ tracking_number: 'T-1', tip_type: 't', urgency: 'u', status: 's', location: 'l', assigned_to_name: null }])).toContain('T-1');
    expect(crashReportsToCsv([{
      report_number: 'CR-1', crash_date: 'd', location: 'x', crash_type: 't', severity: 's',
      vehicles_involved: 1, injuries: 0, fatalities: 0, status: 'filed',
    }])).toContain('CR-1');
    expect(formatRadioLine({ unit_id: '12A', officer_name: 'Hale', status: 'available', location_description: 'Main' }))
      .toBe('12A available — Hale — Main');
    expect(agendaToCsv([{ source: 'custom', title: 'Brief', date: '2026-08-01' }])).toContain('Brief');
    expect(qaReviewsToCsv([{ id: 9, review_type: 'call_audit', findings: 'ok' }])).toContain('call_audit');
    expect(assetsToCsv([{ asset_tag: 'A-1', serial_number: 'SN9', status: 'issued' }])).toContain('SN9');
    expect(errorLogsToCsv([{ created_at: 't', severity: 'error', category: 'route', message: 'boom', trace_id: 'abc' }])).toContain('abc');
    expect(recordingsToCsv([{ id: 3, started_at: 't', duration_sec: 12, status: 'saved', location_text: '400 S', notes: null }])).toContain('400 S');
    expect(modulesToCsv([{ path: '/qa', label: 'QA' }])).toContain('/qa');
    expect(mutualAidToCsv([{ callNumber: 'C1', nature: 'assist', location: 'x', requestingAgency: 'RMPG', assistingAgencies: ['SLCPD'] }])).toContain('SLCPD');
    expect(plateHistoryToCsv([{ plate: 'ABC123', state: 'UT' }])).toContain('ABC123');
    expect(plateHistoryToCsv([{ plate: 'XYZ', state: 'UT', ts: 1_700_000_000_000 }])).toContain('XYZ');
    expect(jailBookingsToCsv([{ full_name: 'Ada', booking_date: '2026-01-01', charges: 'x', county: 'SL' }])).toContain('Ada');
    expect(partnersToCsv([{ agency_name: 'SLCPD', data_share_level: 'full' }])).toContain('SLCPD');
    const recCsv = recruitmentPipelineToCsv([{ candidate_name: 'Pat', position: 'officer', stage: 'applied', applied_date: '2026-01-01' }]);
    expect(recCsv).toContain('Pat');
    expect(recCsv).not.toContain('email');
    expect(invoicesToCsv([{ invoice_number: 'INV-1', status: 'sent', total_amount: 10, paid_amount: 0 }])).toContain('INV-1');
  });
});
