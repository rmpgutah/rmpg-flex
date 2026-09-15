import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SafeWatchPage from '../SafeWatchPage';

const ALERTS = [
  {
    id: 1, external_id: 'sw_1', source_kind: 'community', source: 'safewatch',
    alert_type: 'suspicious_activity', severity: 'urgent',
    headline: 'Group loitering behind the strip mall',
    body: 'Three people, one carrying a crowbar.',
    location_text: '900 S State St', latitude: 40.7508, longitude: -111.888,
    reporter_contact: 'resident@example.com', occurred_at: '2026-09-15T18:04:00.000Z',
    received_at: '2026-09-15 18:05:00', status: 'new',
    reviewed_by: null, reviewed_at: null, promoted_tip_id: null,
  },
  {
    id: 2, external_id: 'nws_9', source_kind: 'feed', source: 'nws',
    alert_type: 'flash_flood', severity: 'advisory',
    headline: 'Flash flood advisory for Salt Lake valley',
    body: null, location_text: 'Salt Lake County', latitude: null, longitude: null,
    reporter_contact: null, occurred_at: null,
    received_at: '2026-09-15 17:00:00', status: 'reviewed',
    reviewed_by: 3, reviewed_at: '2026-09-15 17:10:00', promoted_tip_id: null,
  },
];

const STATS = { new_alerts: 1, reviewed: 1, promoted: 0, dismissed: 0 };

const apiFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

let role = 'supervisor';
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role, full_name: 'Test Sup', username: 'sup' } }),
}));

const addToast = vi.fn();
vi.mock('../../components/ToastProvider', () => ({ useToast: () => ({ addToast }) }));

function mockList(alerts = ALERTS, stats = STATS) {
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return { data: { ...alerts[0], status: 'dismissed' } };
    if (String(path).includes('/promote')) {
      return { data: { ...alerts[0], status: 'promoted', promoted_tip_id: 42 }, tip_id: 42, tip_number: 'TIP-26-0001', created: true };
    }
    return { data: alerts, stats };
  });
}

beforeEach(() => {
  role = 'supervisor';
  apiFetch.mockReset();
  addToast.mockReset();
  mockList();
});

const renderPage = () => render(<MemoryRouter><SafeWatchPage /></MemoryRouter>);

// The stat tiles are also buttons ("Promoted", "Dismissed"), so triage
// actions must be queried inside the detail panel, not the whole page.
const panel = async () => within(await screen.findByRole('region', { name: /alert detail/i }));

describe('SafeWatchPage', () => {
  it('lists inbound alerts with their provenance', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(ALERTS[0].headline)).toBeInTheDocument());
    expect(screen.getByText(ALERTS[1].headline)).toBeInTheDocument();
    // Provenance must be visible in the row, not buried in the detail panel:
    // a dispatcher has to tell a resident report from an NWS feed item at a glance.
    expect(screen.getByText(/nws/i)).toBeInTheDocument();
  });

  it('warns that the queue is unverified public input', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(ALERTS[0].headline)).toBeInTheDocument());
    expect(screen.getByText(/unverified/i)).toBeInTheDocument();
  });

  it('renders the stat tiles', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(ALERTS[0].headline)).toBeInTheDocument());
    const tile = screen.getByRole('button', { name: /new/i });
    expect(within(tile).getByText('1')).toBeInTheDocument();
  });

  it('filters by status when a stat tile is clicked', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(ALERTS[0].headline)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /new/i }));
    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([p]) => String(p).includes('status=new'))).toBe(true);
    });
  });

  it('opens a detail panel with the full report and reporter contact', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(ALERTS[0].headline)).toBeInTheDocument());
    fireEvent.click(screen.getByText(ALERTS[0].headline));
    await waitFor(() => expect(screen.getByText(/Three people, one carrying a crowbar/)).toBeInTheDocument());
    expect(screen.getByText('resident@example.com')).toBeInTheDocument();
  });

  it('dismisses an alert via PATCH', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(ALERTS[0].headline)).toBeInTheDocument());
    fireEvent.click(screen.getByText(ALERTS[0].headline));
    fireEvent.click((await panel()).getByRole('button', { name: /dismiss/i }));
    await waitFor(() => {
      const call = apiFetch.mock.calls.find(([, i]) => (i as RequestInit)?.method === 'PATCH');
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ status: 'dismissed' });
    });
  });

  it('requires confirmation before promoting into records', async () => {
    // Promotion moves untrusted public input into an authoritative record —
    // it must never be a single misclick.
    renderPage();
    await waitFor(() => expect(screen.getByText(ALERTS[0].headline)).toBeInTheDocument());
    fireEvent.click(screen.getByText(ALERTS[0].headline));
    fireEvent.click((await panel()).getByRole('button', { name: /promote to tip/i }));

    expect(apiFetch.mock.calls.some(([p]) => String(p).includes('/promote'))).toBe(false);
    await screen.findByText(/confirm promotion/i);

    fireEvent.click((await panel()).getByRole('button', { name: /^confirm$/i }));
    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([p]) => String(p).includes('/promote'))).toBe(true);
    });
  });

  it('reports the created tip number after promoting', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(ALERTS[0].headline)).toBeInTheDocument());
    fireEvent.click(screen.getByText(ALERTS[0].headline));
    fireEvent.click((await panel()).getByRole('button', { name: /promote to tip/i }));
    fireEvent.click((await panel()).getByRole('button', { name: /^confirm$/i }));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(expect.stringContaining('TIP-26-0001'), expect.anything());
    });
  });

  it('hides triage actions from a role that cannot write', async () => {
    role = 'officer';
    renderPage();
    await waitFor(() => expect(screen.getByText(ALERTS[0].headline)).toBeInTheDocument());
    fireEvent.click(screen.getByText(ALERTS[0].headline));
    const p = await panel();
    expect(p.getByText(/Three people/)).toBeInTheDocument();
    expect(p.queryByRole('button', { name: /promote to tip/i })).not.toBeInTheDocument();
    expect(p.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it('shows an empty state rather than a blank table', async () => {
    mockList([], { new_alerts: 0, reviewed: 0, promoted: 0, dismissed: 0 });
    renderPage();
    await waitFor(() => expect(screen.getByText(/no safewatch alerts/i)).toBeInTheDocument());
  });

  it('survives a failed fetch without crashing', async () => {
    apiFetch.mockRejectedValue(new Error('network'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/no safewatch alerts/i)).toBeInTheDocument());
  });
});
