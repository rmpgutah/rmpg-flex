import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi, describe, it, expect, afterEach } from 'vitest';
import NewIntelReportPage from '../NewIntelReportPage';

afterEach(cleanup);

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../../hooks/useApi', () => ({ apiFetch }));

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/intel/reports/new" element={<NewIntelReportPage />} />
        <Route path="/intel/reports/:id" element={<div>report-detail</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('NewIntelReportPage', () => {
  it('prefills title from ?from + label', () => {
    apiFetch.mockReset();
    renderAt('/intel/reports/new?from=person:42&label=Jane%20Doe');
    expect((screen.getByLabelText(/title/i) as HTMLInputElement).value).toMatch(/Jane Doe/);
  });

  it('submits a report and navigates to its detail', async () => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ id: 99 });
    renderAt('/intel/reports/new');
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Test report' } });
    fireEvent.click(screen.getByText(/submit report/i));
    await waitFor(() => expect(screen.getByText('report-detail')).toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledWith('/intel/reports', expect.objectContaining({ method: 'POST' }));
  });

  it('auto-links the entity when launched from a dossier', async () => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ id: 77 });
    renderAt('/intel/reports/new?from=person:42&label=Jane%20Doe');
    fireEvent.click(screen.getByText(/submit report/i));
    await waitFor(() => expect(screen.getByText('report-detail')).toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledWith('/intel/reports/77/links', expect.objectContaining({ method: 'POST' }));
  });
});
