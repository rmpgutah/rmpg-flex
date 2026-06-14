import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect } from 'vitest';
import IntelSearch from '../IntelSearch';
import { IntelProvider } from '../IntelContext';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path.startsWith('/intel/saved-searches')) return [{ id: 1, name: 'Gang plates', query_text: 'flag:gang', created_at: '' }];
    if (path.startsWith('/intel/search-history')) return [{ query_text: 'carlos', executed_at: '' }];
    return { results: [], facets: { byType: {}, byFlag: {} } };
  }),
  authedImageUrl: (u: string) => u,
}));

describe('IntelSearch chips', () => {
  it('shows a saved-search chip and applies it on click', async () => {
    render(<MemoryRouter><IntelProvider><IntelSearch /></IntelProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('★ Gang plates')).toBeInTheDocument());
    fireEvent.click(screen.getByText('★ Gang plates'));
    expect((screen.getByPlaceholderText(/search/i) as HTMLInputElement).value).toBe('flag:gang');
  });
});
