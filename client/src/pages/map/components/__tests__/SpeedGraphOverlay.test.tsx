import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SpeedGraphOverlay from '../SpeedGraphOverlay';

// Mock at the apiFetch boundary (see useFlexCamManifest.test.tsx for the same
// pattern) so we can control fetch timing independently of vi.useFakeTimers().
const apiFetchMock = vi.fn();
vi.mock('../../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

beforeEach(() => {
  apiFetchMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SpeedGraphOverlay — empty state', () => {
  it('shows a "no data" message instead of rendering nothing when there are fewer than 2 points', async () => {
    apiFetchMock.mockResolvedValue([{ unit_id: 1, points: [] }]);
    render(<SpeedGraphOverlay unitId={1} callSign="A12" hours={4} onClose={() => {}} />);

    await vi.waitFor(() => {
      expect(screen.getByText(/no speed data/i)).toBeInTheDocument();
    });
  });

  it('fetches the trail from the expected endpoint on mount', async () => {
    apiFetchMock.mockResolvedValue([{ unit_id: 1, points: [] }]);
    render(<SpeedGraphOverlay unitId={1} callSign="A12" hours={4} onClose={() => {}} />);

    await vi.waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith('/dispatch/gps/trails?hours=4&unit_id=1');
    });
  });

  it('calls onClose when the close button is clicked in the empty state', async () => {
    apiFetchMock.mockResolvedValue([{ unit_id: 1, points: [] }]);
    const onClose = vi.fn();
    render(<SpeedGraphOverlay unitId={1} callSign="A12" hours={4} onClose={onClose} />);

    await vi.waitFor(() => {
      expect(screen.getByText(/no speed data/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Close speed graph'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('SpeedGraphOverlay — graph state', () => {
  it('renders the speed graph (not the empty-state message) when 2+ trail points are returned', async () => {
    apiFetchMock.mockResolvedValue([
      {
        unit_id: 1,
        points: [
          { lat: 40.1, lng: -111.9, speed: 25, time: '2026-07-20T10:00:00Z' },
          { lat: 40.11, lng: -111.91, speed: 30, time: '2026-07-20T10:00:15Z' },
        ],
      },
    ]);
    render(<SpeedGraphOverlay unitId={1} callSign="A12" hours={4} onClose={() => {}} />);

    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => {
      expect(screen.queryByText(/no speed data/i)).not.toBeInTheDocument();
    });
  });
});
