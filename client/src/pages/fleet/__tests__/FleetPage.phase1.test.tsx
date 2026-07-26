import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    await user.click(await screen.findByText('PS-D19'));
    await user.click(await screen.findByRole('button', { name: /pre-trip/i }));

    const dialog = await screen.findByRole('dialog', { name: /pre-trip/i });
    await user.click(within(dialog).getByText('Brakes')); // now answered

    await user.click(screen.getByTestId('pretrip-backdrop'));

    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /pre-trip/i })).toBeInTheDocument();
  });

  it('closes without a prompt when the checklist is untouched', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderPage();
    await user.click(await screen.findByText('PS-D19'));
    await user.click(await screen.findByRole('button', { name: /pre-trip/i }));
    await user.click(screen.getByTestId('pretrip-backdrop'));

    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /pre-trip/i })).toBeNull());
  });
});
