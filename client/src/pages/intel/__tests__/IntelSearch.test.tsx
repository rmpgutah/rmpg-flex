import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect } from 'vitest';
import IntelSearch from '../IntelSearch';
import { IntelProvider } from '../IntelContext';

vi.mock('../../../context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAuth: () => ({ user: { id: 1, role: 'admin', username: 'test' } }),
  };
});

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path.includes('/intel/query')) return {
      results: [{ type: 'person', id: 2, label: 'HALE, Vincent', snippet: '', flags: ['ACTIVE WARRANT'], score: 95,
        cluster: { canonical_person_id: null, pending_suggestions: 0 } }],
      facets: { byType: { person: 1 }, byFlag: { 'active warrant': 1 } },
    };
    return [];
  }),
  authedImageUrl: (u: string) => u,
}));

describe('IntelSearch', () => {
  it('runs a query and renders result cards', async () => {
    render(<MemoryRouter><IntelProvider><IntelSearch /></IntelProvider></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'name:"Hale"' } });
    await waitFor(() => expect(screen.getByText('HALE, Vincent')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('ACTIVE WARRANT')).toBeInTheDocument();
  });
});
