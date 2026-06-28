import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

const mockApiFetch = vi.fn();
const mockSubscribe = vi.fn((..._a: any[]) => () => {});

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: (...a: any[]) => mockApiFetch(...a) }));
vi.mock('../../../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: (...a: any[]) => mockSubscribe(...a) }),
}));
// ShiftCard now reads user.role to decide whether the mileage modal exposes
// the manager-override path. useAuth() runs at top-level so the off-duty
// render still needs a provider stub even though no modal is opened.
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'officer' } }),
}));
// QR rendering is an async effect on the on-shift path. Stub to a fixed data
// URL so tests don't depend on a real QRCode encode step.
vi.mock('qrcode', () => ({
  default: { toDataURL: () => Promise.resolve('data:image/png;base64,stub') },
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

  it('auto-resolves the take-home vehicle and routes through the starting-mileage prompt', async () => {
    // New contract (mileage workflow): clicking Start Shift no longer POSTs
    // directly — it opens the mileage modal. The POST happens when the modal
    // submits, with starting_mileage in the payload.
    mockApiFetch.mockResolvedValueOnce({ // GET /duty/me
      on_shift: false, unit: { id: 1, call_sign: '1A' },
      take_home_vehicle: { id: 5, vehicle_number: 'FV-7', make: null, model: null, status: 'in_service', is_take_home: 1 },
      vehicle: null,
      available_vehicles: [{ id: 5, vehicle_number: 'FV-7', make: null, model: null, status: 'in_service', is_take_home: 1 }],
    });
    const { default: ShiftCard } = await import('../ShiftCard');
    render(<ShiftCard />);
    await waitFor(() => expect(screen.getByRole('button', { name: /start shift/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }));
    // The take-home is auto-resolved (no picker), and the mileage modal opens.
    await waitFor(() => expect(screen.getByText(/SHIFT START/i)).toBeInTheDocument());
    expect(screen.queryByText(/select your vehicle/i)).not.toBeInTheDocument();
    // No POST until the officer submits the modal with starting_mileage.
    expect(mockApiFetch.mock.calls.find((c) => c[0] === '/dispatch/duty/start')).toBeFalsy();
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
