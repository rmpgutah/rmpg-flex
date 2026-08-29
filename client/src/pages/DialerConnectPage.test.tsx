import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  test('renders the live Dial Connect dock plus history and voicemail tabs', () => {
    renderPage();
    const host = screen.getByTestId('dialer-connect-host');
    expect(host).toHaveAttribute('id', DIALER_HOST_ID);
    expect(screen.getByRole('button', { name: /voicemail/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /call history/i })).toBeInTheDocument();
  });

  test('exposes hang-up and mute on the keypad', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /^hang up$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^mute$/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Dial number')).toBeInTheDocument();
  });

  test('call history has a date range and starred filter', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /call history/i }));
    expect(screen.getByLabelText('From date')).toBeInTheDocument();
    expect(screen.getByLabelText('To date')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /starred/i })).toBeInTheDocument();
  });

  test('voicemail tab exports CSV', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /voicemail/i }));
    expect(screen.getByRole('button', { name: /^csv$/i })).toBeInTheDocument();
  });
});
