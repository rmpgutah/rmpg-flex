import type { SoftphoneCall, SoftphoneDevice } from './types';

type Listener = (...args: any[]) => void;
class Emitter {
  private listeners = new Map<string, Listener[]>();
  on(event: string, l: Listener) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), l]); return this; }
  emit(event: string, ...args: any[]) { for (const l of this.listeners.get(event) ?? []) l(...args); }
  removeAllListeners(event?: string) { if (event) this.listeners.delete(event); else this.listeners.clear(); return this; }
}

export class MockCall extends Emitter implements SoftphoneCall {
  parameters: { CallSid?: string; From?: string; To?: string };
  customParameters = new Map<string, string>();
  accepted = false; rejected = false; disconnected = false; muted = false; digits = '';
  constructor(params: { CallSid?: string; From?: string; To?: string }, custom: Record<string, string> = {}) {
    super();
    this.parameters = params;
    for (const [k, v] of Object.entries(custom)) this.customParameters.set(k, v);
  }
  accept() { this.accepted = true; this.emit('accept', this); }
  reject() { this.rejected = true; this.emit('reject'); }
  disconnect() { this.disconnected = true; this.emit('disconnect', this); }
  mute(m: boolean) { this.muted = m; this.emit('mute', m, this); }
  isMuted() { return this.muted; }
  sendDigits(d: string) { this.digits += d; }
}

export class MockDevice extends Emitter implements SoftphoneDevice {
  token: string;
  destroyed = false;
  registered = false;
  connectParams: Record<string, string> | null = null;
  lastCall: MockCall | null = null;
  constructor(token: string) { super(); this.token = token; }
  async register() { this.registered = true; this.emit('registered'); }
  updateToken(token: string) { this.token = token; }
  destroy() { this.destroyed = true; this.emit('destroyed'); }
  async connect(opts: { params: Record<string, string> }) {
    this.connectParams = opts.params;
    this.lastCall = new MockCall({ CallSid: 'CAoutbound', To: opts.params.To });
    return this.lastCall;
  }
  simulateIncoming(from: string, callerCallSid = 'CAcaller'): MockCall {
    const call = new MockCall({ CallSid: 'CAleg', From: from }, { CallerCallSid: callerCallSid });
    this.lastCall = call;
    this.emit('incoming', call);
    return call;
  }
}
