import { render, screen } from '@testing-library/react';
import { vi, test, expect } from 'vitest';
import MapDiagnosticsOverlay from '../MapDiagnosticsOverlay';

const mockGetStyle = vi.fn().mockReturnValue({ layers: [{}, {}], sources: {} });
const mockGetZoom = vi.fn().mockReturnValue(12.5);
const mockGetCenter = vi.fn().mockReturnValue({ lat: 40.76543, lng: -111.89012 });
const mockGetPitch = vi.fn().mockReturnValue(0);
const mockGetBearing = vi.fn().mockReturnValue(0);

const mockMap = {
  getStyle: mockGetStyle,
  getZoom: mockGetZoom,
  getCenter: mockGetCenter,
  getPitch: mockGetPitch,
  getBearing: mockGetBearing,
  on: vi.fn(),
  off: vi.fn(),
} as any;

test('renders zoom level', () => {
  render(<MapDiagnosticsOverlay map={mockMap} />);
  expect(screen.getByText(/zoom/i)).toBeInTheDocument();
});

test('renders layer count', () => {
  render(<MapDiagnosticsOverlay map={mockMap} />);
  expect(screen.getByText(/layers/i)).toBeInTheDocument();
});
