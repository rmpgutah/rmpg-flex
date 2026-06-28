import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect } from 'vitest';
import IntelContextPanel from '../IntelContextPanel';
import { IntelProvider, useIntelContext } from '../IntelContext';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path.includes('/dossier/person/')) return {
      person: { id: 2, first_name: 'Vincent', last_name: 'Hale' },
      flags: ['ACTIVE WARRANT'], timeline: [], associates: [],
      escalation: { recent: 7, baseline: 2, ratio: 3.5, trend: 'rising' }, watched: false,
    };
    return {};
  }),
}));
// Mini-graph child fetches its own data — stub it so the panel test stays unit-level.
vi.mock('../../../components/ConnectionsGraphPanel', () => ({ default: () => <div>graph-stub</div> }));

function Pick() {
  const { selectEntity } = useIntelContext();
  return <button onClick={() => selectEntity('person', 2, 'HALE, Vincent')}>pick</button>;
}

describe('IntelContextPanel', () => {
  it('shows empty hint, then a dossier peek after selection', async () => {
    render(<MemoryRouter><IntelProvider><Pick /><IntelContextPanel /></IntelProvider></MemoryRouter>);
    expect(screen.getByText(/select an entity/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('pick'));
    await waitFor(() => expect(screen.getByText(/Vincent Hale/)).toBeInTheDocument());
    expect(screen.getByText('ACTIVE WARRANT')).toBeInTheDocument();
  });
});
