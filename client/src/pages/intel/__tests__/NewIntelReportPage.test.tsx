import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi, describe, it, expect } from 'vitest';
import NewIntelReportPage from '../NewIntelReportPage';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../../hooks/useApi', () => ({ apiFetch }));

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/intel/reports/new" element={<NewIntelReportPage />} />
        <Route path="/intel/reports/:id" element={<div>detail-99</div>} />
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
    await waitFor(() => expect(screen.getByText('detail-99')).toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledWith('/intel/reports', expect.objectContaining({ method: 'POST' }));
  });
});
