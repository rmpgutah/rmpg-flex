import { describe, it, expect } from 'vitest';
import {
  tipsToCsv, communityReportsToCsv, broadcastsToCsv, lockUnitsToCsv,
  crashReportsToCsv, briefingsToCsv, shiftNotesToCsv, trainingCoursesToCsv,
  fileListingToCsv, formatRadioLine, unitsBoardToCsv, unitsBoardToTsv,
} from '../rmsListExport';

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
