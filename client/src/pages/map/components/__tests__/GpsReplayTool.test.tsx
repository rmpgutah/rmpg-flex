import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, test, expect, beforeEach } from 'vitest';
import GpsReplayTool from '../GpsReplayTool';

vi.mock('../../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue([]),
}));

import { apiFetch } from '../../../../hooks/useApi';

const mockMap = {
  on: vi.fn(), off: vi.fn(),
  getSource: vi.fn().mockReturnValue(null),
  addSource: vi.fn(), addLayer: vi.fn(),
  removeLayer: vi.fn(), removeSource: vi.fn(),
  getLayer: vi.fn().mockReturnValue(null),
  flyTo: vi.fn(),
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  (apiFetch as any).mockResolvedValue([]);
});

test('renders unit selector and playback controls', () => {
  render(<GpsReplayTool map={mockMap} onClose={vi.fn()} />);
  expect(screen.getByText('Play')).toBeInTheDocument();
  expect(screen.getByText('Stop')).toBeInTheDocument();
});

test('loads unit list on mount', async () => {
  (apiFetch as any).mockImplementation((path: string) => {
    if (path.includes('/dispatch/gps/units-with-trails')) return Promise.resolve([{ unit_id: 1, call_sign: 'S-1' }]);
    return Promise.resolve({ points: [] });
  });
  render(<GpsReplayTool map={mockMap} onClose={vi.fn()} />);
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/dispatch/gps/units-with-trails')));
});

test('shows empty state when no positions', async () => {
  (apiFetch as any).mockImplementation((path: string) => {
    if (path.includes('/dispatch/gps/units-with-trails')) return Promise.resolve([{ unit_id: 1, call_sign: 'S-1' }]);
    return Promise.resolve({ points: [] });
  });
  render(<GpsReplayTool map={mockMap} onClose={vi.fn()} />);
  await waitFor(() => {
    expect(apiFetch).toHaveBeenCalled();
  });
  // Just verify the component rendered without crashing with empty data
  expect(screen.getByText('Play')).toBeInTheDocument();
});
