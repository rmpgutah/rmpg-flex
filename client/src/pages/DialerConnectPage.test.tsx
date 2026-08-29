import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('DialerConnectPage', () => {
  test('renders the live Dial Connect dock plus history and voicemail tabs', () => {
    render(<DialerConnectPage />);
    const host = screen.getByTestId('dialer-connect-host');
    expect(host).toHaveAttribute('id', DIALER_HOST_ID);
    expect(screen.getByRole('button', { name: /voicemail/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /call history/i })).toBeInTheDocument();
  });
});
