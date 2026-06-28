import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import WatchlistSection from '../WatchlistSection';
import { IntelProvider } from '../IntelContext';

vi.mock('../../../hooks/useApi', () => ({ apiFetch: vi.fn(async () => []) }));

describe('WatchlistSection empty-state', () => {
  it('shows an All clear branded empty-state', async () => {
    render(<IntelProvider><WatchlistSection /></IntelProvider>);
    await waitFor(() => expect(screen.getByText(/all clear/i)).toBeInTheDocument());
  });
});
