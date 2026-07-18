import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import DesktopShiftTimerWidget from './DesktopShiftTimerWidget';

describe('DesktopShiftTimerWidget', () => {
  beforeEach(() => { apiFetchMock.mockReset(); });

  it('shows elapsed on-duty time when clocked in', async () => {
    apiFetchMock.mockResolvedValue({ active: true, entry: { clock_in: new Date(Date.now() - 65_000).toISOString() } });
    render(<DesktopShiftTimerWidget />);
    await waitFor(() => expect(screen.getByText(/on duty/i)).toBeInTheDocument());
    expect(screen.getByText(/01:0[0-9]/)).toBeInTheDocument(); // ~65s elapsed
  });

  it('shows an off-duty state when not clocked in', async () => {
    apiFetchMock.mockResolvedValue({ active: false, entry: null });
    render(<DesktopShiftTimerWidget />);
    await waitFor(() => expect(screen.getByText(/off duty/i)).toBeInTheDocument());
  });
});
