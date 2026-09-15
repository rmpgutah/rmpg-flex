// Wiring between softphone state and the call-progress tones: an inbound call
// rings, an outbound call plays ringback until the FAR end answers, and both
// stop on hang-up. The tone module itself is unit-tested in callTones.test.ts;
// here it is mocked so the assertions are purely about when it is driven.
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { SoftphoneProvider } from './SoftphoneProvider';
import { MockDevice } from './mockDevice';

const apiFetch = vi.fn();
vi.mock('../hooks/useApi', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const setCallTone = vi.fn();
const stopCallTones = vi.fn();
vi.mock('./callTones', () => ({
  setCallTone: (...a: unknown[]) => setCallTone(...a),
  stopCallTones: () => stopCallTones(),
  RINGBACK_MAX_MS: 60_000,
}));

let device: MockDevice | null = null;
const createDevice = (token: string) => { device = new MockDevice(token); return device; };

/** The most recent tone asserted, ignoring idempotent repeats. */
const lastTone = () => {
  const calls = setCallTone.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : undefined;
};

beforeEach(() => {
  device = null;
  localStorage.clear();
  setCallTone.mockReset();
  stopCallTones.mockReset();
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/dialer/token') return { token: 'tok', identity: 'dispatcher_abc', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
    return {};
  });
});

async function mount() {
  render(<SoftphoneProvider createDevice={createDevice} streamEnabled={false}><div /></SoftphoneProvider>);
  await waitFor(() => expect(device?.registered).toBe(true));
  return device!;
}

describe('call-progress tone wiring', () => {
  test('an inbound call rings, and answering it stops the ring', async () => {
    const dev = await mount();
    await act(async () => { dev.simulateIncoming('+18015551212'); });
    expect(lastTone()).toBe('ring');

    await act(async () => { dev.lastCall!.accept(); });
    expect(lastTone()).toBeNull();
  });

  test('a cancelled inbound call stops the ring', async () => {
    const dev = await mount();
    await act(async () => { dev.simulateIncoming('+18015551212'); });
    expect(lastTone()).toBe('ring');
    await act(async () => { dev.lastCall!.emit('cancel'); });
    expect(lastTone()).toBeNull();
  });

  test('an outbound call plays ringback until the far end answers', async () => {
    const dev = await mount();
    // Dial through the provider's own public surface via the place-call event
    // the rest of the app uses, so this exercises the real path.
    await act(async () => {
      window.dispatchEvent(new CustomEvent('rmpg-flex:place-call', { detail: { to: '8015551212' } }));
    });
    await waitFor(() => expect(dev.connectParams?.To).toBeTruthy());
    expect(lastTone()).toBe('ringback');

    // The dispatcher's OWN leg joining the conference must not stop ringback —
    // the callee has not picked up yet.
    await act(async () => { dev.lastCall!.accept(); });
    expect(lastTone()).toBe('ringback');
  });

  test('ringback stops when the PSTN leg reports it is no longer ringing', async () => {
    const dev = await mount();
    await act(async () => {
      window.dispatchEvent(new CustomEvent('rmpg-flex:place-call', { detail: { to: '8015551212' } }));
    });
    await waitFor(() => expect(lastTone()).toBe('ringback'));
    await act(async () => { dev.lastCall!.disconnect(); });
    expect(lastTone()).toBeNull();
  });
});
