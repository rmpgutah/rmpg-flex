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

// `useFormDraft.isDirty` is gated on `initialRef.current !== ''`, and initialRef
// is written ONLY by snapshot(). A form whose modal never snapshots is therefore
// reported permanently clean — which silently disables the unsaved-changes
// guard, the floating save bar, and the modal's discard confirmation. These
// tests pin that every form modal takes its baseline, not just the vehicle one.
describe('FleetPage — every form modal establishes a dirty baseline', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    localStorage.clear();
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/fleet?')) {
        return Promise.resolve({ data: [VEHICLE], pagination: { total: 1 } });
      }
      if (url === '/fleet/1') return Promise.resolve(VEHICLE);
      if (url.startsWith('/form-drafts/')) return Promise.resolve({ data: null });
      if (url.startsWith('/fleet/analytics')) return Promise.resolve({ scope: 'fleet', fleet_summary: {} });
      return Promise.resolve({ data: [] });
    });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  async function openMaintenanceModal(user: ReturnType<typeof userEvent.setup>) {
    renderPage();
    await user.click(await screen.findByText('PS-D19'));
    await user.click(await screen.findByRole('button', { name: /^maintenance$/i }));
    return screen.findByRole('dialog');
  }

  it('marks a non-vehicle form dirty once edited, so the discard confirm fires', async () => {
    const user = userEvent.setup();
    const dialog = await openMaintenanceModal(user);

    await user.type(within(dialog).getByLabelText(/description/i), 'Brake pads');

    await user.click(within(dialog).getByRole('button', { name: /^x$/i }));
    expect(await screen.findByRole('alertdialog', { name: /discard unsaved/i })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not prompt when the form was opened but never touched', async () => {
    const user = userEvent.setup();
    const dialog = await openMaintenanceModal(user);

    await user.click(within(dialog).getByRole('button', { name: /^x$/i }));

    expect(screen.queryByRole('alertdialog', { name: /discard unsaved/i })).toBeNull();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
