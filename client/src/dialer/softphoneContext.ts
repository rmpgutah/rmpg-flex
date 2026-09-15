import { createContext, useContext } from 'react';
import type { SoftphoneSnapshot } from './softphoneMachine';

// Kept as a literal (not imported from softphoneMachine) so this module stays
// a few hundred bytes — it is the only softphone code in the SPA entry chunk.
const INITIAL: SoftphoneSnapshot = {
  status: 'offline', error: null, callSid: null, remoteNumber: null, direction: null,
  connectedAt: null, muted: false, held: false, recording: false, waitingFrom: null,
};

export interface SoftphoneContextValue extends SoftphoneSnapshot {
  identity: string | null;
  dial(to: string, opts?: { blockCallerId?: boolean }): Promise<void>;
  answer(): void;
  reject(): void;
  hangup(): void;
  setMuted(muted: boolean): void;
  toggleHold(): Promise<void>;
  sendDigits(digits: string): void;
  transferBlind(targetDispatcherId: string): Promise<void>;
  transferWarm(targetDispatcherId: string): Promise<void>;
  addParty(phoneNumber: string): Promise<void>;
  toggleRecording(): Promise<void>;
  duress(): Promise<void>;
  retry(): void;
  /** Do Not Disturb on the dispatch-app side: null until known. While true, inbound calls skip this dispatcher. */
  dnd: boolean | null;
  setDnd(dnd: boolean): Promise<void>;
  lastDuress: { name: string; at: number } | null;
}

const noop = () => {};
const noopAsync = async () => {};

// What consumers see before the lazily-loaded runtime has mounted (or under
// the iframe kill-switch, where there is no native softphone at all).
export const LOADING_VALUE: SoftphoneContextValue = {
  ...INITIAL,
  status: 'registering',
  identity: null,
  dial: noopAsync, answer: noop, reject: noop, hangup: noop, setMuted: noop,
  toggleHold: noopAsync, sendDigits: noop, transferBlind: noopAsync, transferWarm: noopAsync,
  addParty: noopAsync, toggleRecording: noopAsync, duress: noopAsync, retry: noop,
  dnd: null, setDnd: noopAsync, lastDuress: null,
};

export const SoftphoneContext = createContext<SoftphoneContextValue>(LOADING_VALUE);

export function useSoftphone(): SoftphoneContextValue {
  return useContext(SoftphoneContext);
}
