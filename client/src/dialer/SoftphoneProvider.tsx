import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { normalizeDialTarget, DIALER_PLACE_CALL_EVENT } from '../components/dialerConnect';
import { SoftphoneContext, type SoftphoneContextValue } from './softphoneContext';
import { dialerApi, type DialerApiError } from './dialerApi';
import { createLeaderElection, isPopoutWindow } from './leaderElection';
import { RINGBACK_MAX_MS, setCallTone, stopCallTones } from './callTones';
import { INITIAL, reduce, type SoftphoneSnapshot } from './softphoneMachine';
import { controlCallSid, type DeviceFactory, type SoftphoneCall, type SoftphoneDevice } from './types';
import { useDialerStream } from './useDialerStream';

// dispatch-app treats a dispatcher as online for 150 s after the last beat;
// 20 s leaves room for background-tab timer throttling (~1/min) without flapping.
const HEARTBEAT_MS = 20_000;
const PSTN_FAILURE_STATUSES: Record<string, string> = {
  failed: 'The call could not be completed — the carrier rejected it. Try again.',
  busy: 'The line is busy.',
  'no-answer': 'No answer.',
};
const TOKEN_REFRESH_LEAD_MS = 5 * 60_000;
// Twilio CallStatus values (and the AMD `answered-by-*` synthetics the status
// webhook publishes alongside them) that mean the far end is NO LONGER
// ringing. Anything not listed — 'queued', 'initiated', 'ringing' — leaves the
// ringback running, so an unrecognised status can never cut a real ringback
// short; the RINGBACK_MAX_MS ceiling is what bounds the other direction.
const FAR_END_SETTLED = /^(in-progress|completed|busy|failed|no-answer|canceled|cancelled|answered-by-)/;

const Ctx = SoftphoneContext;
export { useSoftphone } from './softphoneContext';
export type { SoftphoneContextValue } from './softphoneContext';

async function realDeviceFactory(token: string): Promise<SoftphoneDevice> {
  const { Device } = await import('@twilio/voice-sdk');
  return new Device(token, { logLevel: 'error' }) as unknown as SoftphoneDevice;
}

