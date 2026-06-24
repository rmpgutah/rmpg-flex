import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, test, expect, beforeEach } from 'vitest';
import AdminDevSettingsTab from '../AdminDevSettingsTab';

vi.mock('../../../context/FeatureFlagsContext', () => ({
  useFeatureFlags: vi.fn().mockReturnValue({
    draw: true, annotations: true, gps_replay: true, nav_overlay: true,
    buildings_3d: true, buffer_rings: true, ruler: true, minimap: true,
    dev_diagnostics: false,
  }),
}));

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../../utils/apiLogger', () => ({
  getLog: vi.fn().mockReturnValue([]),
  clearLog: vi.fn(),
  MAX_ENTRIES: 100,
}));

beforeEach(() => vi.clearAllMocks());

test('renders only for admin role', () => {
  const { rerender } = render(<AdminDevSettingsTab role="officer" />);
  expect(screen.queryByText(/feature flags/i)).toBeNull();
  rerender(<AdminDevSettingsTab role="admin" />);
  expect(screen.getByText(/feature flags/i)).toBeInTheDocument();
});

test('renders all flag toggles for admin', () => {
  render(<AdminDevSettingsTab role="admin" />);
  expect(screen.getByText('Draw Geofence')).toBeInTheDocument();
  expect(screen.getByText('Annotations')).toBeInTheDocument();
  expect(screen.getByText('GPS Replay')).toBeInTheDocument();
});

test('clicking a toggle calls PUT /admin/dev/feature-flags', async () => {
  const { apiFetch } = await import('../../../hooks/useApi');
  render(<AdminDevSettingsTab role="admin" />);
  const drawToggle = screen.getByLabelText('Draw Geofence');
  fireEvent.click(drawToggle);
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
    '/admin/dev/feature-flags',
    expect.objectContaining({ method: 'PUT' })
  ));
});
