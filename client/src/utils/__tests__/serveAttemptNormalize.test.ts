import { describe, it, expect } from 'vitest';
import {
  defaultPsCodeForFailedReason,
  normalizeServeAttemptResult,
} from '../serveAttemptNormalize';

describe('normalizeServeAttemptResult', () => {
  it('maps wizard wrong_address onto the server CHECK enum', () => {
    expect(normalizeServeAttemptResult('wrong_address')).toBe('bad_address');
  });
});

describe('defaultPsCodeForFailedReason', () => {
  it('auto-selects No Answer so the nested PS picker is optional', () => {
    expect(defaultPsCodeForFailedReason('no_answer')).toBe('PS/00.01');
  });
});
