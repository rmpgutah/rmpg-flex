import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

// MDT unit-status routing contract: duty BOUNDARIES (off_duty, and going
// available FROM off_duty) run through the integrated shift API
// (/dispatch/duty/{start,end}) so they clock the officer in/out AND
// assign/release the fleet vehicle — matching the ShiftCard. Operational
// statuses (enroute/onscene/busy, or going available mid-shift) stay on the
// legacy /dispatch/units/:id/status path, which owns the live /api/ws
// broadcast + transition guard. These tests lock that split in place.

const MY_UNIT_ID = 7;

// `mock`-prefixed so vitest's vi.mock hoisting allows the factories to close
// over them (see the ShiftCard test for the same pattern).
const mockApiFetch = vi.fn();
const mockAddToast = vi.fn();

vi.mock('../../hooks/useApi', () => ({ apiFetch: (...a: any[]) => mockApiFetch(...a) }));
vi.mock('../../hooks/useGpsTracking', () => ({
  // myUnit is resolved by matching units[].id === gps.unitId in fetchData.
  useGpsTracking: () => ({ unitId: 7, latitude: null, longitude: null }),
}));
vi.mock('../../hooks/useLiveSync', () => ({ useLiveSync: () => {} }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: () => () => {} }),
}));
vi.mock('../../components/ToastProvider', () => ({
  useToast: () => ({ addToast: (...a: any[]) => mockAddToast(...a) }),
}));
// The always-mounted modals subscribe to WS events we don't exercise here.
vi.mock('../../components/PremiseAlertModal', () => ({ default: () => null }));
vi.mock('../../components/WelfareCheckModal', () => ({ default: () => null }));

// Per-test knobs for the path-keyed apiFetch mock.
let unitStatus = 'off_duty';
let dutyStartRejects: any = null;

function installApiMock() {
  mockApiFetch.mockImplementation(async (path: string, _opts?: any) => {
    if (path.startsWith('/dispatch/calls')) return { data: [] };
    if (path === '/dispatch/units') return [{ id: MY_UNIT_ID, call_sign: 'D19', status: unitStatus }];
    if (path.startsWith('/comms/messages')) return { data: [], unreadCount: 0 };
    if (path === '/dispatch/duty/start' && dutyStartRejects) throw dutyStartRejects;
    return {}; // duty/start (ok), duty/end, units/:id/status, audio sync, …
  });
}

async function renderMdt() {
  const { default: MdtPage } = await import('../MdtPage');
  render(<MdtPage />);
  // Status buttons are disabled until fetchData resolves myUnit.
  await waitFor(() => expect(screen.getByRole('button', { name: 'OFF' })).toBeEnabled());
}

const calledWith = (path: string, method?: string) =>
  mockApiFetch.mock.calls.some(
    ([p, o]: any[]) => p === path && (method ? o?.method === method : true),
  );

beforeEach(() => {
  cleanup();
  mockApiFetch.mockReset();
  mockAddToast.mockReset();
  unitStatus = 'off_duty';
  dutyStartRejects = null;
  installApiMock();
});

describe('MdtPage — duty boundary routing', () => {
  it('module loads', async () => {
    const mod = await import('../MdtPage');
    expect(mod.default).toBeDefined();
  });

  it('OFF → POST /dispatch/duty/end (clock out + release vehicle), not legacy status', async () => {
    await renderMdt();
    fireEvent.click(screen.getByRole('button', { name: 'OFF' }));

    await waitFor(() => expect(calledWith('/dispatch/duty/end', 'POST')).toBe(true));
    // OFF must NOT take the legacy units/:id/status path.
    expect(calledWith(`/dispatch/units/${MY_UNIT_ID}/status`)).toBe(false);
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringMatching(/shift ended/i), 'success');

    const end = mockApiFetch.mock.calls.find(([p]: any[]) => p === '/dispatch/duty/end');
    expect(JSON.parse(end![1].body).unit_id).toBe(String(MY_UNIT_ID));
  });

  it('AVAIL while off_duty → POST /dispatch/duty/start (clock in + assign vehicle)', async () => {
    await renderMdt();
    fireEvent.click(screen.getByRole('button', { name: 'AVAIL' }));

    await waitFor(() => expect(calledWith('/dispatch/duty/start', 'POST')).toBe(true));
    expect(calledWith(`/dispatch/units/${MY_UNIT_ID}/status`)).toBe(false);
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringMatching(/on duty/i), 'success');
  });

  it('AVAIL mid-shift (not off_duty) stays on the legacy status path', async () => {
    unitStatus = 'busy';
    await renderMdt();
    fireEvent.click(screen.getByRole('button', { name: 'AVAIL' }));

    await waitFor(() => expect(calledWith(`/dispatch/units/${MY_UNIT_ID}/status`, 'PUT')).toBe(true));
    // Mid-shift available is operational, not a duty boundary.
    expect(calledWith('/dispatch/duty/start')).toBe(false);

    const put = mockApiFetch.mock.calls.find(([p]: any[]) => p === `/dispatch/units/${MY_UNIT_ID}/status`);
    expect(JSON.parse(put![1].body).status).toBe('available');
  });

  it('operational statuses (ENROUTE) stay on the legacy status path', async () => {
    await renderMdt();
    fireEvent.click(screen.getByRole('button', { name: 'ENROUTE' }));

    await waitFor(() => expect(calledWith(`/dispatch/units/${MY_UNIT_ID}/status`, 'PUT')).toBe(true));
    // No duty endpoint should fire for an operational transition.
    expect(mockApiFetch.mock.calls.some(([p]: any[]) => String(p).startsWith('/dispatch/duty/'))).toBe(false);

    const put = mockApiFetch.mock.calls.find(([p]: any[]) => p === `/dispatch/units/${MY_UNIT_ID}/status`);
    expect(JSON.parse(put![1].body).status).toBe('enroute');
  });

  it('409 NEEDS_VEHICLE on going on duty directs the officer to the Shift card', async () => {
    dutyStartRejects = Object.assign(new Error('No take-home vehicle'), {
      status: 409,
      code: 'NEEDS_VEHICLE',
      payload: { needs_vehicle: true, code: 'NEEDS_VEHICLE', available_vehicles: [{ id: 9, vehicle_number: 'FV-9' }] },
    });
    await renderMdt();
    fireEvent.click(screen.getByRole('button', { name: 'AVAIL' }));

    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith(expect.stringMatching(/shift card/i), 'warning'),
    );
    // The structured 409 must not fall through to the generic failure toast.
    expect(mockAddToast).not.toHaveBeenCalledWith(expect.stringMatching(/failed to change/i), 'error');
  });
});
