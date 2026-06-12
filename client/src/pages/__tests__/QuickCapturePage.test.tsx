import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import QuickCapturePage from '../QuickCapturePage';

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => ({
    success: true, person_id: 12, person_reused: false, vehicle_id: null, fi_id: 9,
    hits: [{ kind: 'active_warrant', severity: 'critical', detail: 'Active warrant W-4 — FTA' }],
  })),
}));

describe('QuickCapturePage', () => {
  beforeEach(() => vi.stubGlobal('navigator', { ...navigator, geolocation: undefined }));

  it('captures a contact and shows the hit banner + dossier link', async () => {
    render(<MemoryRouter><QuickCapturePage /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'Smith' } });
    fireEvent.click(screen.getByText('CAPTURE + CHECK'));
    await waitFor(() => expect(screen.getByText(/Active warrant W-4/)).toBeInTheDocument());
    expect(screen.getByText('Open dossier →')).toBeInTheDocument();
  });
});
