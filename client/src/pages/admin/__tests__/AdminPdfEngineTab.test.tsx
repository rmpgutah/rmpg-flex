import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminPdfEngineTab from '../AdminPdfEngineTab';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));
vi.mock('../../../utils/pdf/facade', () => ({
  invalidateFlagsCache: vi.fn(),
}));
vi.mock('../../../utils/pdf/v2/forms', () => ({
  getV2Schema: () => ({
    meta: { formNumber: 'X', title: 'X', revision: 'R' },
    header: { kind: 'default', formId: 'x' },
    sections: [],
  }),
}));

import { apiFetch } from '../../../hooks/useApi';

const Spinner = () => <div data-testid="spinner">…</div>;

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
});

afterEach(() => { vi.clearAllMocks(); });

describe('AdminPdfEngineTab', () => {
  it('shows a spinner then loads flag rows', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      incident_blank: false, person_blank: true, fleet: false,
    } as any);
    render(<AdminPdfEngineTab LoadingSpinner={Spinner} error={null} setError={() => {}} />);
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    await screen.findByText(/Incident Report \(blank\)/);
    expect(screen.getByText(/Person Record \(blank\)/)).toBeInTheDocument();
  });

  it('toggles a flag on click', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ incident_blank: false } as any);
    vi.mocked(apiFetch).mockResolvedValueOnce({ success: true } as any);
    render(<AdminPdfEngineTab LoadingSpinner={Spinner} error={null} setError={() => {}} />);

    const row = await screen.findByText(/Incident Report \(blank\)/);
    const tr = row.closest('tr')!;
    // Click the toggle (last button in the row) — the disabled-state hint guards non-schema rows
    const buttons = tr.querySelectorAll('button');
    const toggleBtn = buttons[buttons.length - 1];
    await userEvent.click(toggleBtn);

    await waitFor(() => {
      expect(vi.mocked(apiFetch)).toHaveBeenCalledWith(
        '/api/admin/pdf-engine/flags/incident_blank',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  it('Revert All button asks for confirmation and hits the endpoint', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      incident_blank: true, person_blank: true,
    } as any);
    vi.mocked(apiFetch).mockResolvedValueOnce({ success: true } as any);
    vi.mocked(apiFetch).mockResolvedValueOnce({} as any);  // post-revert reload

    render(<AdminPdfEngineTab LoadingSpinner={Spinner} error={null} setError={() => {}} />);
    await screen.findByText(/Incident Report \(blank\)/);

    await userEvent.click(screen.getByText(/Revert All to v1/));
    await userEvent.click(screen.getByText(/Yes, revert/));

    await waitFor(() => {
      expect(vi.mocked(apiFetch)).toHaveBeenCalledWith(
        '/api/admin/pdf-engine/revert-all',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });
});
