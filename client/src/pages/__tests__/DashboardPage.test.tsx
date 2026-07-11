import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from '../DashboardPage';

const mockApiFetch = vi.fn();
const mockAddToast = vi.fn();

vi.mock('../../hooks/useApi', () => ({ apiFetch: (...a: any[]) => mockApiFetch(...a) }));
vi.mock('../../hooks/useLiveSync', () => ({ useLiveSync: () => {} }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../mobile/hooks/useGeolocation', () => ({ useGeolocation: () => ({ status: 'denied', position: null }) }));
vi.mock('../../components/ToastProvider', () => ({
  useToast: () => ({ addToast: (...a: any[]) => mockAddToast(...a) }),
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'admin', id: 1, full_name: 'Admin User' } }),
}));
vi.mock('../../components/NewCallModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="new-call-modal" /> : null,
}));
vi.mock('../../components/IncidentFormModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="incident-modal" /> : null,
}));
// Recharts — stub the SVG rendering to avoid resize/polyfill issues
vi.mock('recharts', () => {
  const FakeChart = ({ children }: any) => <div>{children}</div>;
  return {
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    BarChart: FakeChart, Bar: () => null,
    XAxis: () => null, YAxis: () => null,
    CartesianGrid: () => null, Tooltip: () => null,
    Cell: () => null, AreaChart: FakeChart, Area: () => null,
    PieChart: FakeChart, Pie: () => null,
  };
});

const DEFAULT_DASHBOARD_RESPONSE = {
  activeCalls: 5, todayCalls: 12, unitsOnDuty: 3, totalUnits: 8,
  pendingReports: 2, activeBolos: 1, unreadMessages: 0,
  avgResponseMinutes: 4.5,
  callsByPriority: [{ priority: 'P1', count: 1 }, { priority: 'P2', count: 2 }, { priority: 'P3', count: 1 }, { priority: 'P4', count: 1 }],
  callsByStatus: [{ status: 'pending', count: 5 }],
  recentActivity: [], officersOnDuty: [], callsByHour: [],
  activeWarrants: 3, pendingServe: 2, openCases: 10, totalPersons: 450,
};

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes('/reports/dashboard')) return DEFAULT_DASHBOARD_RESPONSE;
      if (url.includes('/comms/activity-feed')) return { data: [] };
      if (url.includes('/comms/bolos/active')) return [];
      if (url.includes('/warrants')) return { pagination: { total: 3 } };
      if (url.includes('/personnel/credentials')) return [];
      if (url.includes('/reports/officer-activity')) return [];
      if (url.includes('/reports/shift-comparison')) return null;
      if (url.includes('/reports/clearance-rate')) return null;
      if (url.includes('/reports/patrol-coverage')) return null;
      if (url.includes('/reports/evidence-pending')) return null;
      if (url.includes('/reports/upcoming-court')) return null;
      if (url.includes('/reports/overdue-reports')) return null;
      if (url.includes('/admin/shift-stats')) return null;
      if (url.includes('/admin/upcoming-court-dates')) return null;
      if (url.includes('/admin/expiring-certifications')) return null;
      if (url.includes('/weather')) return { current: { temperature_2m: 72, weather_code: 0, relative_humidity_2m: 35, wind_speed_10m: 5, wind_direction_10m: 180 } };
      if (url.includes('/warrants/watch/runs')) return { data: [] };
      return {};
    });
  });

  it('renders the dashboard title after loading', async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Command & Control Dashboard')).toBeTruthy();
    });
  });

  it('renders stat cards with API data', async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Active Calls')).toBeTruthy();
      expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Units Available')).toBeTruthy();
      expect(screen.getByText(/3 \/ 8/)).toBeTruthy();
    });
  });

  it('renders the Status Summary row with secondary metrics', async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    // "Active Warrants" appears both in Status Summary and Active Units panels
    await waitFor(() => {
      expect(screen.getByText('Status Summary')).toBeTruthy();
      expect(screen.getAllByText('Active Warrants').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Pending Serve')).toBeTruthy();
      expect(screen.getByText('Open Cases')).toBeTruthy();
      expect(screen.getByText('Total Persons')).toBeTruthy();
    });
  });

  it('shows loading skeleton initially', () => {
    mockApiFetch.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    const skeleton = container.querySelector('[aria-busy="true"]');
    expect(skeleton).toBeTruthy();
  });
});
