// ============================================================
// useOfForceReportPdf — pure-helper + generator smoke tests.
// Page 44 of the full-app frontend pass (Use of Force). Same
// shape as the prior court-PDF utilities' tests (bodycamVideoCustody,
// equipmentCustody, auditLog): helpers first, then a generator
// smoke test confirming we don't throw on null-everything rows.
// ============================================================

import { describe, expect, it } from 'vitest';
import {
  fmtDate, fmtDateTime, fmtDuration, prettyLabel,
  hasInjuries, isLethalForce, fmtWitnesses, fmtSubject,
  generateUseOfForceReportPdf,
} from '../useOfForceReportPdf';

describe('useOfForceReportPdf — pure helpers', () => {
  describe('fmtDate', () => {
    it('returns em-dash for empty input', () => {
      expect(fmtDate(undefined)).toBe('—');
      expect(fmtDate(null)).toBe('—');
      expect(fmtDate('')).toBe('—');
    });
    it('formats an ISO date in Mountain Time', () => {
      const out = fmtDate('2026-06-22T14:00:00Z');
      expect(out).toMatch(/Jun 22, 2026/);
    });
  });

  describe('fmtDateTime', () => {
    it('appends MT timezone marker on valid input', () => {
      const out = fmtDateTime('2026-06-22T14:00:00Z');
      expect(out).toMatch(/MT$/);
      expect(out).toMatch(/Jun 22, 2026/);
    });
    it('returns em-dash for empty input', () => {
      expect(fmtDateTime(undefined)).toBe('—');
    });
  });

  describe('fmtDuration', () => {
    it('formats seconds as HH:MM:SS', () => {
      expect(fmtDuration(0)).toBe('00:00:00');
      expect(fmtDuration(65)).toBe('00:01:05');
      expect(fmtDuration(3725)).toBe('01:02:05');
    });
    it('returns em-dash for nullish, clamps negative', () => {
      expect(fmtDuration(null)).toBe('—');
      expect(fmtDuration(undefined)).toBe('—');
      expect(fmtDuration(-10)).toBe('00:00:00');
    });
  });

  describe('prettyLabel', () => {
    it('returns em-dash for empty', () => {
      expect(prettyLabel(undefined)).toBe('—');
      expect(prettyLabel(null)).toBe('—');
      expect(prettyLabel('')).toBe('—');
    });
    it('converts snake_case to Title Case', () => {
      expect(prettyLabel('use_of_force')).toBe('Use Of Force');
      expect(prettyLabel('physical_control')).toBe('Physical Control');
      expect(prettyLabel('oc_spray')).toBe('Oc Spray');
    });
  });

  describe('hasInjuries', () => {
    it('false when both fields are empty / "none"', () => {
      expect(hasInjuries({})).toBe(false);
      expect(hasInjuries({ subject_injuries: '', officer_injuries: '' })).toBe(false);
      expect(hasInjuries({ subject_injuries: 'None', officer_injuries: 'none' })).toBe(false);
      expect(hasInjuries({ subject_injuries: 'N/A', officer_injuries: '-' })).toBe(false);
      expect(hasInjuries({ subject_injuries: '   ', officer_injuries: '—' })).toBe(false);
    });
    it('true when either field has real content', () => {
      expect(hasInjuries({ subject_injuries: 'Abrasion to left elbow' })).toBe(true);
      expect(hasInjuries({ officer_injuries: 'Sprained wrist' })).toBe(true);
      expect(hasInjuries({ subject_injuries: 'None', officer_injuries: 'Cut lip' })).toBe(true);
    });
  });

  describe('isLethalForce', () => {
    it('true for firearm force_type', () => {
      expect(isLethalForce({ force_type: 'firearm' })).toBe(true);
      expect(isLethalForce({ force_type: 'FIREARM' })).toBe(true);
    });
    it('true for Life-Threatening force_level', () => {
      expect(isLethalForce({ force_level: 'Level 4 - Life Threatening' })).toBe(true);
      expect(isLethalForce({ force_level: 'life-threatening' })).toBe(true);
    });
    it('false for non-lethal force', () => {
      expect(isLethalForce({ force_type: 'taser' })).toBe(false);
      expect(isLethalForce({ force_type: 'verbal_command' })).toBe(false);
      expect(isLethalForce({ force_type: 'taser', force_level: 'Level 2 - Resistive' })).toBe(false);
      expect(isLethalForce({})).toBe(false);
    });
  });

  describe('fmtWitnesses', () => {
    it('returns em-dash for empty', () => {
      expect(fmtWitnesses(null)).toBe('—');
      expect(fmtWitnesses(undefined)).toBe('—');
      expect(fmtWitnesses('')).toBe('—');
      expect(fmtWitnesses('   ')).toBe('—');
    });
    it('parses JSON arrays', () => {
      expect(fmtWitnesses('["Sgt. Smith","Off. Jones"]')).toBe('Sgt. Smith, Off. Jones');
    });
    it('returns the empty case for an empty JSON array', () => {
      expect(fmtWitnesses('[]')).toBe('—');
      expect(fmtWitnesses('[""," "]')).toBe('—');
    });
    it('falls through to the raw string for comma-separated input', () => {
      expect(fmtWitnesses('Sgt. Smith, Off. Jones')).toBe('Sgt. Smith, Off. Jones');
    });
    it('falls through to the raw string for malformed JSON', () => {
      expect(fmtWitnesses('[not json')).toBe('[not json');
    });
  });

  describe('fmtSubject', () => {
    it('returns em-dash when no name parts', () => {
      expect(fmtSubject({})).toBe('—');
      expect(fmtSubject({ subject_first_name: '', subject_last_name: '' })).toBe('—');
    });
    it('concatenates first + last when both present', () => {
      expect(fmtSubject({ subject_first_name: 'John', subject_last_name: 'Doe' })).toBe('John Doe');
    });
    it('uses single name part when only one present', () => {
      expect(fmtSubject({ subject_last_name: 'Doe' })).toBe('Doe');
      expect(fmtSubject({ subject_first_name: 'John' })).toBe('John');
    });
    it('appends DOB chip when present', () => {
      const out = fmtSubject({ subject_first_name: 'John', subject_last_name: 'Doe', subject_dob: '1985-04-12' });
      expect(out).toMatch(/John Doe/);
      expect(out).toMatch(/DOB Apr 12, 1985/);
    });
  });
});

