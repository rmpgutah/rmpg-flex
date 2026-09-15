import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import DialerConnectPage from './DialerConnectPage';
import { DIALER_HOST_ID } from '../components/dialerConnect';
import { SoftphoneProvider } from '../dialer/SoftphoneProvider';
import { MockDevice } from '../dialer/mockDevice';

const apiFetch = vi.fn();
vi.mock('../hooks/useApi', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  apiFetchBlob: vi.fn(),
  apiPostForm: vi.fn(),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'dispatcher', full_name: 'Test User', username: 'test' } }),
}));

vi.mock('../components/ToastProvider', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

let device: MockDevice | null = null;

function renderPage() {
  return render(
    <MemoryRouter>
      <SoftphoneProvider createDevice={(t) => { device = new MockDevice(t); return device; }} streamEnabled={false}>
        <DialerConnectPage />
      </SoftphoneProvider>
    </MemoryRouter>,
  );
}

const defaultApi = async (path: string) => {
  if (path === '/dialer/token') return { token: 'tok', identity: 'dispatcher_abc', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
  if (path.startsWith('/dialer/')) return { status: 'ok' };
  return { data: [] };
};

async function renderReady() {
  await act(async () => { renderPage(); });
  await waitFor(() => expect(screen.getByText(/^ready$/i)).toBeInTheDocument());
}

beforeEach(() => {
  device = null;
  localStorage.clear();
  apiFetch.mockReset();
  apiFetch.mockImplementation(defaultApi);
});

describe('DialerConnectPage', () => {
  test('renders the native softphone with history and voicemail tabs and no iframe dock by default', async () => {
    await renderReady();
    expect(screen.queryByTestId('dialer-connect-host')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /live dialer/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /voicemail/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /call history/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^hang up$/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Dial number')).toBeInTheDocument();
  });

  test('iframe kill-switch restores the LIVE dock, starting collapsed', async () => {
    localStorage.setItem('rmpg_dialer_iframe', '1');
    const user = userEvent.setup();
    await act(async () => { renderPage(); });
    const host = screen.getByTestId('dialer-connect-host');
    expect(host).toHaveAttribute('id', DIALER_HOST_ID);
    // jsdom cannot parse `min(42vh, 680px)`, so assert on minHeight (240px open / 0px collapsed).
    expect(host.style.minHeight).toBe('0px');
    await user.click(screen.getByRole('button', { name: /show live dialer/i }));
    expect(host.style.minHeight).toBe('240px');
    await user.click(screen.getByRole('button', { name: /hide live dialer/i }));
    expect(host.style.minHeight).toBe('0px');
  });

  test('call history has a date range and starred filter', async () => {
    const user = userEvent.setup();
    await act(async () => { renderPage(); });
    await user.click(screen.getByRole('button', { name: /call history/i }));
    expect(screen.getByLabelText('From date')).toBeInTheDocument();
    expect(screen.getByLabelText('To date')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /starred/i })).toBeInTheDocument();
  });

  test('keypad dials through the softphone and sends DTMF tones on the live call', async () => {
    const user = userEvent.setup();
    await renderReady();
    const input = screen.getByLabelText('Dial number') as HTMLInputElement;
    for (const k of ['8', '0', '1', '5', '5', '5', '1', '2', '1', '2']) await user.click(screen.getByRole('button', { name: `Key ${k}` }));
    expect(input.value).toBe('8015551212');
    await user.click(screen.getByRole('button', { name: /^call$/i }));
    expect(device!.connectParams?.To).toBe('+18015551212');
    await act(async () => { device!.lastCall!.accept(); });
    await user.click(screen.getByRole('button', { name: /dial mode/i }));
    await user.click(screen.getByRole('button', { name: 'Key 5' }));
    expect(input.value).toBe('8015551212');
    expect(device!.lastCall!.digits).toBe('5');
    expect(screen.getByText(/tones sent/i).textContent).toContain('5');
  });

  test('hold and mute are stateful toggles on the live call', async () => {
    const user = userEvent.setup();
    await renderReady();
    await act(async () => { device!.simulateIncoming('+18015550000', 'CAcaller1'); });
    await user.click(screen.getByRole('button', { name: /^answer$/i }));
    await user.click(screen.getByRole('button', { name: /^hold$/i }));
    expect(await screen.findByRole('button', { name: /^resume$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(apiFetch).toHaveBeenCalledWith('/dialer/voice/hold', expect.objectContaining({ body: JSON.stringify({ callSid: 'CAcaller1', hold: true }) }));
    await user.click(screen.getByRole('button', { name: /^mute$/i }));
    expect(screen.getByRole('button', { name: /^unmute$/i })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /^hang up$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^hold$/i })).toBeDisabled());
    expect(screen.getByRole('button', { name: /^mute$/i })).toBeInTheDocument();
  });

  test('call history shows whether each recording is archived in RMPG Flex', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/dialer-connect/calls/summary')) return { data: { total: 2 } };
      if (path.startsWith('/dialer-connect/calls')) {
        return { data: [
          { id: 1, direction: 'inbound', status: 'completed', from_number: '+18015550100', recording_r2_key: 'dialer-connect/call/1/1', recording_source_url: 'https://dialer.rmpgutah.us/a.mp3' },
          { id: 2, direction: 'inbound', status: 'failed', from_number: '+18015550101', recording_source_url: 'https://dialer.rmpgutah.us/b.mp3' },
        ] };
      }
      return defaultApi(path);
    });
    const user = userEvent.setup();
    await act(async () => { renderPage(); });
    await user.click(screen.getByRole('button', { name: /call history/i }));
    expect(await screen.findByText(/^archived$/i)).toBeInTheDocument();
    expect(screen.getByText(/copy pending/i)).toBeInTheDocument();
  });

  test('voicemail tab exports CSV', async () => {
    const user = userEvent.setup();
    await act(async () => { renderPage(); });
    await user.click(screen.getByRole('button', { name: /voicemail/i }));
    expect(screen.getByRole('button', { name: /^csv$/i })).toBeInTheDocument();
  });
});
