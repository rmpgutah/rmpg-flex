import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import MapboxDispatchConnections from '../MapboxDispatchConnections';

const routing = vi.hoisted(() => ({
  ensureMapboxDirections: vi.fn(),
  hasMapboxDirections: vi.fn(),
  buildMapboxStaticImageUrl: vi.fn(),
}));

vi.mock('../../../../utils/mapboxRouting', () => ({
  ...routing,
  fetchMapboxForwardGeocode: vi.fn(),
  fetchMapboxIsochrones: vi.fn(),
  fetchMapboxMatchedPath: vi.fn(),
  fetchMapboxReverseGeocode: vi.fn(),
  fetchMapboxRoute: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  routing.hasMapboxDirections.mockReturnValue(false);
  routing.ensureMapboxDirections.mockResolvedValue(true);
  routing.buildMapboxStaticImageUrl.mockReturnValue(
    'https://api.mapbox.com/static/example?access_token=pk.server-public-token',
  );
});

test('becomes connected after the cold-start server lookup and never prints the token-bearing preview URL', async () => {
  const user = userEvent.setup();
  render(<MapboxDispatchConnections call={{ latitude: 40.76, longitude: -111.89 } as any} />);

  expect(screen.getByText('Checking…')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument());

  await user.click(screen.getByRole('button', { name: /static snapshot/i }));
  await waitFor(() => expect(screen.getByText('Static image ready')).toBeInTheDocument());
  expect(screen.queryByText(/pk\.server-public-token/)).not.toBeInTheDocument();
});
