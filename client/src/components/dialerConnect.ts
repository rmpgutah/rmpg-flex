export const DIALER_CONNECT_PATH = '/dialer-connect';
export const DIALER_HOST_ID = 'dialer-connect-host';
/** Dispatched after a Dial Connect `recording_ready` postMessage. Listeners may
 *  be absent after the recordings panel was removed; the name stays exported
 *  because DialerPanel still fires it. */
export const DIAL_RECORDING_READY_EVENT = 'rmpg-flex:dial-recording-ready';

