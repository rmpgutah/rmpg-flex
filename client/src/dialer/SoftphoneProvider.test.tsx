import { describe, test, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { SoftphoneProvider, useSoftphone } from './SoftphoneProvider';
import { MockDevice } from './mockDevice';

const apiFetch = vi.fn();
vi.mock('../hooks/useApi', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

let device: MockDevice | null = null;
const createDevice = (token: string) => { device = new MockDevice(token); return device; };

function Probe() {
  const s = useSoftphone();
  return (
    <div>
      <span data-testid="status">{s.status}</span>
      <span data-testid="remote">{s.remoteNumber ?? ''}</span>
      <span data-testid="error">{s.error ?? ''}</span>
      <button onClick={() => { void s.dial('8015551212'); }}>dial</button>
      <button onClick={() => s.answer()}>answer</button>
      <button onClick={() => s.hangup()}>hangup</button>
      <button onClick={() => { void s.toggleHold(); }}>hold</button>
    </div>
  );
}
const renderProbe = () => render(<SoftphoneProvider createDevice={createDevice}><Probe /></SoftphoneProvider>);

beforeEach(() => {
  device = null;
  localStorage.clear();
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/dialer/token') return { token: 'tok', identity: 'dispatcher_abc', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
    if (path === '/dialer/presence/heartbeat') return { ok: true };
    if (path === '/dialer/voice/hold') return { status: 'held' };
    if (path === '/dialer-connect/events') return { ok: true };
    return {};
  });
});

describe('SoftphoneProvider', () => {
  test('fetches a token, registers the device and becomes ready', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(device?.token).toBe('tok');
    expect(apiFetch).toHaveBeenCalledWith('/dialer/token', expect.objectContaining({ method: 'POST' }));
  });

  test('shows unlinked when the Worker returns dialer_unlinked', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/dialer/token') { const e = Object.assign(new Error('not linked'), { status: 409, code: 'dialer_unlinked' }); throw e; }
      return {};
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unlinked'));
    expect(device).toBeNull();
  });

  test('dials via Device.connect with To/DispatcherId and archives on disconnect', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    await act(async () => { screen.getByText('dial').click(); });
    expect(device!.connectParams).toEqual({ To: '+18015551212', DispatcherId: 'abc', CallerIdBlocked: 'false' });
    expect(screen.getByTestId('status').textContent).toBe('in_call');
    await act(async () => { device!.lastCall!.accept(); device!.lastCall!.disconnect(); });
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    const archiveCall = apiFetch.mock.calls.find((c) => c[0] === '/dialer-connect/events');
    expect(archiveCall).toBeDefined();
    const body = JSON.parse((archiveCall![1] as RequestInit).body as string);
    expect(body).toMatchObject({ type: 'call_status', status: 'completed', to: '+18015551212', callSid: 'CAoutbound' });
  });

  test('incoming call → incoming; answer → in_call; hold posts the caller CallSid', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    await act(async () => { device!.simulateIncoming('+18015550000', 'CAcaller1'); });
    expect(screen.getByTestId('status').textContent).toBe('incoming');
    expect(screen.getByTestId('remote').textContent).toBe('+18015550000');
    await act(async () => { screen.getByText('answer').click(); });
    expect(device!.lastCall!.accepted).toBe(true);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('in_call'));
    await act(async () => { screen.getByText('hold').click(); });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/dialer/voice/hold', expect.objectContaining({ body: JSON.stringify({ callSid: 'CAcaller1', hold: true }) })));
  });

  test('does nothing when the iframe kill-switch is set', async () => {
    localStorage.setItem('rmpg_dialer_iframe', '1');
    renderProbe();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('status').textContent).toBe('passive');
    expect(apiFetch).not.toHaveBeenCalledWith('/dialer/token', expect.anything());
  });
});
