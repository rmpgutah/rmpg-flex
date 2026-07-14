import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { FuelEntryModal } from '../FuelEntryModal';

vi.mock('../../hooks/apiFetchV2', () => ({
  apiFetchV2: vi.fn(),
}));
import { apiFetchV2 } from '../../hooks/apiFetchV2';

const mockedApiFetchV2 = vi.mocked(apiFetchV2);

beforeEach(() => {
  mockedApiFetchV2.mockReset();
  mockedApiFetchV2.mockResolvedValue({});
});

describe('FuelEntryModal', () => {
  it('create mode: posts to /fleet/:id/fuel with entered fields', async () => {
    const onSaved = vi.fn();
    render(<FuelEntryModal vehicleId={7} mode="create" onClose={() => {}} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText(/gallons/i), { target: { value: '12.5' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockedApiFetchV2).toHaveBeenCalledWith(
      '/fleet/7/fuel',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(mockedApiFetchV2.mock.calls[0][1]!.body as string);
    expect(body.fuel_date).toBe('2026-07-01');
    expect(body.gallons).toBe(12.5);
    cleanup();
  });

  it('edit mode: pre-fills fields and PUTs to /fleet/fuel/:id', async () => {
    const onSaved = vi.fn();
    render(
      <FuelEntryModal
        vehicleId={7}
        mode="edit"
        entry={{ id: 55, fuel_date: '2026-06-15', gallons: 10, station: 'Shell' }}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    expect(screen.getByLabelText(/date/i)).toHaveValue('2026-06-15');
    expect(screen.getByLabelText(/station/i)).toHaveValue('Shell');

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockedApiFetchV2).toHaveBeenCalledWith(
      '/fleet/fuel/55',
      expect.objectContaining({ method: 'PUT' }),
    );
    cleanup();
  });

  it('requires a date before saving', () => {
    const onSaved = vi.fn();
    render(<FuelEntryModal vehicleId={7} mode="create" onClose={() => {}} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    expect(screen.getByText(/date is required/i)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    cleanup();
  });

  it('fleet-wide create (vehicleId null): requires a vehicle pick, posts to the chosen vehicle', async () => {
    const onSaved = vi.fn();
    render(
      <FuelEntryModal
        vehicleId={null}
        vehicles={[{ id: 3, vehicle_number: 'PS-3', vehicle_name: null }, { id: 4, vehicle_number: 'PS-4', vehicle_name: null }]}
        mode="create"
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: '2026-07-01' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    expect(screen.getByText(/vehicle is required/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/vehicle/i), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockedApiFetchV2).toHaveBeenCalledWith('/fleet/4/fuel', expect.objectContaining({ method: 'POST' }));
    cleanup();
  });

  it('Esc closes the modal while not saving', () => {
    const onClose = vi.fn();
    render(<FuelEntryModal vehicleId={7} mode="create" onClose={onClose} onSaved={() => {}} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    cleanup();
  });
});
