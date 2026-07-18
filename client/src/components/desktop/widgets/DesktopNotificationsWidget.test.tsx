import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import DesktopNotificationsWidget from './DesktopNotificationsWidget';

describe('DesktopNotificationsWidget', () => {
  beforeEach(() => apiFetchMock.mockReset());

  it('renders recent notification titles from GET /notifications', async () => {
    apiFetchMock.mockResolvedValue({ data: [{ id: 1, title: 'BOLO Updated', created_at: '2026-07-18T10:00:00Z' }] });
    render(<DesktopNotificationsWidget />);
    await waitFor(() => expect(screen.getByText('BOLO Updated')).toBeInTheDocument());
  });

  it('shows an empty state with zero notifications', async () => {
    apiFetchMock.mockResolvedValue({ data: [] });
    render(<DesktopNotificationsWidget />);
    await waitFor(() => expect(screen.getByText(/No recent notifications/i)).toBeInTheDocument());
  });
});
