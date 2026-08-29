import { describe, it, expect } from 'vitest';
import { tipsToCsv, communityReportsToCsv, broadcastsToCsv, lockUnitsToCsv, crashReportsToCsv, briefingsToCsv, shiftNotesToCsv, trainingCoursesToCsv, formatRadioLine, unitsBoardToCsv, unitsBoardToTsv, fileListingToCsv } from '../rmsListExport';

describe('rmsListExport', () => {
  it('exports tips without a free-text notes dump of unused columns', () => {
    const csv = tipsToCsv([{
      tracking_number: 'T-1', tip_type: 'theft', urgency: 'urgent', status: 'new',
      location: 'Main St', assigned_to_name: 'Hale',
    }]);
    expect(csv).toContain('T-1');
    expect(csv.split('\n')[0]).toBe('tracking,type,urgency,status,location,assigned');
  });

  it('redacts contact fields on anonymous community reports', () => {
    const csv = communityReportsToCsv([{
      tracking_number: 'CR-9', report_type: 'noise', status: 'submitted', location: '400 S',
      anonymous: true, reporter_name: 'Jane Doe', reporter_phone: '8015551212',
      reporter_email: 'jane@example.com', description: 'loud music',
    }]);
    expect(csv).toContain('[anonymous]');
    expect(csv).not.toContain('Jane Doe');
    expect(csv).not.toContain('8015551212');
    expect(csv).not.toContain('jane@example.com');
    expect(csv).toContain('loud music');
  });

  it('serializes broadcasts and lock units', () => {
    expect(broadcastsToCsv([{
      message: 'Stand down', priority: 'routine', target: 'all', target_id: null,
      sender_name: 'Disp', created_at: 't',
    }])).toContain('Stand down');
    expect(lockUnitsToCsv([{
      unit_id: 'U1', officer_name: 'Hale', badge: '12', status: 'locked', reason: 'Lost device',
    }])).toContain('Lost device');
  });

  it('serializes crash reports, briefings, notes, training, units, and file listings', () => {
    expect(crashReportsToCsv([{
      report_number: 'CR-1', crash_date: '2026-08-01', location: 'State St',
      crash_type: 'rear_end', severity: 'minor_injury', status: 'filed', investigating_officer: 'Hale',
    }])).toContain('CR-1');
    expect(briefingsToCsv([{
      briefing_number: 'B-1', title: 'Night brief', shift_type: 'night', created_at: 't', created_by: 'Sgt',
    }])).toContain('Night brief');
    expect(shiftNotesToCsv([{
      officer_name: 'Hale', content: 'FI at 400 S', visibility: 'all', created_at: 't', shift_date: '2026-08-01',
    }])).toContain('FI at 400 S');
    expect(trainingCoursesToCsv([{ course_name: 'Firearms', course_code: 'FA-1', category: 'firearms', duration_hours: 8, instructor_name: 'Lee' }])).toContain('Firearms');
    expect(formatRadioLine({ unit_id: '4A12', officer_name: 'Hale', badge: '12', status: 'available' })).toContain('4A12');
    expect(unitsBoardToCsv([{ unit_id: '4A12', officer_name: 'Hale', badge: '12', status: 'available' }])).toContain('4A12');
    expect(unitsBoardToTsv([{ unit_id: '4A12', officer_name: 'Hale', badge: '12', status: 'available' }])).toContain('Hale');
    expect(fileListingToCsv([{ name: 'a.log', size: 12, modified: 't', path: '/logs/a.log' }])).toContain('a.log');
  });
});
