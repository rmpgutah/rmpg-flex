import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, test, expect, beforeEach } from 'vitest';
import DrawGeofenceTool from '../DrawGeofenceTool';

vi.mock('@mapbox/mapbox-gl-draw', () => {
  const MockDraw = vi.fn().mockImplementation(function () {
    this.getAll = vi.fn().mockReturnValue({ type: 'FeatureCollection', features: [{ type: 'Feature' }] });
    this.deleteAll = vi.fn();
    this.changeMode = vi.fn();
  });
  return { default: MockDraw };
});

vi.mock('../../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({ success: true, id: 1 }),
}));

const mockMap = {
  addControl: vi.fn(),
  removeControl: vi.fn(),
} as any;

beforeEach(() => vi.clearAllMocks());

test('renders shape, color, zone name, zone type controls', () => {
  render(<DrawGeofenceTool map={mockMap} onClose={vi.fn()} />);
  expect(screen.getByText('polygon')).toBeInTheDocument();
  expect(screen.getByText('circle')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Zone name…')).toBeInTheDocument();
});

test('shows error when saving without zone name', async () => {
  render(<DrawGeofenceTool map={mockMap} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(screen.getByText('Zone name is required')).toBeInTheDocument());
});

test('calls POST /geofences and onClose on successful save', async () => {
  const onClose = vi.fn();
  const { apiFetch } = await import('../../../../hooks/useApi');
  render(<DrawGeofenceTool map={mockMap} onClose={onClose} />);
  fireEvent.change(screen.getByPlaceholderText('Zone name…'), { target: { value: 'Test Zone' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
    '/geofences',
    expect.objectContaining({ method: 'POST' })
  ));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});
