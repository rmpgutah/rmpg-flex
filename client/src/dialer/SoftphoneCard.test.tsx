import { useState } from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { SoftphoneProvider } from './SoftphoneProvider';
import SoftphoneCard from './SoftphoneCard';
import { MockDevice } from './mockDevice';

const apiFetch = vi.fn();
vi.mock('../hooks/useApi', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

let device: MockDevice | null = null;
function Host() {
  const [digits, setDigits] = useState('');
  const [dtmf, setDtmf] = useState(false);
  return <SoftphoneCard digits={digits} onDigitsChange={setDigits} dtmfMode={dtmf} onDtmfModeChange={setDtmf} onToneSent={() => {}} />;
}
const renderCard = () => render(
  <MemoryRouter>
    <SoftphoneProvider createDevice={(t) => { device = new MockDevice(t); return device; }} streamEnabled={false}><Host /></SoftphoneProvider>
  </MemoryRouter>,
);

beforeEach(() => {
  device = null; localStorage.clear(); apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/dialer/token') return { token: 'tok', identity: 'dispatcher_abc', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
    if (path === '/dialer/presence') return [{ id: 'peer1', name: 'Pat Peer', agency: 'all', dnd: false }];
    if (path === '/dialer/dnd') return init?.method === 'PATCH' ? JSON.parse(String(init.body)) : { dnd: true };
    return { status: 'ok' };
  });
});

describe('SoftphoneCard', () => {
  test('keypad builds the number and Call connects the device', async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(screen.getByText(/^ready$/i)).toBeInTheDocument());
    for (const k of ['8', '0', '1', '5', '5', '5', '1', '2', '1', '2']) await user.click(screen.getByRole('button', { name: `Key ${k}` }));
    await user.click(screen.getByRole('button', { name: /^call$/i }));
    expect(device!.connectParams?.To).toBe('+18015551212');
    expect(screen.getByRole('button', { name: /hang up/i })).toBeEnabled();
  });

  test('incoming shows Answer/Reject; Answer accepts; Mute/Hold/Record/DTMF act on the live call', async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(screen.getByText(/^ready$/i)).toBeInTheDocument());
    await act(async () => { device!.simulateIncoming('+18015550000', 'CAcaller1'); });
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^answer$/i }));
    expect(device!.lastCall!.accepted).toBe(true);
    await user.click(screen.getByRole('button', { name: /^mute$/i }));
    expect(device!.lastCall!.muted).toBe(true);
    await user.click(screen.getByRole('button', { name: /^hold$/i }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/dialer/voice/hold', expect.objectContaining({ body: JSON.stringify({ callSid: 'CAcaller1', hold: true }) })));
    await user.click(screen.getByRole('button', { name: /^record$/i }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/dialer/voice/recording', expect.objectContaining({ body: JSON.stringify({ callSid: 'CAcaller1', action: 'start' }) })));
    await user.click(screen.getByRole('button', { name: /dtmf mode|dial mode/i }));
    await user.click(screen.getByRole('button', { name: 'Key 5' }));
    expect(device!.lastCall!.digits).toBe('5');
  });

  test('warm transfer picks a peer and posts add-dispatcher', async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(screen.getByText(/^ready$/i)).toBeInTheDocument());
    await act(async () => { device!.simulateIncoming('+18015550000', 'CAcaller1'); });
    await user.click(screen.getByRole('button', { name: /^answer$/i }));
    await user.click(screen.getByRole('button', { name: /^transfer$/i }));
    await user.click(await screen.findByRole('button', { name: /warm/i }));
    await user.click(await screen.findByRole('button', { name: /pat peer/i }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/dialer/voice/conference/add-dispatcher', expect.objectContaining({ body: JSON.stringify({ callSid: 'CAcaller1', targetDispatcherId: 'peer1' }) })));
  });

  test('unlinked shows the Link Dial Connect gate instead of the keypad', async () => {
    apiFetch.mockImplementation(async (path: string) => { if (path === '/dialer/token') throw Object.assign(new Error('x'), { status: 409, code: 'dialer_unlinked' }); return {}; });
    renderCard();
    expect(await screen.findByRole('link', { name: /sign in with dialer/i })).toHaveAttribute('href', '/api/oidc/dialer/login');
    expect(screen.queryByRole('button', { name: 'Key 1' })).not.toBeInTheDocument();
  });

  test('DND on shows the voicemail warning and the toggle clears it via PATCH', async () => {
    const user = userEvent.setup();
    renderCard();
    expect(await screen.findByRole('button', { name: /dnd on/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/routed to voicemail/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /dnd on/i }));
    expect(await screen.findByRole('button', { name: /dnd off/i })).toHaveAttribute('aria-pressed', 'false');
    expect(apiFetch).toHaveBeenCalledWith('/dialer/dnd', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ dnd: false }) }));
    expect(screen.queryByText(/routed to voicemail/i)).not.toBeInTheDocument();
  });
});
