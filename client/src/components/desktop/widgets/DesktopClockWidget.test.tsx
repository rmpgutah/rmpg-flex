import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import DesktopClockWidget from './DesktopClockWidget';

describe('DesktopClockWidget', () => {
  beforeEach(() => apiFetchMock.mockReset());

  it('shows "Off Duty" when no active shift', async () => {
    apiFetchMock.mockResolvedValue({ active: false, entry: null });
    render(<DesktopClockWidget />);
    await waitFor(() => expect(screen.getByText(/Off Duty/i)).toBeInTheDocument());
  });

  it('shows shift status when clocked in', async () => {
    apiFetchMock.mockResolvedValue({ active: true, entry: { clock_in: '2026-07-18T14:00:00Z' } });
    render(<DesktopClockWidget />);
    await waitFor(() => expect(screen.getByText(/On Duty/i)).toBeInTheDocument());
  });
});
