import { describe, it, expect } from 'vitest';
import {
  tipsToCsv, communityReportsToCsv, broadcastsToCsv, lockUnitsToCsv,
  crashReportsToCsv, briefingsToCsv, shiftNotesToCsv, formatRadioLine, trainingCoursesToCsv,
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

  it('exports crash, briefing, notes, unit radio line, and training rows', () => {
    expect(crashReportsToCsv([{
      report_number: 'CR-1', crash_date: 'd', location: '400 S', crash_type: 'rear_end',
      severity: 'fatal', vehicles_involved: 2, injuries: 1, fatalities: 1, status: 'filed',
    }])).toContain('CR-1');
    expect(briefingsToCsv([{
      briefing_number: 'B-1', title: 'Day', shift_type: 'day', created_by: 'Disp',
      created_at: 't', acknowledged_count: 2, total_officers: 8,
    }])).toContain('B-1');
    expect(shiftNotesToCsv([{
      officer_name: 'Hale', visibility: 'all', tags: ['FI'], created_at: 't', content: 'saw vehicle',
    }])).toContain('saw vehicle');
    expect(formatRadioLine({
      unit_id: '12A', officer_name: 'Hale', status: 'available', location_description: 'Main St',
    })).toBe('12A available — Hale — Main St');
    expect(trainingCoursesToCsv([{ course_name: 'Firearms', course_code: 'FA-1', category: 'firearms', duration_hours: 8, location: 'range', is_mandatory: 1 }])).toContain('FA-1');
  });
});
