import { describe, test, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import DialerConnectPage from './DialerConnectPage';
import { DIALER_HOST_ID } from '../components/dialerConnect';

vi.mock('../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({ data: [] }),
  apiFetchBlob: vi.fn(),
  apiPostForm: vi.fn(),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'dispatcher', full_name: 'Test User', username: 'test' } }),
}));

vi.mock('../components/ToastProvider', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <DialerConnectPage />
    </MemoryRouter>,
  );
}

describe('DialerConnectPage', () => {
  test('renders the live Dial Connect dock plus history and voicemail tabs', async () => {
    await act(async () => { renderPage(); });
    const host = screen.getByTestId('dialer-connect-host');
    expect(host).toHaveAttribute('id', DIALER_HOST_ID);
    expect(screen.getByRole('button', { name: /voicemail/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /call history/i })).toBeInTheDocument();
  });

  test('exposes hang-up and mute on the keypad', async () => {
    await act(async () => { renderPage(); });
    expect(screen.getByRole('button', { name: /^hang up$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^mute$/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Dial number')).toBeInTheDocument();
  });

  test('call history has a date range and starred filter', async () => {
    const user = userEvent.setup();
    await act(async () => { renderPage(); });
    await user.click(screen.getByRole('button', { name: /call history/i }));
    expect(screen.getByLabelText('From date')).toBeInTheDocument();
    expect(screen.getByLabelText('To date')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /starred/i })).toBeInTheDocument();
  });

  test('LIVE toggle collapses and restores the Dial Connect dock', async () => {
    const user = userEvent.setup();
    await act(async () => { renderPage(); });
    // jsdom cannot parse `min(42vh, 680px)`, so assert on minHeight (240px open / 0px collapsed).
    const host = screen.getByTestId('dialer-connect-host');
    expect(host.style.minHeight).toBe('240px');
    await user.click(screen.getByRole('button', { name: /hide live dialer/i }));
    expect(host.style.minHeight).toBe('0px');
    await user.click(screen.getByRole('button', { name: /show live dialer/i }));
    expect(host.style.minHeight).toBe('240px');
  });

  test('keypad dials in Dial mode and sends tones in DTMF mode', async () => {
    const user = userEvent.setup();
    await act(async () => { renderPage(); });
    const input = screen.getByLabelText('Dial number') as HTMLInputElement;
    await user.click(screen.getByRole('button', { name: 'Key 8' }));
    await user.click(screen.getByRole('button', { name: 'Key 0' }));
    await user.click(screen.getByRole('button', { name: 'Key 1' }));
    expect(input.value).toBe('801');
    await user.click(screen.getByRole('button', { name: /dial mode/i }));
    await user.click(screen.getByRole('button', { name: 'Key 5' }));
    expect(input.value).toBe('801');
    expect(screen.getByText(/tones sent/i).textContent).toContain('5');
  });

  test('hold and mute are stateful toggles', async () => {
    const user = userEvent.setup();
    await act(async () => { renderPage(); });
    await user.click(screen.getByRole('button', { name: /^hold$/i }));
    expect(screen.getByRole('button', { name: /^resume$/i })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /^mute$/i }));
    expect(screen.getByRole('button', { name: /^unmute$/i })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /^hang up$/i }));
    expect(screen.getByRole('button', { name: /^hold$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^mute$/i })).toBeInTheDocument();
  });

  test('call history shows whether each recording is archived in RMPG Flex', async () => {
    const { apiFetch } = await import('../hooks/useApi');
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.startsWith('/dialer-connect/calls/summary')) return { data: { total: 2 } };
      if (path.startsWith('/dialer-connect/calls')) {
        return { data: [
          { id: 1, direction: 'inbound', status: 'completed', from_number: '+18015550100', recording_r2_key: 'dialer-connect/call/1/1', recording_source_url: 'https://dialer.rmpgutah.us/a.mp3' },
          { id: 2, direction: 'inbound', status: 'failed', from_number: '+18015550101', recording_source_url: 'https://dialer.rmpgutah.us/b.mp3' },
        ] };
      }
      return { data: [] };
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
