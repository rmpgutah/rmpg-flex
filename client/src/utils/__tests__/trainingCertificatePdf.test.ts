import { describe, it, expect } from 'vitest';
import {
  prettyCategory,
  prettyStatus,
  formatScore,
  formatRenewal,
  expiryStatus,
  needsAuditAlert,
  isSubMinimumHours,
} from '../trainingCertificatePdf';

describe('prettyCategory', () => {
  it('upper-cases and underscore-strips a known category', () => {
    expect(prettyCategory('defensive_tactics')).toBe('DEFENSIVE TACTICS');
    expect(prettyCategory('first_aid')).toBe('FIRST AID');
    expect(prettyCategory('firearms')).toBe('FIREARMS');
  });
  it('returns em-dash for missing value', () => {
    expect(prettyCategory(undefined)).toBe('—');
    expect(prettyCategory(null)).toBe('—');
    expect(prettyCategory('')).toBe('—');
  });
});

describe('prettyStatus', () => {
  it('upper-cases and underscore-strips a status code', () => {
    expect(prettyStatus('in_progress')).toBe('IN PROGRESS');
    expect(prettyStatus('completed')).toBe('COMPLETED');
    expect(prettyStatus('overdue')).toBe('OVERDUE');
  });
  it('returns em-dash for missing value', () => {
    expect(prettyStatus(undefined)).toBe('—');
    expect(prettyStatus(null)).toBe('—');
    expect(prettyStatus('')).toBe('—');
  });
});

describe('formatScore', () => {
  it('formats numeric score as N / 100', () => {
    expect(formatScore(92)).toBe('92 / 100');
    expect(formatScore(0)).toBe('0 / 100');
  });
  it('returns em-dash for missing / non-numeric', () => {
    expect(formatScore(null)).toBe('—');
    expect(formatScore(undefined)).toBe('—');
    expect(formatScore(Number.NaN)).toBe('—');
  });
});

describe('formatRenewal', () => {
  it('special-cases common cadences', () => {
    expect(formatRenewal(12)).toBe('Annually');
    expect(formatRenewal(6)).toBe('Every 6 months');
    expect(formatRenewal(24)).toBe('Every 2 years');
    expect(formatRenewal(36)).toBe('Every 3 years');
  });
  it('returns "No renewal" for zero / missing / negative', () => {
    expect(formatRenewal(0)).toBe('No renewal');
    expect(formatRenewal(null)).toBe('No renewal');
    expect(formatRenewal(undefined)).toBe('No renewal');
    expect(formatRenewal(-1)).toBe('No renewal');
  });
  it('formats months > 12 as "Every N years" when divisible', () => {
    expect(formatRenewal(48)).toBe('Every 4 years');
    expect(formatRenewal(60)).toBe('Every 5 years');
  });
  it('falls back to "Every N months" for off-cycle cadences', () => {
    expect(formatRenewal(18)).toBe('Every 18 months');
    expect(formatRenewal(3)).toBe('Every 3 months');
  });
});

describe('expiryStatus', () => {
  const NOW = new Date('2026-06-22T12:00:00Z');
  it('returns "none" when no expiry date is set', () => {
    expect(expiryStatus({ status: 'completed' }, NOW)).toBe('none');
    expect(expiryStatus({ expiry_date: null, status: 'completed' }, NOW)).toBe('none');
  });
  it('returns "none" for scheduled / in_progress regardless of date', () => {
    expect(expiryStatus({ expiry_date: '2025-01-01', status: 'scheduled' }, NOW)).toBe('none');
    expect(expiryStatus({ expiry_date: '2025-01-01', status: 'in_progress' }, NOW)).toBe('none');
  });
  it('classifies "expired" when expiry is in the past', () => {
    expect(expiryStatus({ expiry_date: '2026-06-01', status: 'completed' }, NOW)).toBe('expired');
  });
  it('classifies "critical" within 30 days', () => {
    expect(expiryStatus({ expiry_date: '2026-07-10', status: 'completed' }, NOW)).toBe('critical');
  });
  it('classifies "warning" between 31 and 60 days', () => {
    expect(expiryStatus({ expiry_date: '2026-08-15', status: 'completed' }, NOW)).toBe('warning');
  });
  it('classifies "ok" beyond 60 days', () => {
    expect(expiryStatus({ expiry_date: '2027-01-01', status: 'completed' }, NOW)).toBe('ok');
  });
});

describe('needsAuditAlert', () => {
  it('fires when a "completed" record has neither cert # nor completion date', () => {
    expect(needsAuditAlert({ status: 'completed' })).toBe(true);
    expect(needsAuditAlert({ status: 'completed', certificate_number: '', completed_date: '' })).toBe(true);
  });
  it('clears when a certificate # is present', () => {
    expect(needsAuditAlert({ status: 'completed', certificate_number: 'CERT-001' })).toBe(false);
  });
  it('clears when a completion date is present', () => {
    expect(needsAuditAlert({ status: 'completed', completed_date: '2026-05-01' })).toBe(false);
  });
  it('does not fire for non-completed statuses', () => {
    expect(needsAuditAlert({ status: 'scheduled' })).toBe(false);
    expect(needsAuditAlert({ status: 'in_progress' })).toBe(false);
    expect(needsAuditAlert({ status: 'overdue' })).toBe(false);
  });
});

describe('isSubMinimumHours', () => {
  it('fires when hours < minimum for completed', () => {
    expect(isSubMinimumHours(
      { status: 'completed', hours: 3 },
      { minimum_hours: 8 },
    )).toBe(true);
  });
  it('clears when hours >= minimum', () => {
    expect(isSubMinimumHours(
      { status: 'completed', hours: 8 },
      { minimum_hours: 8 },
    )).toBe(false);
    expect(isSubMinimumHours(
      { status: 'completed', hours: 12 },
      { minimum_hours: 8 },
    )).toBe(false);
  });
  it('clears when hours are zero (no logged work, not sub-minimum)', () => {
    expect(isSubMinimumHours(
      { status: 'completed', hours: 0 },
      { minimum_hours: 8 },
    )).toBe(false);
  });
  it('does not fire when there is no requirement', () => {
    expect(isSubMinimumHours({ status: 'completed', hours: 3 }, null)).toBe(false);
    expect(isSubMinimumHours({ status: 'completed', hours: 3 }, undefined)).toBe(false);
  });
  it('does not fire when status is not completed', () => {
    expect(isSubMinimumHours(
      { status: 'in_progress', hours: 3 },
      { minimum_hours: 8 },
    )).toBe(false);
  });
});
