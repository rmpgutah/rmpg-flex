import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

const mockApiFetch = vi.fn();
const mockSubscribe = vi.fn((..._a: any[]) => () => {});

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: (...a: any[]) => mockApiFetch(...a) }));
vi.mock('../../../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: (...a: any[]) => mockSubscribe(...a) }),
}));

describe('ShiftCard (smoke)', () => {
  it('module loads', async () => {
    const mod = await import('../ShiftCard');
    expect(mod.default).toBeDefined();
  });
});

describe('ShiftCard — integrated Start/End Shift', () => {
  beforeEach(() => { mockApiFetch.mockReset(); cleanup(); });

  it('shows Start Shift when off duty', async () => {
    mockApiFetch.mockResolvedValueOnce({
      on_shift: false, unit: { id: 1, call_sign: '1A' },
      take_home_vehicle: null, vehicle: null, available_vehicles: [],
    });
    const { default: ShiftCard } = await import('../ShiftCard');
    render(<ShiftCard />);
    await waitFor(() => expect(screen.getByRole('button', { name: /start shift/i })).toBeInTheDocument());
  });

  it('shows End Shift + unit + vehicle when on duty', async () => {
    mockApiFetch.mockResolvedValueOnce({
      on_shift: true,
      time_entry: { clock_in: '2026-04-20T08:00:00Z' },
      unit: { id: 1, call_sign: '1A' },
      vehicle: { id: 5, vehicle_number: 'FV-7', make: 'Ford', model: 'Explorer', status: 'in_service', is_take_home: 0 },
      take_home_vehicle: null, available_vehicles: [],
    });
    const { default: ShiftCard } = await import('../ShiftCard');
    render(<ShiftCard />);
    await waitFor(() => expect(screen.getByRole('button', { name: /end shift/i })).toBeInTheDocument());
    expect(screen.getByText('1A')).toBeInTheDocument();
    expect(screen.getByText('FV-7')).toBeInTheDocument();
  });

  it('auto-starts with the take-home vehicle (no picker)', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ // GET /duty/me
        on_shift: false, unit: { id: 1, call_sign: '1A' },
        take_home_vehicle: { id: 5, vehicle_number: 'FV-7', make: null, model: null, status: 'in_service', is_take_home: 1 },
        vehicle: null,
        available_vehicles: [{ id: 5, vehicle_number: 'FV-7', make: null, model: null, status: 'in_service', is_take_home: 1 }],
      })
      .mockResolvedValueOnce({}) // POST /duty/start
      .mockResolvedValueOnce({ // GET /duty/me refetch
        on_shift: true, time_entry: { clock_in: '2026-04-20T08:00:00Z' },
        unit: { id: 1, call_sign: '1A' },
        vehicle: { id: 5, vehicle_number: 'FV-7', status: 'in_service', is_take_home: 1, make: null, model: null },
        take_home_vehicle: null, available_vehicles: [],
      });
    const { default: ShiftCard } = await import('../ShiftCard');
    render(<ShiftCard />);
    await waitFor(() => expect(screen.getByRole('button', { name: /start shift/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /end shift/i })).toBeInTheDocument());
    const startCall = mockApiFetch.mock.calls.find((c) => c[0] === '/dispatch/duty/start');
    expect(startCall).toBeTruthy();
  });

  it('prompts for a vehicle when no take-home is set', async () => {
    mockApiFetch.mockResolvedValueOnce({
      on_shift: false, unit: { id: 1, call_sign: '1A' },
      take_home_vehicle: null, vehicle: null,
      available_vehicles: [{ id: 9, vehicle_number: 'FV-9', make: 'Chevy', model: 'Tahoe', status: 'in_service', is_take_home: 0 }],
    });
    const { default: ShiftCard } = await import('../ShiftCard');
    render(<ShiftCard />);
    await waitFor(() => expect(screen.getByRole('button', { name: /start shift/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }));
    await waitFor(() => expect(screen.getByText(/select your vehicle/i)).toBeInTheDocument());
    expect(screen.getByText(/FV-9/)).toBeInTheDocument();
  });
});
