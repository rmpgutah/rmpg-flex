import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SpeedGraphOverlay from '../SpeedGraphOverlay';

vi.mock('../../../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../../../../hooks/useApi';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SpeedGraphOverlay — empty state', () => {
  it('shows a "no data" message instead of rendering nothing when there are fewer than 2 points', async () => {
    (apiFetch as any).mockResolvedValue([{ unit_id: 1, points: [] }]);
    render(<SpeedGraphOverlay unitId={1} callSign="A12" hours={4} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/no speed data/i)).toBeInTheDocument();
    });
  });
});
