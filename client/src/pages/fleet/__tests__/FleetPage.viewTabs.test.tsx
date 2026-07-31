import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import FleetPage from '../FleetPage';
import { ToastProvider } from '../../../components/ToastProvider';

// ------------------------------------------------------------------
// Mocks — keep this a focused unit test of the fleet-wide view tablist
// (arrow-key/Home/End navigation + focus management + the Work Orders
// vehicle-filter reset), not an integration test of every fleet tab.
// ------------------------------------------------------------------

vi.mock('../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'admin' } }),
}));

vi.mock('../../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: vi.fn().mockReturnValue(() => {}) }),
}));

// FleetDetailPanel is a large, independently-tested component. Stub it down
// to just the one seam this test needs: a button that invokes
// onViewAllWorkOrders, exactly like the real "View all ->" control inside
// the Costs tab's OpenWorkOrdersPanel does.
vi.mock('../FleetDetailPanel', () => ({
  default: ({ actions }: { actions: { onViewAllWorkOrders: () => void } }) => (
    <button type="button" onClick={actions.onViewAllWorkOrders}>
      trigger view all work orders
    </button>
  ),
}));

// FleetWorkOrdersTab is mocked so the test can directly observe the
// initialVehicleId prop it receives — the concrete signal that the
// per-vehicle filter was (or wasn't) reset.
vi.mock('../tabs/FleetWorkOrdersTab', () => ({
  default: ({ initialVehicleId }: { initialVehicleId?: number }) => (
    <div data-testid="wo-tab">initialVehicleId:{String(initialVehicleId)}</div>
  ),
}));

function renderFleetPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <FleetPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('FleetPage fleet-wide view tablist', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedApiFetch.mockReset();
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/fleet?archived=')) return Promise.resolve({ data: [{ id: 1, vehicle_number: 'U-1', status: 'in_service' }] });
      if (url === '/fleet/1') return Promise.resolve({ id: 1, vehicle_number: 'U-1', status: 'in_service' });
      return Promise.reject(new Error('unexpected url ' + url));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resets the per-vehicle work-orders filter when the Work Orders tab is activated after a per-vehicle deep link', async () => {
    const user = userEvent.setup();
    renderFleetPage();

    // Drive the filter into a non-null state via the same seam the real
    // "View all ->" work-orders control uses (FleetDetailPanel's
    // onViewAllWorkOrders), then confirm the fleet-wide Work Orders view
    // shows the per-vehicle filter (sanity check the seam actually wires up).
    await waitFor(() => expect(screen.getByRole('tablist', { name: 'Fleet-wide views' })).toBeInTheDocument());

    // Select the vehicle so FleetDetailPanel (stub) mounts.
    await user.click(screen.getByText('U-1'));
    await waitFor(() => expect(screen.getByText('trigger view all work orders')).toBeInTheDocument());
    await user.click(screen.getByText('trigger view all work orders'));

    await waitFor(() => expect(screen.getByTestId('wo-tab')).toHaveTextContent('initialVehicleId:1'));

    // Navigate away, then explicitly reactivate Work Orders via the tablist —
    // this must reset the stale per-vehicle filter (this is the behavior
    // under test; it is NOT covered by the assertion above).
    await user.click(screen.getByRole('tab', { name: 'Dashboard' }));
    await user.click(screen.getByRole('tab', { name: 'Work Orders' }));

    await waitFor(() => expect(screen.getByTestId('wo-tab')).toHaveTextContent('initialVehicleId:undefined'));
  });

  it('ArrowRight moves selection and DOM focus to the next tab, and ArrowLeft from the first tab wraps to the last', async () => {
    const user = userEvent.setup();
    renderFleetPage();
    await waitFor(() => expect(screen.getByRole('tablist', { name: 'Fleet-wide views' })).toBeInTheDocument());

    const dashboardTab = screen.getByRole('tab', { name: 'Dashboard' });
    const analysisTab = screen.getByRole('tab', { name: 'Analysis Reports' });
    const serviceTab = screen.getByRole('tab', { name: 'Service' });

    dashboardTab.focus();
    expect(document.activeElement).toBe(dashboardTab);

    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(analysisTab).toHaveAttribute('aria-selected', 'true'));
    expect(document.activeElement).toBe(analysisTab);

    // Wrap: ArrowLeft from the first tab (Dashboard) goes to the last (Service).
    // Reselect Dashboard first — the previous ArrowRight left viewMode on
    // Analysis, and the handler computes "current" from viewMode, not from
    // DOM focus.
    await user.click(dashboardTab);
    dashboardTab.focus();
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(serviceTab).toHaveAttribute('aria-selected', 'true'));
    expect(document.activeElement).toBe(serviceTab);
  });

  it('Home selects the first tab and End selects the last', async () => {
    const user = userEvent.setup();
    renderFleetPage();
    await waitFor(() => expect(screen.getByRole('tablist', { name: 'Fleet-wide views' })).toBeInTheDocument());

    const dashboardTab = screen.getByRole('tab', { name: 'Dashboard' });
    const serviceTab = screen.getByRole('tab', { name: 'Service' });

    dashboardTab.focus();
    await user.keyboard('{End}');
    await waitFor(() => expect(serviceTab).toHaveAttribute('aria-selected', 'true'));
    expect(document.activeElement).toBe(serviceTab);

    await user.keyboard('{Home}');
    await waitFor(() => expect(dashboardTab).toHaveAttribute('aria-selected', 'true'));
    expect(document.activeElement).toBe(dashboardTab);
  });
});
