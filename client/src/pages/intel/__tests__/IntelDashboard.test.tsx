import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect } from 'vitest';
import IntelDashboard from '../IntelDashboard';
import { IntelProvider } from '../IntelContext';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => ({
    stats: { active_warrants: 11, on_watchlist: 7, gang_flagged: 4 },
    watchlist_activity: [{ entity_type: 'person', entity_id: 1, label: 'DELGADO, Marcus', event: 'New FI', when: '' }],
    alerts: [{ kind: 'warrant', person_id: 2, label: 'HALE, Vincent', detail: 'Felony', when: '' }],
    escalation_leaderboard: [{ person_id: 2, label: 'HALE, Vincent', score: 9, trend: 'rising' }],
    jail_cross_hits: [], plate_sightings: [],
    queues: { link_suggestions: 8, resolution_pairs: 4 },
    bolos: { active: 3, high_priority: 2 },
  })),
}));

describe('IntelDashboard', () => {
  it('renders tiles and widgets from the overview', async () => {
    render(<MemoryRouter><IntelProvider><IntelDashboard /></IntelProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('11')).toBeInTheDocument());
    expect(screen.getByText('DELGADO, Marcus')).toBeInTheDocument();
    expect(screen.getAllByText('HALE, Vincent').length).toBeGreaterThan(0);
  });
});
