export const DIALER_ORIGIN = 'https://dialer.rmpgutah.us';
/** Authenticated Dial Connect app. `/dialer-embed` is cookieless and cannot
 *  register the dispatcher's Twilio Voice Client — inbound then fails over
 *  to voicemail with nothing to Answer. */
export const DIALER_APP_URL = `${DIALER_ORIGIN}/dialer`;
export const DIALER_CONNECT_PATH = '/dialer-connect';
export const DIALER_HOST_ID = 'dialer-connect-host';
export const DIALER_PLACE_CALL_EVENT = 'rmpg-flex:place-call';
