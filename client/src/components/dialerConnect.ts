export const DIALER_CONNECT_PATH = '/dialer-connect';
export const DIALER_HOST_ID = 'dialer-connect-host';
/** Fired after Dial Connect posts a recording into Flex so the page list refreshes. */
export const DIAL_RECORDING_READY_EVENT = 'rmpg-flex:dial-recording-ready';
/** Any page can ask the softphone to place a call: `new CustomEvent(DIALER_PLACE_CALL_EVENT, { detail: { to } })`. */
export const DIALER_PLACE_CALL_EVENT = 'rmpg-flex:place-call';

export function normalizeDialTarget(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) return trimmed.replace(/[^\d+]/g, '');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return digits ? `+${digits}` : '';
}

