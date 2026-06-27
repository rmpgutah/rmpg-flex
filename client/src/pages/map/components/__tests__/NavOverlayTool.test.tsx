import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, test, expect, beforeEach } from 'vitest';
import NavOverlayTool from '../NavOverlayTool';

vi.mock('../../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({ routes: [] }),
}));

import { apiFetch } from '../../../../hooks/useApi';

const mockMap = {
  on: vi.fn(), off: vi.fn(),
  getSource: vi.fn().mockReturnValue(null),
  addSource: vi.fn(), addLayer: vi.fn(),
  removeLayer: vi.fn(), removeSource: vi.fn(),
  getLayer: vi.fn().mockReturnValue(null),
  getCanvas: vi.fn().mockReturnValue({ style: {} }),
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  (apiFetch as any).mockResolvedValue({ routes: [] });
});

test('renders origin and destination inputs', () => {
  render(<NavOverlayTool map={mockMap} onClose={vi.fn()} />);
  expect(screen.getByPlaceholderText('Origin (lat,lng)…')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Destination (lat,lng)…')).toBeInTheDocument();
});

test('shows Get Route button', () => {
  render(<NavOverlayTool map={mockMap} onClose={vi.fn()} />);
  expect(screen.getByText('Get Route')).toBeInTheDocument();
});

test('calls /mapbox/directions on route request', async () => {
  render(<NavOverlayTool map={mockMap} onClose={vi.fn()} />);
  fireEvent.change(screen.getByPlaceholderText('Origin (lat,lng)…'), { target: { value: '40.7,-111.9' } });
  fireEvent.change(screen.getByPlaceholderText('Destination (lat,lng)…'), { target: { value: '40.8,-111.8' } });
  fireEvent.click(screen.getByText('Get Route'));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
    expect.stringContaining('/mapbox/directions')
  ));
});
