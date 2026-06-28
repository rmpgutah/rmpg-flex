// verifyResultDisplay — maps a /api/wallet/verify result to the banner the
// scanner shows. Pure + unit-tested: this is the security-facing judgement the
// verifying officer acts on, so the wording must be unambiguous (a REVOKED badge
// must never look merely "expired", and an expired QR — a stale screenshot —
// must read as "rescan", not "fake").

export type VerifyReason =
  | 'ok'
  | 'revoked'
  | 'inactive_officer'
  | 'expired'
  | 'bad_signature'
  | 'malformed'
  | 'not_found'
  | 'missing_token';

export interface VerifyResult {
  valid: boolean;
  reason: VerifyReason;
  officer?: unknown;
}

export type VerifyTone = 'valid' | 'invalid' | 'expired';

export interface VerifyDisplay {
  tone: VerifyTone;
  banner: string;
  detail: string;
}

export function verifyResultDisplay(result: VerifyResult): VerifyDisplay {
  if (result.valid) {
    return { tone: 'valid', banner: 'VALID', detail: 'Active RMPG officer in good standing.' };
  }
  switch (result.reason) {
    case 'revoked':
      return { tone: 'invalid', banner: 'REVOKED', detail: 'This credential has been revoked by an administrator.' };
    case 'inactive_officer':
      return { tone: 'invalid', banner: 'INACTIVE OFFICER', detail: 'This officer is no longer active.' };
    case 'expired':
      return { tone: 'expired', banner: 'EXPIRED — RESCAN', detail: 'The QR code has expired (it rotates). Ask the officer to refresh their badge and rescan.' };
    default:
      return { tone: 'invalid', banner: 'NOT A VALID ID', detail: 'This code is not a recognized RMPG officer ID.' };
  }
}
