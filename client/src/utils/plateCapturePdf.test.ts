import { describe, it, expect } from 'vitest';
import {
  sourceLabel, reviewStatusLabel, needsVerificationAlert, vehicleSummary, trustLine,
} from './plateCapturePdf';

describe('plateCapturePdf helpers', () => {
  it('sourceLabel pretty-prints known codes', () => {
    expect(sourceLabel('dashcam')).toBe('DASHCAM (ClearPath)');
    expect(sourceLabel('field')).toBe('FIELD CAMERA');
    expect(sourceLabel('manual')).toBe('MANUAL ENTRY');
    expect(sourceLabel(null)).toBe('—');
    expect(sourceLabel(undefined)).toBe('—');
    expect(sourceLabel('iot_camera')).toBe('IOT_CAMERA');
  });

  it('reviewStatusLabel matches the on-screen labels', () => {
    expect(reviewStatusLabel('confirmed')).toBe('Confirmed');
    expect(reviewStatusLabel('confirmed_unlinked')).toBe('Confirmed (record not linked)');
    expect(reviewStatusLabel('needs_review')).toBe('Needs Review');
    expect(reviewStatusLabel('rejected')).toBe('Rejected');
    expect(reviewStatusLabel(null)).toBe('—');
  });

  it('needsVerificationAlert fires for held / unreviewed captures', () => {
    expect(needsVerificationAlert({ review_status: 'needs_review' })).toBe(true);
    expect(needsVerificationAlert({ review_status: null, accepted: false })).toBe(true);
    expect(needsVerificationAlert({ review_status: 'rejected' })).toBe(true);
    // Rejected captures fire the banner too — a rejected read in a court file
    // is itself the message: this is a rejected read, do not rely on it.
  });

  it('needsVerificationAlert clears for confirmed reads', () => {
    expect(needsVerificationAlert({ review_status: 'confirmed' })).toBe(false);
    expect(needsVerificationAlert({ review_status: 'confirmed_unlinked' })).toBe(false);
    expect(needsVerificationAlert({ accepted: true })).toBe(false);
    expect(needsVerificationAlert({ accepted: 1 })).toBe(false);
  });

  it('vehicleSummary joins color/year/make/model and falls back to vehicleType', () => {
    expect(vehicleSummary({ color: 'RED', year: 2019, make: 'FORD', model: 'F150' }))
      .toBe('RED 2019 FORD F150');
    expect(vehicleSummary({ make: 'TOYT' })).toBe('TOYT');
    expect(vehicleSummary({ vehicle_type: 'SEDAN' })).toBe('SEDAN');
    expect(vehicleSummary({})).toBe('—');
    // Blank-string year shouldn't render — guard against the live shape that
    // stores year as '' rather than null on some rows.
    expect(vehicleSummary({ make: 'HOND', year: '' })).toBe('HOND');
  });

  it('trustLine prefers derived trust_score over raw confidence', () => {
    expect(trustLine({ trust_score: 0.82, read_count: 3, trust_basis: 'consensus' }))
      .toBe('82% consensus (3 reads)');
    expect(trustLine({ trust_score: 0.72, read_count: 1 }))
      .toBe('72% single read');
    expect(trustLine({ plate_confidence: 0.65 })).toBe('65% single read');
    expect(trustLine({})).toBe('—');
  });
});
