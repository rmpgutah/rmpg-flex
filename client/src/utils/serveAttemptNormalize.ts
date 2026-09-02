/** UI failed-reason values → structured PS codes (skip nested picker).
 *  Bad-address / moved stay explicit chip choices on the client; the server
 *  will not infer those terminal codes from a bare `result` field. */
export const FAILED_REASON_TO_PS: Record<string, string> = {
  no_answer: 'PS/00.01',
  refused: 'PS/00.25',
  wrong_address: 'PS/00.10',
  bad_address: 'PS/00.10',
  moved: 'PS/00.15',
  other: 'PS/00.99',
};

export function normalizeServeAttemptResult(result: string | null | undefined): string {
  if (result === 'wrong_address') return 'bad_address';
  return result || 'other';
}

export function defaultPsCodeForFailedReason(reason: string | null | undefined): string | undefined {
  if (!reason) return undefined;
  return FAILED_REASON_TO_PS[reason];
}