export function SoftphoneProvider({ children, createDevice, enabled = true, streamEnabled = true }: {
  children: ReactNode; createDevice?: DeviceFactory; enabled?: boolean; streamEnabled?: boolean;
}) {
  const [snap, dispatch] = useReducer(reduce, INITIAL);
  const [dnd, setDndState] = useState<boolean | null>(null);
  const [lastDuress, setLastDuress] = useState<{ name: string; at: number } | null>(null);
  const deviceRef = useRef<SoftphoneDevice | null>(null);
  const activeCallRef = useRef<SoftphoneCall | null>(null);
  const waitingCallRef = useRef<SoftphoneCall | null>(null);
  const identityRef = useRef<string | null>(null);
  const expiresAtRef = useRef<number>(0);
  const refreshPendingRef = useRef(false);
  const startedAtRef = useRef<number>(0);
  const [, force] = useReducer((n: number) => n + 1, 0);

  const dispatcherId = () => identityRef.current?.replace(/^dispatcher_/, '') ?? '';

  // Server-pushed events: the PSTN leg of an outbound call is a separate Twilio
  // call this browser never sees, so a carrier rejection (SIP 5xx after ringing)
  // only reaches us here. Without this the dispatcher sits in an empty
  // conference hearing silence — the "dropped call" report.
  const registered = snap.status === 'ready' || snap.status === 'incoming' || snap.status === 'in_call' || snap.status === 'call_waiting';
  useDialerStream((e) => {
    if (e.type === 'duress_alert') {
      setLastDuress({ name: String((e as { dispatcherName?: string }).dispatcherName ?? 'A dispatcher'), at: Date.now() });
      return;
    }
    if (e.type !== 'call_status') return;
    const ev = e as { callSid?: string; status?: string };
    const active = activeCallRef.current;
    if (!active || !ev.callSid || ev.callSid !== controlCallSid(active)) return;
    if (ev.status && FAR_END_SETTLED.test(ev.status)) dispatch({ type: 'FAR_END', ringing: false });
    const failure = ev.status ? PSTN_FAILURE_STATUSES[ev.status] : undefined;
    if (failure) {
      dispatch({ type: 'ERROR', message: failure });
      active.disconnect();
    }
  }, streamEnabled && registered);

  const archive = useCallback((call: SoftphoneCall | null, status: string) => {
    if (!call) return;
    const callSid = call.parameters.CallSid ?? controlCallSid(call) ?? undefined;
    const from = call.parameters.From, to = call.parameters.To;
    const durationSeconds = startedAtRef.current ? Math.round((Date.now() - startedAtRef.current) / 1000) : undefined;
    void dialerApi.archive({ type: 'call_status', callSid, status, from, to, durationSeconds });
  }, []);

  const refreshToken = useCallback(async () => {
    const res = await dialerApi.fetchToken();
    if (!('token' in res)) throw Object.assign(new Error('Dial Connect not configured'), { code: 'not_configured' });
    identityRef.current = res.identity;
    expiresAtRef.current = Date.parse(res.expiresAt);
    deviceRef.current?.updateToken(res.token);
    return res.token;
  }, []);

  const attachCall = useCallback((call: SoftphoneCall, direction: 'inbound' | 'outbound') => {
    activeCallRef.current = call;
    call.on('accept', () => {
      startedAtRef.current = Date.now();
      dispatch({ type: 'ACCEPTED', callSid: controlCallSid(call), connectedAt: startedAtRef.current });
    });
    call.on('mute', (muted: boolean) => dispatch({ type: 'MUTED', muted }));
    // Status is decided when the call ENDS: a call that was ever connected is
    // 'completed'; otherwise it's the fallback (missed for inbound, failed for
    // errors, completed for an outbound leg Twilio ended before 'accept').
    const end = (fallback: string) => () => {
      if (activeCallRef.current !== call) return;
      archive(call, startedAtRef.current ? 'completed' : fallback);
      activeCallRef.current = null;
      startedAtRef.current = 0;
      call.removeAllListeners();
      dispatch({ type: 'DISCONNECTED' });
      if (refreshPendingRef.current) { refreshPendingRef.current = false; void refreshToken().catch(() => undefined); }
    };
    call.on('disconnect', end(direction === 'outbound' ? 'completed' : 'missed'));
    call.on('cancel', end('missed'));
    call.on('reject', end('missed'));
    call.on('error', (err: Error) => { dispatch({ type: 'ERROR', message: err.message }); end('failed')(); });
  }, [archive, refreshToken]);

  // ── Call-progress tones ────────────────────────────────────
  // An inbound call rings; an outbound call plays ringback until the PSTN leg
  // reports it has stopped ringing. Derived from the snapshot rather than
  // fired imperatively at each call site, so every path that ends a call
  // (accept, reject, cancel, carrier failure, leader hand-off, unmount)
  // silences the tone without having to remember to.
  const tone = snap.status === 'incoming' || snap.status === 'call_waiting'
    ? 'ring' as const
    : snap.outboundRinging ? 'ringback' as const : null;
  useEffect(() => { setCallTone(tone); }, [tone]);
  useEffect(() => () => stopCallTones(), []);

  // Ceiling on ringback. The stream is the authoritative "they picked up"
  // signal, but it is a network dependency: if it drops, nothing else ever
  // clears outboundRinging and the dispatcher hears ringback over a live
  // conversation. Past a normal PSTN no-answer window, stop assuming.
  useEffect(() => {
    if (!snap.outboundRinging) return;
    const id = setTimeout(() => dispatch({ type: 'FAR_END', ringing: false }), RINGBACK_MAX_MS);
    return () => clearTimeout(id);
  }, [snap.outboundRinging]);

  const register = useCallback(async () => {
    if (!enabled) { dispatch({ type: 'PASSIVE' }); return; }
    dispatch({ type: 'REGISTERING' });
    let token: string;
    try {
      token = await refreshToken();
    } catch (err) {
      const e = err as DialerApiError;
      if (e.code === 'dialer_unlinked') { dispatch({ type: 'UNLINKED' }); return; }
      dispatch({ type: 'ERROR', message: e.code === 'not_configured' ? 'Dial Connect is not configured' : e.message || 'Could not reach Dial Connect' });
      return;
    }
    const device = createDevice ? createDevice(token) : await realDeviceFactory(token);
    deviceRef.current = device;
    device.on('registered', () => dispatch({ type: 'REGISTERED' }));
    device.on('error', (err: Error) => dispatch({ type: 'ERROR', message: err.message }));
    device.on('incoming', (call: SoftphoneCall) => {
      const from = call.parameters.From ?? call.customParameters.get('To') ?? 'unknown';
      if (activeCallRef.current) {
        waitingCallRef.current = call;
        call.on('cancel', () => { waitingCallRef.current = null; dispatch({ type: 'WAITING_CANCELLED' }); });
        dispatch({ type: 'INCOMING', from, callSid: controlCallSid(call) });
        return;
      }
      attachCall(call, 'inbound');
      dispatch({ type: 'INCOMING', from, callSid: controlCallSid(call) });
    });
    try { await device.register(); } catch (err) { dispatch({ type: 'ERROR', message: (err as Error).message }); }
    dialerApi.getDnd().then((r) => setDndState(Boolean(r.dnd))).catch(() => undefined);
  }, [enabled, createDevice, refreshToken, attachCall]);

  useEffect(() => {
    void register();
    return () => { deviceRef.current?.destroy(); deviceRef.current = null; };
  }, [register]);

  // One registered Twilio client per dispatcher: a pop-out window takes over
  // and every other window goes passive until the pop-out closes.
  useEffect(() => {
    const election = createLeaderElection({
      isPopout: isPopoutWindow(),
      onBecomeFollower: () => { deviceRef.current?.destroy(); deviceRef.current = null; dispatch({ type: 'PASSIVE' }); },
      onBecomeLeader: () => { dispatch({ type: 'RESET' }); void register(); },
    });
    return () => election.close();
  }, [register]);

  // Presence heartbeat + proactive token refresh (deferred while a call is live).
  useEffect(() => {
    const id = setInterval(() => {
      if (!deviceRef.current) return;
      void dialerApi.heartbeat().catch(() => undefined);
      if (expiresAtRef.current && Date.now() > expiresAtRef.current - TOKEN_REFRESH_LEAD_MS) {
        if (activeCallRef.current) refreshPendingRef.current = true;
        else void refreshToken().catch(() => undefined);
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [refreshToken]);

  const dial = useCallback(async (raw: string, opts?: { blockCallerId?: boolean }) => {
    const device = deviceRef.current;
    const to = normalizeDialTarget(raw);
    if (!device || !to || activeCallRef.current) return;
    dispatch({ type: 'DIALING', to });
    const call = await device.connect({ params: { To: to, DispatcherId: dispatcherId(), CallerIdBlocked: opts?.blockCallerId ? 'true' : 'false' } });
    call.parameters.To = call.parameters.To ?? to;
    attachCall(call, 'outbound');
  }, [attachCall]);

  useEffect(() => {
    const onPlace = (event: Event) => {
      const to = (event as CustomEvent<{ to?: string }>).detail?.to;
      if (typeof to === 'string') void dial(to);
    };
    window.addEventListener(DIALER_PLACE_CALL_EVENT, onPlace);
    return () => window.removeEventListener(DIALER_PLACE_CALL_EVENT, onPlace);
  }, [dial]);

  // A refused control action (hold/transfer/recording) is NOT a device failure:
  // the call is still up, so it reports as a dismissible notice and every button
  // stays live. Dispatching ERROR here used to flip the machine to 'error',
  // which disabled Hang up / Mute / Hold mid-call on a call that was still
  // connected — the dispatcher could neither control nor end it.
  const withSid = useCallback(async (fn: (sid: string) => Promise<unknown>) => {
    const sid = controlCallSid(activeCallRef.current);
    if (!sid) {
      dispatch({ type: 'CONTROL_FAILED', message: 'Call control is not available yet — the call has no Twilio CallSid.' });
      return;
    }
    try { await fn(sid); } catch (err) { dispatch({ type: 'CONTROL_FAILED', message: (err as Error).message || 'That action was refused.' }); }
  }, []);

  const value = useMemo<SoftphoneContextValue>(() => ({
    ...snap,
    identity: identityRef.current,
    dial,
    answer: () => {
      const waiting = waitingCallRef.current;
      if (waiting && activeCallRef.current) {
        activeCallRef.current.disconnect();
        waitingCallRef.current = null;
        attachCall(waiting, 'inbound');
        waiting.accept();
        return;
      }
      activeCallRef.current?.accept();
    },
    reject: () => { (waitingCallRef.current ?? activeCallRef.current)?.reject(); },
    hangup: () => activeCallRef.current?.disconnect(),
    setMuted: (m) => activeCallRef.current?.mute(m),
    sendDigits: (d) => activeCallRef.current?.sendDigits(d),
    toggleHold: () => withSid(async (sid) => { await dialerApi.hold(sid, !snap.held); dispatch({ type: 'HELD', held: !snap.held }); }),
    transferBlind: (target) => withSid((sid) => dialerApi.transfer(sid, target)),
    transferWarm: (target) => withSid((sid) => dialerApi.addDispatcher(sid, target)),
    addParty: (phone) => withSid((sid) => dialerApi.addParty(sid, phone)),
    toggleRecording: () => withSid(async (sid) => { await dialerApi.recording(sid, snap.recording ? 'stop' : 'start'); dispatch({ type: 'RECORDING', recording: !snap.recording }); }),
    duress: async () => { try { await dialerApi.duress(); } catch (err) { dispatch({ type: 'CONTROL_FAILED', message: (err as Error).message }); } },
    dismissNotice: () => dispatch({ type: 'NOTICE_CLEARED' }),
    retry: () => { deviceRef.current?.destroy(); deviceRef.current = null; dispatch({ type: 'RESET' }); force(); void register(); },
    dnd,
    setDnd: async (next) => {
      try { const r = await dialerApi.setDnd(next); setDndState(Boolean(r.dnd)); }
      catch (err) { dispatch({ type: 'CONTROL_FAILED', message: (err as Error).message }); }
    },
    lastDuress,
  }), [snap, dial, withSid, attachCall, register, dnd, lastDuress]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
