// client/src/pages/map/components/__tests__/AnnotationTool.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, test, expect, beforeEach } from 'vitest';
import AnnotationTool from '../AnnotationTool';

vi.mock('../../../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../../../../hooks/useApi';

const mockOn = vi.fn();
const mockOff = vi.fn();
const mockGetSource = vi.fn().mockReturnValue(null);
const mockAddSource = vi.fn();
const mockAddLayer = vi.fn();
const mockRemoveLayer = vi.fn();
const mockRemoveSource = vi.fn();
const mockGetLayer = vi.fn().mockReturnValue(null);
const mockGetCanvas = vi.fn().mockReturnValue({ style: {} });

const mockMap = {
  on: mockOn, off: mockOff,
  getSource: mockGetSource, addSource: mockAddSource,
  addLayer: mockAddLayer, removeLayer: mockRemoveLayer,
  removeSource: mockRemoveSource, getLayer: mockGetLayer,
  getCanvas: mockGetCanvas,
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  (apiFetch as any).mockResolvedValue([]);
});

test('renders annotation form fields', () => {
  render(<AnnotationTool map={mockMap} onClose={vi.fn()} />);
  expect(screen.getByPlaceholderText('Title…')).toBeInTheDocument();
  expect(screen.getByText('Save')).toBeInTheDocument();
});

test('loads existing annotations on mount', async () => {
  (apiFetch as any).mockResolvedValueOnce([
    { id: 1, title: 'Test', lat: 40.7, lng: -111.9, color: '#d4a017', icon: 'pin', body: null },
  ]);
  render(<AnnotationTool map={mockMap} onClose={vi.fn()} />);
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/map/annotations')));
});

test('shows error when title is empty on save', async () => {
  render(<AnnotationTool map={mockMap} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('Save'));
  expect(screen.getByText('Title is required')).toBeInTheDocument();
});
