import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi, describe, it, expect } from 'vitest';
import IntelPortalLayout from '../IntelPortalLayout';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => ({
    stats: { active_warrants: 1, on_watchlist: 2, gang_flagged: 0 },
    watchlist_activity: [], alerts: [], escalation_leaderboard: [],
    jail_cross_hits: [], plate_sightings: [],
    queues: { link_suggestions: 0, resolution_pairs: 0 }, bolos: { active: 0, high_priority: 0 },
  })),
}));

describe('IntelPortalLayout', () => {
  it('renders rail, child outlet, and context panel', async () => {
    render(
      <MemoryRouter initialEntries={['/intel/x']}>
        <Routes>
          <Route path="/intel" element={<IntelPortalLayout />}>
            <Route path="x" element={<div>child-surface</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument()); // rail
    expect(screen.getByText('child-surface')).toBeInTheDocument();                   // outlet
    expect(screen.getByText(/Select an entity/i)).toBeInTheDocument();               // context panel
  });
});
