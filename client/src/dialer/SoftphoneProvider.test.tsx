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
      <span data-testid="dnd">{s.dnd === null ? 'unknown' : String(s.dnd)}</span>
      <button onClick={() => { void s.setDnd(!s.dnd); }}>toggle-dnd</button>
    </div>
  );
}
const renderProbe = (streamEnabled = false) => render(<SoftphoneProvider createDevice={createDevice} streamEnabled={streamEnabled}><Probe /></SoftphoneProvider>);

/** An SSE body that emits the given events once `release` is called, then stays open until aborted. */
function sseResponse(events: object[]): { response: Response; release: () => void } {
  const enc = new TextEncoder();
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      await gate;
      for (const e of events) controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
    },
  });
  return { response: new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }), release };
}

beforeEach(() => {
  device = null;
  localStorage.clear();
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/dialer/token') return { token: 'tok', identity: 'dispatcher_abc', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
    if (path === '/dialer/presence/heartbeat') return { ok: true };
    if (path === '/dialer/voice/hold') return { status: 'held' };
    if (path === '/dialer/dnd') return init?.method === 'PATCH' ? JSON.parse(String(init.body)) : { dnd: true };
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

  test('loads DND after registering and PATCHes it on toggle', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('dnd').textContent).toBe('true'));
    await act(async () => { screen.getByText('toggle-dnd').click(); });
    await waitFor(() => expect(screen.getByTestId('dnd').textContent).toBe('false'));
    expect(apiFetch).toHaveBeenCalledWith('/dialer/dnd', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ dnd: false }) }));
  });

  test('a carrier failure pushed over SSE for the live call hangs it up and surfaces the reason', async () => {
    const sse = sseResponse([
      { type: 'call_status', callSid: 'CAother', status: 'failed' },
      { type: 'call_status', callSid: 'CAoutbound', status: 'failed' },
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => sse.response));
    try {
      renderProbe(true);
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
      await act(async () => { screen.getByText('dial').click(); });
      expect(screen.getByTestId('status').textContent).toBe('in_call');
      await act(async () => { sse.release(); });
      await waitFor(() => expect(device!.lastCall!.disconnected).toBe(true));
      await waitFor(() => expect(screen.getByTestId('error').textContent).toMatch(/carrier rejected/i));
      expect(screen.getByTestId('status').textContent).toBe('ready');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
