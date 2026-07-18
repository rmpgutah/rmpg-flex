import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import DesktopPinnedCallTicker from './DesktopPinnedCallTicker';

describe('DesktopPinnedCallTicker', () => {
  beforeEach(() => apiFetchMock.mockReset());

  it('renders each active call\'s type and address', async () => {
    apiFetchMock.mockResolvedValue([
      { id: 1, call_type: 'Traffic Stop', address: '123 Main St', priority: 2 },
      { id: 2, call_type: 'Domestic Disturbance', address: '456 Elm St', priority: 1 },
    ]);
    render(<DesktopPinnedCallTicker />);
    await waitFor(() => expect(screen.getByText(/Traffic Stop/)).toBeInTheDocument());
    expect(screen.getByText(/123 Main St/)).toBeInTheDocument();
    expect(screen.getByText(/Domestic Disturbance/)).toBeInTheDocument();
  });

  it('shows an empty-state message when there are no active calls', async () => {
    apiFetchMock.mockResolvedValue([]);
    render(<DesktopPinnedCallTicker />);
    await waitFor(() => expect(screen.getByText(/no active calls/i)).toBeInTheDocument());
  });
});
