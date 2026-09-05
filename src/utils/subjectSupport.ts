// ============================================================
// Subject-facing support channels — Worker-side mirror of
// client/src/constants/organizationConstants.ts `SUBJECT_SUPPORT`.
//
// The printed Notice of Attempt and the public verify response must advertise
// the SAME channels, so a recipient who scans the QR sees exactly what is on
// the paper. Keep the two in lockstep; tests/subjectSupport.test.ts pins it.
// ============================================================
export const SUBJECT_SUPPORT = {
  noticeInfoUrl: 'https://rmpgutahps.us/notice-of-attempt',
  supportUrl: 'https://rmpgutahps.us/support',
  email: 'server@rmpgutah.us',
  dispatchPhone: '(385) 340-6555',
  dispatchPhoneRoute: 'press 1, then 1, then 3',
} as const;

/** AGENCY REF ID contract shared with rmpgutahps.us: JOB-<serve_queue.id>. */
export const AGENCY_REF_RE = /^JOB-(\d{1,9})$/i;

export function parseAgencyRef(raw: string): { ref: string; jobId: number } | null {
  const m = AGENCY_REF_RE.exec((raw || '').trim());
  if (!m) return null;
  return { ref: `JOB-${m[1]}`, jobId: parseInt(m[1], 10) };
}
