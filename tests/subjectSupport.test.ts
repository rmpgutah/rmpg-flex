// The printed Notice of Attempt (client) and the public /api/verify response
// (Worker) must advertise identical support channels. The two constants live
// in separate builds with no shared import, so this test is the only thing
// that keeps them from drifting.
import { describe, it, expect } from 'vitest';
import { SUBJECT_SUPPORT, parseAgencyRef } from '../src/utils/subjectSupport';
import { SUBJECT_SUPPORT as CLIENT_SUBJECT_SUPPORT } from '../client/src/constants/organizationConstants';

describe('SUBJECT_SUPPORT — Worker/client lockstep', () => {
  it('matches the client constant field-for-field', () => {
    expect(SUBJECT_SUPPORT).toEqual(CLIENT_SUBJECT_SUPPORT);
  });
  it('uses only WinAnsi-safe characters (jsPDF Helvetica)', () => {
    for (const v of Object.values(SUBJECT_SUPPORT)) expect(v).toMatch(/^[\x20-\x7e]+$/);
  });
});

describe('parseAgencyRef — JOB-<id> contract with rmpgutahps.us', () => {
  it('accepts JOB-N case-insensitively and normalises', () => {
    expect(parseAgencyRef('job-122')).toEqual({ ref: 'JOB-122', jobId: 122 });
    expect(parseAgencyRef('  JOB-7 ')).toEqual({ ref: 'JOB-7', jobId: 7 });
  });
  it('rejects anything else', () => {
    for (const bad of ['', 'JOB-', 'JOB-abc', 'CFS26-00074', 'JOB-1; DROP', 'JOB-1234567890']) {
      expect(parseAgencyRef(bad)).toBeNull();
    }
  });
});
