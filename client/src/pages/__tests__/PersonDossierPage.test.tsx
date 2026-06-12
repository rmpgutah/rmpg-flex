import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi, describe, it, expect } from 'vitest';
import PersonDossierPage from '../PersonDossierPage';

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => ({
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
  })),
}));

describe('PersonDossierPage', () => {
  it('renders identity, flags, timeline, associates, vehicles', async () => {
    render(
      <MemoryRouter initialEntries={['/intel/person/1']}>
        <Routes><Route path="/intel/person/:id" element={<PersonDossierPage />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('John Smith')).toBeInTheDocument());
    expect(screen.getByText('ACTIVE WARRANT')).toBeInTheDocument();
    expect(screen.getByText('CFS-3')).toBeInTheDocument();
    expect(screen.getByText('A B')).toBeInTheDocument();
    expect(screen.getByText(/Red 2020 Ford F-150/)).toBeInTheDocument();
    expect(screen.getByText(/1 LINKED IDENTITY/)).toBeInTheDocument();
  });
});
