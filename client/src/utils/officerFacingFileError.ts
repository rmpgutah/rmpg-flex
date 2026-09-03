/** Map Worker encryption/config failures to an officer-facing message. */
export function officerFacingFileError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : fallback;
  if (/FILE_ENCRYPTION_KEK|ENCRYPTION_FAILED|wrangler secret|File encryption is not configured|key may have changed/i.test(msg)) {
    return 'File storage is temporarily unavailable. Contact a supervisor.';
  }
  return msg;
}
