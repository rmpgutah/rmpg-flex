import { describe, it, expect } from 'vitest';
import { isEvidenceLocked, evidenceLockReason, EVIDENCE_HOLD_VALUES } from '../evidenceLock';

describe('evidenceLock', () => {
  describe('positive hold-list semantics', () => {
    // The 2026-06-21 follow-up audit caught that PR #1476's negative
    // check ("anything != 'active' is locked") blocked the lawful
    // retention-purge of 'expired' videos. These tests enforce the new
    // positive semantics so the regression cannot return silently.
    it('returns false for active (the most common case)', () => {
      expect(isEvidenceLocked('active')).toBe(false);
    });

    it('returns false for expired (lawful destruction must be permitted)', () => {
      // 'expired' = retention period elapsed; the server retention
      // dashboard treats it as eligible_for_purge.
      expect(isEvidenceLocked('expired')).toBe(false);
    });

    it('returns false for archived', () => {
      expect(isEvidenceLocked('archived')).toBe(false);
    });

    it('returns false for purged', () => {
      expect(isEvidenceLocked('purged')).toBe(false);
    });

    it('returns false for pending_deletion (the destruction workflow itself)', () => {
      expect(isEvidenceLocked('pending_deletion')).toBe(false);
    });

    it('returns true for legal_hold', () => {
      expect(isEvidenceLocked('legal_hold')).toBe(true);
    });

    it('returns true for court_hold', () => {
      expect(isEvidenceLocked('court_hold')).toBe(true);
    });

    it('returns true for ia_review', () => {
      expect(isEvidenceLocked('ia_review')).toBe(true);
    });

    it('returns true for open_case', () => {
      expect(isEvidenceLocked('open_case')).toBe(true);
    });

    it('returns true for litigation_hold', () => {
      expect(isEvidenceLocked('litigation_hold')).toBe(true);
    });

    it('returns true for subpoena_hold', () => {
      expect(isEvidenceLocked('subpoena_hold')).toBe(true);
    });
  });

  describe('input robustness', () => {
    it('returns false for null', () => {
      expect(isEvidenceLocked(null)).toBe(false);
    });

    it('returns false for undefined (a missing field stays deletable)', () => {
      expect(isEvidenceLocked(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isEvidenceLocked('')).toBe(false);
    });

    it('returns false for unknown value (default-deletable)', () => {
      expect(isEvidenceLocked('something_new_and_unrecognized')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isEvidenceLocked('LEGAL_HOLD')).toBe(true);
      expect(isEvidenceLocked('Legal_Hold')).toBe(true);
    });

    it('trims whitespace', () => {
      expect(isEvidenceLocked('  legal_hold  ')).toBe(true);
    });
  });

  describe('evidenceLockReason', () => {
    it('returns undefined for non-hold values', () => {
      expect(evidenceLockReason('active')).toBeUndefined();
      expect(evidenceLockReason('expired')).toBeUndefined();
      expect(evidenceLockReason(null)).toBeUndefined();
      expect(evidenceLockReason(undefined)).toBeUndefined();
    });

    it('returns a reason string for known holds', () => {
      expect(evidenceLockReason('legal_hold')).toMatch(/legal hold/i);
      expect(evidenceLockReason('court_hold')).toMatch(/court/i);
      expect(evidenceLockReason('ia_review')).toMatch(/internal affairs/i);
      expect(evidenceLockReason('open_case')).toMatch(/case/i);
    });
  });

  it('EVIDENCE_HOLD_VALUES is non-empty and includes the canonical holds', () => {
    expect(EVIDENCE_HOLD_VALUES.has('legal_hold')).toBe(true);
    expect(EVIDENCE_HOLD_VALUES.has('court_hold')).toBe(true);
    expect(EVIDENCE_HOLD_VALUES.has('ia_review')).toBe(true);
    expect(EVIDENCE_HOLD_VALUES.has('open_case')).toBe(true);
    // 'active' must NOT be in the hold set — that was the bug.
    expect(EVIDENCE_HOLD_VALUES.has('active')).toBe(false);
    expect(EVIDENCE_HOLD_VALUES.has('expired')).toBe(false);
  });
});