describe('generateUseOfForceReportPdf — smoke', () => {
  it('does not throw on a null-everything report', () => {
    expect(() => generateUseOfForceReportPdf({ report: { id: 1 } })).not.toThrow();
  });

  it('does not throw on a populated lethal-force report with injuries + footage', () => {
    expect(() =>
      generateUseOfForceReportPdf({
        report: {
          id: 42,
          force_type: 'firearm',
          force_level: 'Level 4 - Life Threatening',
          status: 'submitted',
          justification: 'Subject brandished weapon; lethal force authorized under UCA 76-2-404.',
          subject_injuries: 'Through-and-through GSW left thigh; transported to LDS Hospital.',
          officer_injuries: 'None',
          de_escalation_attempted: 1,
          de_escalation_details: 'Repeated verbal commands over 90 seconds; less-lethal not viable due to range.',
          weapons_used: 'Department-issued Glock 17',
          body_camera_active: 1,
          witness_officers: '["Sgt. Smith","Off. Jones","Det. Lee"]',
          narrative: 'On 2026-06-22 at approximately 1430 hrs...',
          created_at: '2026-06-22T14:35:00Z',
          updated_at: '2026-06-22T15:00:00Z',
          officer_name: 'Off. Doe',
          officer_badge: '105',
          subject_first_name: 'John',
          subject_last_name: 'Doe',
          subject_dob: '1985-04-12',
          incident_number: 'INC-2026-1041',
          incident_type: 'aggravated_assault',
          reviewer_name: 'Sgt. Smith',
          reviewed_at: '2026-06-22T16:30:00Z',
          review_notes: 'Force was within policy. IA review opened per state-DOJ requirement.',
        },
        linkedFootage: [
          { kind: 'bwc', id: 7, title: 'BWC-007', recorded_at: '2026-06-22T14:25:00Z', duration_seconds: 1200, classification: 'evidence', evidence_locked: 1, evidence_number: 'BWC-26-0008' },
          { kind: 'dashcam', id: 11, recorded_at: '2026-06-22T14:24:30Z', duration_seconds: 600, classification: 'critical_event', evidence_locked: 1, evidence_number: 'FC-26-0012' },
        ],
        preparedBy: 'Sgt. Smith',
      }),
    ).not.toThrow();
  });

  it('does not throw with no injuries / no footage / no review (draft report)', () => {
    expect(() =>
      generateUseOfForceReportPdf({
        report: {
          id: 7,
          force_type: 'verbal_command',
          status: 'draft',
          justification: 'De-escalation only; no physical force.',
          de_escalation_attempted: 1,
          body_camera_active: 1,
        },
      }),
    ).not.toThrow();
  });

  it('does not throw with very long narrative + witness list (paging)', () => {
    expect(() =>
      generateUseOfForceReportPdf({
        report: {
          id: 99,
          force_type: 'taser',
          narrative: 'paragraph '.repeat(400),
          justification: 'paragraph '.repeat(200),
          witness_officers: JSON.stringify(Array.from({ length: 25 }, (_, i) => `Off. ${i}`)),
          officer_name: 'a'.repeat(80),
        },
      }),
    ).not.toThrow();
  });
});
