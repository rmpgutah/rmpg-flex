// client/src/pages/map/components/__tests__/BufferRingTool.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, test, expect } from 'vitest';
import BufferRingTool from '../BufferRingTool';

vi.mock('@turf/circle', () => ({
  default: vi.fn().mockReturnValue({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[]] },
    properties: {},
  }),
}));

const mockMap = {
  on: vi.fn(), off: vi.fn(),
  getSource: vi.fn().mockReturnValue(null),
  addSource: vi.fn(), addLayer: vi.fn(),
  removeLayer: vi.fn(), removeSource: vi.fn(),
  getLayer: vi.fn().mockReturnValue(null),
  getCanvas: vi.fn().mockReturnValue({ style: {} }),
} as any;

test('renders radius input and unit toggle', () => {
  render(<BufferRingTool map={mockMap} onClose={vi.fn()} />);
  expect(screen.getByPlaceholderText('Radius…')).toBeInTheDocument();
  expect(screen.getByText('ft')).toBeInTheDocument();
  expect(screen.getByText('mi')).toBeInTheDocument();
});

test('unit toggle switches between ft and mi', () => {
  render(<BufferRingTool map={mockMap} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('mi'));
  expect(screen.getByText('mi').className).toContain('bg-brand-500');
});

test('Clear All button exists', () => {
  render(<BufferRingTool map={mockMap} onClose={vi.fn()} />);
  expect(screen.getByText('Clear All')).toBeInTheDocument();
});
