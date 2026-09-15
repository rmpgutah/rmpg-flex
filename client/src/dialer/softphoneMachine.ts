export type SoftphoneStatus =
  | 'offline' | 'unlinked' | 'passive' | 'registering' | 'ready'
  | 'incoming' | 'in_call' | 'call_waiting' | 'error';

export interface SoftphoneSnapshot {
  status: SoftphoneStatus;
  /** Fatal: the softphone is unusable until `retry` (device/registration/carrier). */
  error: string | null;
  /**
   * Non-fatal: one control action (hold, transfer, recording, DND…) was refused
   * upstream. The call is still live and every control stays usable — never
   * promote one of these to `error`, which tears the in-call UI down.
   */
  notice: string | null;
  callSid: string | null;
  remoteNumber: string | null;
  direction: 'inbound' | 'outbound' | null;
  connectedAt: number | null;
  muted: boolean;
  held: boolean;
  recording: boolean;
  waitingFrom: string | null;
  /**
   * The far end of an OUTBOUND call is still ringing — drives the ringback
   * tone. Deliberately NOT derived from `connectedAt`: the dispatcher's own
   * leg joins the conference the instant the call is placed, so `ACCEPTED`
   * fires long before the callee picks up. Only the PSTN leg's server-pushed
   * `call_status` events (or a hang-up) can clear this.
   */
  outboundRinging: boolean;
}

export type SoftphoneEvent =
  | { type: 'REGISTERING' }
  | { type: 'REGISTERED' }
  | { type: 'UNLINKED' }
  | { type: 'PASSIVE' }
  | { type: 'ERROR'; message: string }
  | { type: 'CONTROL_FAILED'; message: string }
  | { type: 'NOTICE_CLEARED' }
  | { type: 'INCOMING'; from: string; callSid: string | null }
  | { type: 'DIALING'; to: string }
  | { type: 'ACCEPTED'; callSid: string | null; connectedAt: number }
  | { type: 'MUTED'; muted: boolean }
  | { type: 'HELD'; held: boolean }
  | { type: 'RECORDING'; recording: boolean }
  | { type: 'FAR_END'; ringing: boolean }
  | { type: 'WAITING_CANCELLED' }
  | { type: 'DISCONNECTED' }
  | { type: 'RESET' };

export const INITIAL: SoftphoneSnapshot = {
  status: 'offline', error: null, notice: null, callSid: null, remoteNumber: null, direction: null,
  connectedAt: null, muted: false, held: false, recording: false, waitingFrom: null,
  outboundRinging: false,
};

const CLEARED_CALL = {
  notice: null,
  callSid: null, remoteNumber: null, direction: null, connectedAt: null,
  muted: false, held: false, recording: false, waitingFrom: null, outboundRinging: false,
} as const;

export function reduce(s: SoftphoneSnapshot, e: SoftphoneEvent): SoftphoneSnapshot {
  switch (e.type) {
    case 'REGISTERING': return { ...s, status: 'registering', error: null };
    case 'REGISTERED': return { ...s, status: 'ready', error: null };
    case 'UNLINKED': return { ...INITIAL, status: 'unlinked' };
    case 'PASSIVE': return { ...INITIAL, status: 'passive' };
    // A fatal error ends any ringing far end — leaving the ringback looping
    // under an error banner is the "dropped call" report all over again.
    case 'ERROR': return { ...s, status: 'error', error: e.message, notice: null, outboundRinging: false };
    case 'CONTROL_FAILED': return { ...s, notice: e.message };
    case 'NOTICE_CLEARED': return { ...s, notice: null };
    case 'INCOMING':
      if (s.status === 'in_call' || s.status === 'call_waiting') return { ...s, status: 'call_waiting', waitingFrom: e.from };
      return { ...s, status: 'incoming', remoteNumber: e.from, callSid: e.callSid, direction: 'inbound', outboundRinging: false };
    case 'DIALING': return { ...s, ...CLEARED_CALL, status: 'in_call', remoteNumber: e.to, direction: 'outbound', outboundRinging: true };
    case 'ACCEPTED': return { ...s, status: 'in_call', callSid: e.callSid ?? s.callSid, connectedAt: e.connectedAt, waitingFrom: null };
    case 'MUTED': return { ...s, muted: e.muted };
    case 'HELD': return { ...s, held: e.held };
    case 'RECORDING': return { ...s, recording: e.recording };
    case 'FAR_END': return { ...s, outboundRinging: e.ringing };
    case 'WAITING_CANCELLED': return { ...s, status: 'in_call', waitingFrom: null };
    case 'DISCONNECTED':
      return {
        ...s, ...CLEARED_CALL,
        status: s.status === 'unlinked' || s.status === 'passive' || s.status === 'offline' ? s.status : 'ready',
      };
    case 'RESET': return INITIAL;
  }
}
