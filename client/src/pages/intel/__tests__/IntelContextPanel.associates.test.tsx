import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect } from 'vitest';
import IntelContextPanel from '../IntelContextPanel';
import { IntelProvider, useIntelContext } from '../IntelContext';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => ({
    person: { id: 7, first_name: 'Jane', last_name: 'Doe' },
    flags: [], timeline: [], watched: false,
    associates: [{ person_id: 42, name: 'John Roe', shared_events: 3, kinds: ['arrest'] }],
  })),
  authedImageUrl: (u: string) => u,
}));

function Harness() {
  const { selectEntity } = useIntelContext();
  return <button onClick={() => selectEntity('person', 7, 'Jane Doe')}>sel</button>;
}

describe('IntelContextPanel associates', () => {
  it('renders associates and shows shared count', async () => {
    render(
      <MemoryRouter>
        <IntelProvider>
          <Harness />
          <IntelContextPanel />
        </IntelProvider>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText('sel'));
    await waitFor(() => expect(screen.getByText('John Roe')).toBeInTheDocument());
    expect(screen.getByText(/3 shared/i)).toBeInTheDocument();
  });
});
