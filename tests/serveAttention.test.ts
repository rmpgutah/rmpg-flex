// tests/serveAttention.test.ts
import { describe, it, expect } from 'vitest';
import { classifyServeJob, shouldNotify, type ServeJobForAttention, type AttentionSettings } from '../src/utils/serveAttention';

const SETTINGS: AttentionSettings = { approaching_hours: 48, diligence_gap_days: 3, unassigned_window_hours: 72 };
const NOW = '2026-06-13T18:00:00.000Z';

const JOB = (p: Partial<ServeJobForAttention> = {}): ServeJobForAttention => ({
  id: 1, status: 'assigned', officer_id: 7, deadline: null, last_attempt_at: null, ...p,
});

describe('classifyServeJob', () => {
  it('returns nothing for an open job with no deadline and a recent attempt', () => {
    expect(classifyServeJob(JOB({ last_attempt_at: NOW }), NOW, SETTINGS)).toEqual([]);
  });

  it('flags deadline_passed when the deadline is in the past', () => {
    const r = classifyServeJob(JOB({ deadline: '2026-06-12T18:00:00.000Z', last_attempt_at: NOW }), NOW, SETTINGS);
    expect(r).toContain('deadline_passed');
    expect(r).not.toContain('deadline_approaching');
  });

  it('flags deadline_approaching within the window but not past', () => {
    const r = classifyServeJob(JOB({ deadline: '2026-06-14T18:00:00.000Z', last_attempt_at: NOW }), NOW, SETTINGS); // +24h
    expect(r).toContain('deadline_approaching');
    expect(r).not.toContain('deadline_passed');
  });

  it('does NOT flag approaching when the deadline is beyond the window', () => {
    const r = classifyServeJob(JOB({ deadline: '2026-06-20T18:00:00.000Z', last_attempt_at: NOW }), NOW, SETTINGS); // +7d
    expect(r).not.toContain('deadline_approaching');
  });

  it('flags diligence_gap when assigned and no attempt past the gap window', () => {
    expect(classifyServeJob(JOB({ last_attempt_at: null }), NOW, SETTINGS)).toContain('diligence_gap');
    expect(classifyServeJob(JOB({ last_attempt_at: '2026-06-08T18:00:00.000Z' }), NOW, SETTINGS)).toContain('diligence_gap'); // 5d ago
    expect(classifyServeJob(JOB({ last_attempt_at: '2026-06-12T18:00:00.000Z' }), NOW, SETTINGS)).not.toContain('diligence_gap'); // 1d ago
  });

  it('flags unassigned_near_deadline only when unassigned and within window', () => {
    const r = classifyServeJob(JOB({ officer_id: null, deadline: '2026-06-15T18:00:00.000Z' }), NOW, SETTINGS); // +48h, within 72h
    expect(r).toContain('unassigned_near_deadline');
    const assigned = classifyServeJob(JOB({ officer_id: 7, deadline: '2026-06-15T18:00:00.000Z' }), NOW, SETTINGS);
    expect(assigned).not.toContain('unassigned_near_deadline');
  });

  it('never classifies a closed job', () => {
    for (const status of ['served', 'cancelled', 'failed']) {
      expect(classifyServeJob(JOB({ status, deadline: '2026-06-01T00:00:00.000Z', officer_id: null }), NOW, SETTINGS)).toEqual([]);
    }
  });
});

describe('shouldNotify', () => {
  it('notifies when never notified', () => {
    expect(shouldNotify(null, NOW, 24)).toBe(true);
  });
  it('suppresses inside the renotify window, allows after', () => {
    expect(shouldNotify('2026-06-13T06:00:00.000Z', NOW, 24)).toBe(false); // 12h ago < 24h
    expect(shouldNotify('2026-06-12T06:00:00.000Z', NOW, 24)).toBe(true);  // 36h ago > 24h
  });
});
