import { apiFetch } from '../hooks/useApi';

export interface TokenResponse { token: string; identity: string; expiresAt: string }
export interface PresencePeer { id: string; name: string; agency: string; dnd: boolean }
export type DialerApiError = Error & { status?: number; code?: string };

const post = <T,>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const dialerApi = {
  fetchToken: () => post<TokenResponse | { ok: false; code: 'not_configured' }>('/dialer/token'),
  heartbeat: () => post<{ ok: true }>('/dialer/presence/heartbeat'),
  listPresence: () => apiFetch<PresencePeer[]>('/dialer/presence'),
  hold: (callSid: string, hold: boolean) => post<{ status: string }>('/dialer/voice/hold', { callSid, hold }),
  transfer: (callSid: string, targetDispatcherId: string) => post<{ status: string }>('/dialer/voice/transfer', { callSid, targetDispatcherId }),
  addDispatcher: (callSid: string, targetDispatcherId: string) => post<{ status: string }>('/dialer/voice/conference/add-dispatcher', { callSid, targetDispatcherId }),
  addParty: (callSid: string, phoneNumber: string) => post<{ status: string }>('/dialer/voice/conference/add', { callSid, phoneNumber }),
  recording: (callSid: string, action: 'start' | 'stop') => post<{ status: string }>('/dialer/voice/recording', { callSid, action }),
  duress: () => post<{ ok?: boolean }>('/dialer/voice/duress', {}),
  getDnd: () => apiFetch<{ dnd: boolean }>('/dialer/dnd'),
  setDnd: (dnd: boolean) => apiFetch<{ dnd: boolean }>('/dialer/dnd', { method: 'PATCH', body: JSON.stringify({ dnd }) }),
  archive: (payload: Record<string, unknown>) => post<unknown>('/dialer-connect/events', payload).catch(() => undefined),
};
