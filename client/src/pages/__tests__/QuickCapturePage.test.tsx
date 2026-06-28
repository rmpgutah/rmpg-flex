import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import QuickCapturePage from '../QuickCapturePage';
import { ToastProvider } from '../../components/ToastProvider';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'officer', full_name: 'Test Officer', username: 'testofficer' } }),
}));

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path.startsWith('/intel/quick-capture')) {
      return {
        success: true, person_id: 12, person_reused: false, vehicle_id: null, fi_id: 9,
        associated_call_id: null, associated_incident_id: null,
        hits: [{ kind: 'active_warrant', severity: 'critical', detail: 'Active warrant W-4 — FTA' }],
      };
    }
    return {};
  }),
}));

// Wrap with both router + ToastProvider — the page now uses useToast for
// hit announcements and GPS failure surfacing.
function renderPage(initial = '/intel/quick-capture') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <ToastProvider>
        <QuickCapturePage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('QuickCapturePage', () => {
  beforeEach(() => vi.stubGlobal('navigator', { ...navigator, geolocation: undefined }));

  it('captures a contact and shows the hit banner + dossier link', async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'Smith' } });
    fireEvent.click(screen.getByText('CAPTURE + CHECK'));
    await waitFor(() => expect(screen.getAllByText(/Active warrant W-4/).length).toBeGreaterThan(0));
    expect(screen.getByText(/Open dossier/)).toBeInTheDocument();
  });

  it('renders the linked-context chip when ?call_id= is in the URL', async () => {
    renderPage('/intel/quick-capture?call_id=123');
    expect(await screen.findByText('Call #123')).toBeInTheDocument();
    expect(screen.getByLabelText('Unlink call/incident context')).toBeInTheDocument();
  });

  it('handles ?incident_id= deep-link', async () => {
    renderPage('/intel/quick-capture?incident_id=77');
    expect(await screen.findByText('Incident #77')).toBeInTheDocument();
  });

  it('N shortcut focuses first name when not typing', () => {
    renderPage();
    fireEvent.keyDown(window, { key: 'n' });
    expect(document.activeElement).toBe(screen.getByPlaceholderText('First name'));
  });

  it('Esc with typed content opens discard confirm dialog', async () => {
    renderPage();
    const last = screen.getByPlaceholderText('Last name') as HTMLInputElement;
    fireEvent.change(last, { target: { value: 'Smith' } });
    expect(last.value).toBe('Smith');
    fireEvent.keyDown(window, { key: 'Escape' });
    // Esc now opens the ConfirmDialog instead of clearing immediately.
    expect(await screen.findByText('Discard capture?')).toBeInTheDocument();
  });
});
