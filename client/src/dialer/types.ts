// Structural subset of @twilio/voice-sdk Device/Call that the provider uses,
// so MockDevice can stand in for tests without casts on the mock path.
export interface SoftphoneCall {
  parameters: { CallSid?: string; From?: string; To?: string };
  customParameters: Map<string, string>;
  on(event: string, listener: (...args: any[]) => void): unknown;
  accept(): void;
  reject(): void;
  disconnect(): void;
  mute(shouldMute: boolean): void;
  isMuted(): boolean;
  sendDigits(digits: string): void;
  removeAllListeners(event?: string): unknown;
}

export interface SoftphoneDevice {
  on(event: string, listener: (...args: any[]) => void): unknown;
  destroy(): void;
  register(): Promise<void>;
  updateToken(token: string): void;
  connect(opts: { params: Record<string, string> }): Promise<SoftphoneCall>;
}

export type DeviceFactory = (token: string) => SoftphoneDevice;

/** Caller's CallSid (matches dispatch-app CallLog.twilioCallSid), not this leg's. */
export function controlCallSid(call: SoftphoneCall | null): string | null {
  if (!call) return null;
  return call.customParameters.get('CallerCallSid') ?? call.parameters.CallSid ?? null;
}
