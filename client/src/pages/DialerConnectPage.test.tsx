import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DialerConnectPage from './DialerConnectPage';
import { DIALER_HOST_ID } from '../components/dialerConnect';

vi.mock('../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue([]),
  apiFetchBlob: vi.fn(),
}));

describe('DialerConnectPage', () => {
  test('renders the host dock DialerPanel positions into', () => {
    render(<DialerConnectPage />);
    const host = screen.getByTestId('dialer-connect-host');
    expect(host).toHaveAttribute('id', DIALER_HOST_ID);
    expect(screen.getByTestId('dialer-connect-recordings')).toBeInTheDocument();
  });
});
