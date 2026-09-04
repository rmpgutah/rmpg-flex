import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PersonDossierPage from '../PersonDossierPage';
import { ToastProvider } from '../../components/ToastProvider';

const fullDossier = {
  person: { id: 1, first_name: 'John', last_name: 'Smith', dob: '1990-01-01', gender: 'M', race: 'W' },
  cluster: [{ person_id: 9, name: 'Jon Smith' }],
  flags: ['ACTIVE WARRANT'],
  timeline: [
    { kind: 'call', id: 3, date: '2026-05-01T10:00:00', title: 'CFS-3', subtitle: 'Disturbance — 123 Main St', status: 'closed' },
    { kind: 'warrant', id: 4, date: '2026-04-01', title: 'W-4', subtitle: 'FTA', status: 'active' },
  ],
  associates: [{ person_id: 5, name: 'A B', shared_events: 2, kinds: ['call'] }],
  vehicles: [{ id: 7, color: 'Red', year: 2020, make: 'Ford', model: 'F-150', plate_number: 'ABC123' }],
  addresses: [{ address: '123 Main St, SLC', source: 'record' }],
  linked_intel: [
    { id: 42, report_number: 'IR-2026-0042', title: 'Stash house surveillance', threat_level: 'high', role: 'subject', disseminated_at: '2026-05-15', handling_code: 'LES' },
  ],
  watched: false,
  escalation: { recent: 7, baseline: 1.2, ratio: 5.8, trend: 'escalating' },
};

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => fullDossier),
}));

// useAuth is used for role-gating (canManage) and N shortcut; stub as admin for tests.
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'admin', full_name: 'Test Admin', username: 'testadmin' } }),
}));

describe('PersonDossierPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders identity, flags, timeline, associates, vehicles', async () => {
    render(
      <ToastProvider><MemoryRouter initialEntries={['/intel/person/1']}>
        <Routes><Route path="/intel/person/:id" element={<PersonDossierPage />} /></Routes>
      </MemoryRouter></ToastProvider>,
    );
    await waitFor(() => expect(screen.getByText('John Smith')).toBeInTheDocument());
    expect(screen.getByText('ACTIVE WARRANT')).toBeInTheDocument();
    expect(screen.getByText('CFS-3')).toBeInTheDocument();
    expect(screen.getByText('A B')).toBeInTheDocument();
    expect(screen.getByText(/Red 2020 Ford F-150/)).toBeInTheDocument();
    expect(screen.getByText(/1 LINKED IDENTITY/)).toBeInTheDocument();
  });

  it('renders Linked Intelligence section when server returns linked_intel', async () => {
    render(
      <ToastProvider><MemoryRouter initialEntries={['/intel/person/1']}>
        <Routes><Route path="/intel/person/:id" element={<PersonDossierPage />} /></Routes>
      </MemoryRouter></ToastProvider>,
    );
    await waitFor(() => expect(screen.getByText('John Smith')).toBeInTheDocument());
    expect(screen.getByText(/LINKED INTELLIGENCE \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('IR-2026-0042')).toBeInTheDocument();
    expect(screen.getByText('Stash house surveillance')).toBeInTheDocument();
    expect(screen.getByText('HIGH')).toBeInTheDocument();
  });

  it('renders escalation chip with hover detail', async () => {
    render(
      <ToastProvider><MemoryRouter initialEntries={['/intel/person/1']}>
        <Routes><Route path="/intel/person/:id" element={<PersonDossierPage />} /></Routes>
      </MemoryRouter></ToastProvider>,
    );
    await waitFor(() => expect(screen.getByText('John Smith')).toBeInTheDocument());
    const chip = screen.getByText(/ESCALATING 5\.8×/);
    expect(chip).toBeInTheDocument();
    expect(chip.getAttribute('title')).toContain('Recent 30d: 7');
  });

  it('renders distinct "not found" empty state on 404', async () => {
    const { apiFetch } = await import('../../hooks/useApi');
    (apiFetch as any).mockRejectedValueOnce(Object.assign(new Error('Person not found'), { status: 404 }));
    render(
      <ToastProvider><MemoryRouter initialEntries={['/intel/person/9999']}>
        <Routes><Route path="/intel/person/:id" element={<PersonDossierPage />} /></Routes>
      </MemoryRouter></ToastProvider>,
    );
    await waitFor(() => expect(screen.getByText(/No person on file/)).toBeInTheDocument());
    // "← Back" button uses a navigate(-1) — just confirm it rendered.
    expect(screen.getByText(/← Back/)).toBeInTheDocument();
  });

  it('Esc key fires a navigation handler (no error / no crash)', async () => {
    render(
      <ToastProvider><MemoryRouter initialEntries={['/intel/person/1']}>
        <Routes><Route path="/intel/person/:id" element={<PersonDossierPage />} /></Routes>
      </MemoryRouter></ToastProvider>,
    );
    await waitFor(() => expect(screen.getByText('John Smith')).toBeInTheDocument());
    // Just confirm the handler is wired and doesn't throw — actual navigate(-1)
    // behavior is exercised by the router, not asserted here.
    fireEvent.keyDown(window, { key: 'Escape' });
  });
});
