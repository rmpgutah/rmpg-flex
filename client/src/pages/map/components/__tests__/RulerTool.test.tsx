// client/src/pages/map/components/__tests__/RulerTool.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, test, expect } from 'vitest';
import RulerTool from '../RulerTool';

vi.mock('@turf/length', () => ({
  default: vi.fn().mockReturnValue(1.609),
}));

const mockMap = {
  on: vi.fn(), off: vi.fn(),
  getSource: vi.fn().mockReturnValue(null),
  addSource: vi.fn(), addLayer: vi.fn(),
  removeLayer: vi.fn(), removeSource: vi.fn(),
  getLayer: vi.fn().mockReturnValue(null),
  getCanvas: vi.fn().mockReturnValue({ style: {} }),
} as any;

test('renders instruction text', () => {
  render(<RulerTool map={mockMap} onClose={vi.fn()} />);
  expect(screen.getByText(/click map/i)).toBeInTheDocument();
});

test('shows Clear button', () => {
  render(<RulerTool map={mockMap} onClose={vi.fn()} />);
  expect(screen.getByText('Clear')).toBeInTheDocument();
});
