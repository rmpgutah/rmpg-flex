import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import DesktopPinnedCallTicker from './DesktopPinnedCallTicker';

describe('DesktopPinnedCallTicker', () => {
  beforeEach(() => apiFetchMock.mockReset());

  it('renders each active call\'s type and address', async () => {
    // Real /dispatch/queue response shape (LIST_VIEW_COLUMNS in
    // src/routes/dispatch/calls.ts, projected by src/routes/dispatch/aggregates.ts's
    // GET /queue) — DB columns are incident_type/location_address, NOT the
    // call_type/address the widget used to (wrongly) assume.
    apiFetchMock.mockResolvedValue([
      { id: 1, incident_type: 'Traffic Stop', location_address: '123 Main St', priority: 'P2' },
      { id: 2, incident_type: 'Domestic Disturbance', location_address: '456 Elm St', priority: 'P1' },
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
