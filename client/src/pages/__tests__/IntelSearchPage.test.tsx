import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import IntelSearchPage from '../IntelSearchPage';

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path.includes('/intel/search')) return {
      query: 'smith',
      results: [
        { type: 'person', id: 1, label: 'John Smith', snippet: '', flags: ['ACTIVE WARRANT'], score: 90,
          cluster: { canonical_person_id: null, pending_suggestions: 2 } },
        { type: 'vehicle', id: 7, label: 'Red Ford F-150 (ABC123)', snippet: 'ABC123', flags: [], score: 40 },
      ],
    };
    return [];
  }),
}));

describe('IntelSearchPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders grouped results with flags after typing a query', async () => {
    render(<MemoryRouter><IntelSearchPage /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/search persons, vehicles/i), { target: { value: 'smith' } });
    await waitFor(() => expect(screen.getByText('John Smith')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('ACTIVE WARRANT')).toBeInTheDocument();
    expect(screen.getByText(/Red Ford F-150/)).toBeInTheDocument();
    expect(screen.getByText(/2 possible match/i)).toBeInTheDocument();
  });
});
