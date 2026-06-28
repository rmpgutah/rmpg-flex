import { describe, it, expect } from 'vitest';
import { reportTelemetryRows, reportFilename } from '../forensicReportPdf';
import type { TrackStats } from '../dashcamForensics';

const stats: TrackStats = {
  points: 21, durationSec: 20, distanceMeters: 1609.344, distanceMiles: 1.0,
  maxSpeed: 62, minSpeed: 10, avgSpeed: 46, startSpeed: 30, endSpeed: 12,
  maxAccelG: 0.23, maxBrakeG: 0.18,
};

describe('forensicReportPdf — telemetry rows', () => {
  it('builds labeled, formatted rows from stats', () => {
    const rows = reportTelemetryRows(stats);
    const map = Object.fromEntries(rows);
    expect(map['Peak speed']).toBe('62 mph');
    expect(map['Average speed']).toBe('46 mph');
    expect(map['Speed at start / end']).toBe('30 / 12 mph');
    expect(map['Distance']).toBe('1.00 mi');
    expect(map['Duration']).toBe('20 s');
    expect(map['Peak braking']).toBe('0.18 g');
    expect(map['Peak acceleration']).toBe('0.23 g');
    expect(map['GPS samples']).toBe('21');
  });
});

describe('forensicReportPdf — filename', () => {
  it('builds a safe, descriptive filename', () => {
    expect(reportFilename({ stats, device: 'cp160817', timestamp: '2026-06-12 11:00:17', plate: '6KJ-4L5' }))
      .toMatch(/^rmpg-forensic-report_cp160817_\d+_6KJ4L5\.pdf$/);
    expect(reportFilename({ stats })).toMatch(/^rmpg-forensic-report_cam_report\.pdf$/);
  });
});
