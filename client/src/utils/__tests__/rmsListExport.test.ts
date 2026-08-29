import { describe, it, expect } from 'vitest';
import {
  tipsToCsv, communityReportsToCsv, broadcastsToCsv, lockUnitsToCsv,
  crashReportsToCsv, briefingsToCsv, shiftNotesToCsv, trainingCoursesToCsv,
  fileListingToCsv, formatRadioLine, unitsBoardToCsv, unitsBoardToTsv,
  agendaToCsv, qaReviewsToCsv, assetsToCsv, errorLogsToCsv, recordingsToCsv,
  modulesToCsv, mutualAidToCsv, plateHistoryToCsv, jailBookingsToCsv,
  partnersToCsv, recruitmentPipelineToCsv, invoicesToCsv,
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

  it('serializes crash reports, briefings, notes, courses, files, and unit board', () => {
    expect(crashReportsToCsv([{
      report_number: 'CR-1', crash_date: '2026-08-01', location: 'State St',
      crash_type: 'rear_end', severity: 'minor_injury', vehicles_involved: 2,
      injuries: 1, fatalities: 0, status: 'filed',
    }])).toContain('CR-1');
    expect(briefingsToCsv([{
      briefing_number: 'B-1', title: 'Day', shift_type: 'day', created_at: 't',
      created_by: 'Disp', acknowledged_count: 2, total_officers: 8,
    }])).toContain('Day');
    expect(shiftNotesToCsv([{
      officer_name: 'Hale', shift_date: '2026-08-01', visibility: 'all',
      tags: ['Patrol'], content: 'Quiet',
    }])).toContain('Quiet');
    expect(trainingCoursesToCsv([{ course_name: 'DT', course_code: 'DT-1', category: 'defensive_tactics', mandatory: 1, hours: 8 }])).toContain('DT-1');
    expect(fileListingToCsv([{ name: 'a.log', size: 12, modified: 't', path: '/logs/a.log' }])).toContain('a.log');
    expect(formatRadioLine({
      unit_id: 'Adam-1', officer_name: 'Hale', badge: '12', status: 'available',
    })).toContain('Adam-1');
    expect(unitsBoardToCsv([{
      unit_id: 'Adam-1', officer_name: 'Hale', badge: '12', status: 'available',
    }])).toContain('Adam-1');
    expect(unitsBoardToTsv([{
      unit_id: 'Adam-1', officer_name: 'Hale', badge: '12', status: 'available',
    }]).split('\t').length).toBeGreaterThan(3);
  });

  it('exports crash reports, briefings, notes, courses, files, and the unit board', () => {
    expect(crashReportsToCsv([{
      report_number: 'CR-1', crash_date: '2026-08-01', location: '500 W', crash_type: 'rear',
      severity: 'pdo', vehicles_involved: 2, injuries: 0, fatalities: 0, status: 'open',
      investigating_officer: 'Hale',
    }])).toContain('CR-1');
    expect(briefingsToCsv([{
      briefing_number: 'B-1', title: 'Day', shift_type: 'day', created_at: 't', created_by: 'Disp',
      acknowledged_count: 2, total_officers: 8,
    }])).toContain('B-1');
    expect(shiftNotesToCsv([{
      officer_name: 'Hale', content: 'FI at 400 S', visibility: 'all', tags: ['FI'],
      created_at: 't', shift_date: '2026-08-01',
    }])).toContain('FI at 400 S');
    expect(trainingCoursesToCsv([{ course_name: 'Firearms', course_code: 'FA-1', category: 'firearms', location: 'Range', mandatory: true }]))
      .toContain('Firearms');
    expect(fileListingToCsv([{ name: 'a.log', size: 12, modified: 't', path: '/logs/a.log' }])).toContain('a.log');
    expect(formatRadioLine({ unit_id: 'U1', officer_name: 'Hale', badge: '12', status: 'available' }))
      .toBe('U1 Hale #12 available');
    expect(unitsBoardToCsv([{ unit_id: 'U1', officer_name: 'Hale', badge: '12', status: 'available' }])).toContain('U1');
    expect(unitsBoardToTsv([{ unit_id: 'U1', officer_name: 'Hale', badge: '12', status: 'available' }])).toContain('\t');
  });
});
