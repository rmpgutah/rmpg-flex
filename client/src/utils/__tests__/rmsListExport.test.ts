import { describe, it, expect } from 'vitest';
import {
  tipsToCsv,
  communityReportsToCsv,
  broadcastsToCsv,
  lockUnitsToCsv,
  crashReportsToCsv,
  briefingsToCsv,
  shiftNotesToCsv,
  trainingCoursesToCsv,
  formatRadioLine,
  unitsBoardToCsv,
  unitsBoardToTsv,
  fileListingToCsv,
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

  it('exports crash reports, briefings, shift notes, and training courses', () => {
    expect(crashReportsToCsv([{
      report_number: 'CR-1', crash_date: '2026-08-01', location: 'Main',
      crash_type: 'rear_end', severity: 'minor_injury', vehicles_involved: 2,
      injuries: 1, fatalities: 0, status: 'filed', investigating_officer: 'Hale',
    }])).toContain('CR-1');

    expect(briefingsToCsv([{
      briefing_number: 'B-1', title: 'Day shift', shift_type: 'day',
      created_at: 't', created_by: 'Sgt', acknowledged_count: 3, total_officers: 8,
    }])).toContain('Day shift');

    expect(shiftNotesToCsv([{
      officer_name: 'Hale', content: 'FI stop', visibility: 'supervisor',
      tags: ['FI', 'Patrol'], created_at: 't', shift_date: '2026-08-01',
    }])).toContain('FI|Patrol');

    expect(trainingCoursesToCsv([{
      course_name: 'Firearms', course_code: 'FA-1', category: 'firearms',
      duration_hours: 8, location: 'Range', instructor_name: 'Lee', is_mandatory: 1,
    }])).toContain('yes');
  });

  it('formats radio lines and unit board CSV/TSV', () => {
    const unit = {
      unit_id: 'U12', officer_name: 'Hale', badge: '42', status: 'available',
      current_call_number: 'CFS-9', location_description: 'Main St',
    };
    expect(formatRadioLine(unit)).toBe('U12 Hale #42 available CFS-9 Main St');
    expect(unitsBoardToCsv([unit])).toContain('U12');
    expect(unitsBoardToTsv([unit]).split('\n')[1]).toContain('\t');
  });

  it('exports file listings', () => {
    expect(fileListingToCsv([{
      name: 'a.log', size: 12, modified: 't', path: '/logs/a.log',
    }])).toContain('/logs/a.log');
  });
});
