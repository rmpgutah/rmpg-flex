import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import FleetPage from '../FleetPage';
import { ToastProvider } from '../../../components/ToastProvider';

vi.mock('../../../hooks/useApi', () => ({ apiFetch: vi.fn(), apiPostForm: vi.fn() }));
import { apiFetch } from '../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'admin' } }),
}));

vi.mock('../../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: vi.fn().mockReturnValue(() => {}) }),
}));

const VEHICLE = {
  id: 1, vehicle_number: 'PS-D19', make: 'Ford', model: 'Explorer', year: 2021,
  status: 'in_service', current_mileage: 42000,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <FleetPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('FleetPage — pre-trip modal', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    localStorage.clear();
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/fleet?')) {
        return Promise.resolve({ data: [VEHICLE], pagination: { total: 1 } });
      }
      if (url === '/fleet/1') return Promise.resolve(VEHICLE);
      if (url.startsWith('/fleet/analytics')) return Promise.resolve({ scope: 'fleet', fleet_summary: {} });
      if (url.startsWith('/form-drafts/')) return Promise.resolve({ data: null });
      return Promise.resolve({ data: [] });
    });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('gives every checklist item a distinct id bound to its label', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('PS-D19'));
    await user.click(await screen.findByRole('button', { name: /pre-trip/i }));

    const dialog = await screen.findByRole('dialog', { name: /pre-trip/i });
    const boxes = within(dialog).getAllByRole('checkbox');
    expect(boxes).toHaveLength(10);

    const ids = boxes.map((b) => b.id);
    expect(new Set(ids).size).toBe(10);
    expect(ids.every(Boolean)).toBe(true);

    // Label association: clicking the text toggles the box.
    const brakes = within(dialog).getByLabelText(/brakes/i);
    expect(brakes).toBeChecked();
    await user.click(within(dialog).getByText('Brakes'));
    expect(brakes).not.toBeChecked();
  });

  it('does not discard an answered checklist on a backdrop click', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('PS-D19'));
    await user.click(await screen.findByRole('button', { name: /pre-trip/i }));

    const dialog = await screen.findByRole('dialog', { name: /pre-trip/i });
    await user.click(within(dialog).getByText('Brakes')); // now answered

    await user.click(screen.getByTestId('pretrip-backdrop'));

    expect(await screen.findByRole('alertdialog', { name: /discard unsaved/i })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /pre-trip/i })).toBeInTheDocument();
  });

  it('closes without a prompt when the checklist is untouched', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('PS-D19'));
    await user.click(await screen.findByRole('button', { name: /pre-trip/i }));
    await user.click(screen.getByTestId('pretrip-backdrop'));

    expect(screen.queryByRole('alertdialog', { name: /discard unsaved/i })).toBeNull();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /pre-trip/i })).toBeNull());
  });
});

describe('FleetPage — tab persistence', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    localStorage.clear();
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/fleet?')) {
        return Promise.resolve({ data: [VEHICLE, { ...VEHICLE, id: 2, vehicle_number: 'PS-D20' }], pagination: { total: 2 } });
      }
      if (url === '/fleet/1' || url === '/fleet/2') return Promise.resolve(VEHICLE);
      if (url.startsWith('/fleet/analytics')) return Promise.resolve({ scope: 'vehicle', fleet_summary: {} });
      if (url.startsWith('/form-drafts/')) return Promise.resolve({ data: null });
      return Promise.resolve({ data: [] });
    });
  });

  it('restores the persisted tab on mount instead of forcing overview', async () => {
    localStorage.setItem('rmpg_fleet_tab', JSON.stringify('fuel'));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('PS-D19'));

    await waitFor(() => {
      // Note: 'fuel?' (not just 'fuel') so this doesn't false-match the
      // unrelated '/fleet/1/fuel-efficiency' analytics call that always
      // fires regardless of which tab is active.
      expect(mockedApiFetch).toHaveBeenCalledWith(expect.stringContaining('/fleet/1/fuel?'));
    });
  });

  it('still resets to overview when switching to a different vehicle', async () => {
    localStorage.setItem('rmpg_fleet_tab', JSON.stringify('fuel'));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('PS-D19'));
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledWith(expect.stringContaining('/fleet/1/fuel?')));

    mockedApiFetch.mockClear();
    await user.click(screen.getByText('PS-D20'));

    // Overview needs no per-tab fetch, so the assertion is the absence of one.
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledWith('/fleet/2'));
    expect(mockedApiFetch).not.toHaveBeenCalledWith(expect.stringContaining('/fleet/2/fuel?'));
  });

  it('marks the restored Fuel tab active on first selection, then Overview active on switching vehicles', async () => {
    localStorage.setItem('rmpg_fleet_tab', JSON.stringify('fuel'));
    const user = userEvent.setup();
    renderPage();

    // First selection of the first vehicle (null -> A): the restored tab
    // must stay active, not get clobbered back to Overview.
    await user.click(await screen.findByText('PS-D19'));

    const fuelTab = await screen.findByRole('tab', { name: 'Fuel' });
    await waitFor(() => expect(fuelTab).toHaveAttribute('aria-selected', 'true'));
    const overviewTabInitial = screen.getByRole('tab', { name: /overview/i });
    expect(overviewTabInitial).toHaveAttribute('aria-selected', 'false');

    // Switching to a different vehicle (A -> B) must reset to Overview.
    await user.click(screen.getByText('PS-D20'));

    const overviewTab = await screen.findByRole('tab', { name: /overview/i });
    await waitFor(() => expect(overviewTab).toHaveAttribute('aria-selected', 'true'));
    expect(fuelTab).toHaveAttribute('aria-selected', 'false');
  });
});

