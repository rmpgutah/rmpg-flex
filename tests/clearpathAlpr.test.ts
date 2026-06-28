// ============================================================
// RMPG Flex — ClearPath dashcam ALPR capture-trust policy
// ============================================================
// Regression guard for the "false 100% capture" bug: the dashcam scanner used
// to persist the vision model's SELF-REPORTED confidence (Llama 3.2 11B emits
// "confidence": 1 constantly) straight into alpr_captures.confidence /
// plate_confidence, and that fabricated 1.0 surfaced in the forensic player as a
// "100%" positive ID. The fix routes every capture through `captureTrust`, which
// stores DERIVED trust (plateTrust.trustScore) instead — a lone dashcam read is
// hard-capped below the 0.85 accept gate, so it can never auto-accept at 1.0.
// ============================================================
import { describe, it, expect } from 'vitest';
import { captureTrust } from '../src/utils/clearpathAlpr';
import { ALPR_ACCEPT_CONFIDENCE } from '../src/utils/roboflowAlpr';

describe('captureTrust — dashcam capture persistence policy', () => {
  it('a single read with a self-reported 1.0 is NOT persisted as 1.0 and NOT accepted', () => {
    // This is the exact bug: model said "100%" for plate 6HJX445.
    const ct = captureTrust('6HJX445', 1.0);
    expect(ct.plateConfidence).not.toBe(1);
    expect(ct.plateConfidence).toBeLessThan(ALPR_ACCEPT_CONFIDENCE);
    expect(ct.accepted).toBe(false);
    expect(ct.reviewStatus).toBe('needs_review');
    // raw model self-report preserved for forensics, never used as the trust signal.
    expect(ct.modelConfidence).toBe(1);
  });

  it('a format-VALID single read still cannot auto-accept (no corroboration)', () => {
    // 123ABC matches the Utah \d{3}[A-Z]{3} grammar → high format score, but a lone
    // read is capped at 0.84 by trustScore, below the 0.85 accept gate.
    const ct = captureTrust('123ABC', 0.99);
    expect(ct.plateConfidence).toBeLessThanOrEqual(0.84);
    expect(ct.accepted).toBe(false);
    expect(ct.reviewStatus).toBe('needs_review');
  });

  it('no plate → no_plate, no fabricated confidence', () => {
    const ct = captureTrust(null, 1.0);
    expect(ct.accepted).toBe(false);
    expect(ct.reviewStatus).toBe('no_plate');
    expect(ct.plateConfidence).toBeNull();
  });

  it('a missing model confidence does not crash and yields derived trust', () => {
    const ct = captureTrust('6HJX445', null);
    expect(ct.plateConfidence).toBeGreaterThan(0);
    expect(ct.plateConfidence).toBeLessThan(ALPR_ACCEPT_CONFIDENCE);
    expect(ct.modelConfidence).toBeNull();
  });
});