describe('FleetPage — per-vehicle Analytics period selector refetches', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    localStorage.clear();
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/fleet?')) return Promise.resolve({ data: [VEHICLE], pagination: { total: 1 } });
      if (url === '/fleet/1') return Promise.resolve(VEHICLE);
      if (url.startsWith('/fleet/analytics')) return Promise.resolve({ scope: 'vehicle', fleet_summary: {} });
      if (url.startsWith('/form-drafts/')) return Promise.resolve({ data: null });
      return Promise.resolve({ data: [] });
    });
  });

  it('issues a refetch carrying BOTH vehicle_id and the newly selected period', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('PS-D19'));
    await user.click(await screen.findByRole('tab', { name: /analytics/i }));

    await waitFor(() => {
      expect(mockedApiFetch).toHaveBeenCalledWith(expect.stringContaining('/fleet/analytics?vehicle_id=1'));
    });

    mockedApiFetch.mockClear();
    await user.click(await screen.findByRole('button', { name: '30D' }));

    await waitFor(() => {
      // Assert on the exact query string, not a loose substring: an
      // '/fleet/analytics?vehicle_id=1' prefix match alone wouldn't prove
      // period=30d was actually appended, and this program already had a
      // sibling-request false-match bug (stringContaining('/fleet/1/fuel')
      // also matching '/fleet/1/fuel-efficiency').
      const calledUrls = mockedApiFetch.mock.calls.map((c) => c[0]);
      expect(calledUrls).toContain('/fleet/analytics?vehicle_id=1&period=30d');
    });
  });
});

describe('FleetPage — cost-per-mile failure is visible', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    localStorage.clear();
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/fleet?')) return Promise.resolve({ data: [VEHICLE], pagination: { total: 1 } });
      if (url === '/fleet/1') return Promise.resolve(VEHICLE);
      if (url.startsWith('/fleet/cost-per-mile/')) return Promise.reject(new Error('Upstream 500'));
      if (url.startsWith('/fleet/analytics')) return Promise.resolve({ scope: 'fleet', fleet_summary: {} });
      if (url.startsWith('/form-drafts/')) return Promise.resolve({ data: null });
      return Promise.resolve({ data: [] });
    });
  });

  it('toasts instead of silently doing nothing when the fetch fails', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('PS-D19'));
    await user.click(await screen.findByRole('button', { name: /cost\/mi/i }));

    expect(await screen.findByText(/failed to load cost per mile/i)).toBeInTheDocument();
  });
});

describe('FleetPage — list truncation is visible', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    localStorage.clear();
  });

  it('reports the shortfall when the server returns fewer rows than exist', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/fleet?')) {
        return Promise.resolve({ data: [VEHICLE], pagination: { total: 240 } });
      }
      if (url.startsWith('/fleet/analytics')) return Promise.resolve({ scope: 'fleet', fleet_summary: {} });
      if (url.startsWith('/form-drafts/')) return Promise.resolve({ data: null });
      return Promise.resolve({ data: [] });
    });
    renderPage();
    expect(await screen.findByTestId('vehicle-count')).toHaveTextContent('1 of 240');
  });

  it('shows a plain count when nothing is truncated', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/fleet?')) {
        return Promise.resolve({ data: [VEHICLE], pagination: { total: 1 } });
      }
      if (url.startsWith('/fleet/analytics')) return Promise.resolve({ scope: 'fleet', fleet_summary: {} });
      if (url.startsWith('/form-drafts/')) return Promise.resolve({ data: null });
      return Promise.resolve({ data: [] });
    });
    renderPage();
    const el = await screen.findByTestId('vehicle-count');
    expect(el).toHaveTextContent('1');
    expect(el).not.toHaveTextContent('of');
  });

  it('requests an explicit page size rather than relying on the server default', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/fleet?')) return Promise.resolve({ data: [], pagination: { total: 0 } });
      if (url.startsWith('/fleet/analytics')) return Promise.resolve({ scope: 'fleet', fleet_summary: {} });
      if (url.startsWith('/form-drafts/')) return Promise.resolve({ data: null });
      return Promise.resolve({ data: [] });
    });
    renderPage();
    await waitFor(() => {
      expect(mockedApiFetch).toHaveBeenCalledWith(expect.stringContaining('per_page='));
    });
  });
});
