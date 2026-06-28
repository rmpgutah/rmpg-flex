import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, afterEach } from 'vitest';
import IntelContextPanel from '../IntelContextPanel';
import { IntelProvider, useIntelContext } from '../IntelContext';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../../hooks/useApi', () => ({ apiFetch, authedImageUrl: (u: string) => u }));

afterEach(cleanup);

function Harness() {
  const { selectEntity } = useIntelContext();
  return <button onClick={() => selectEntity('person', 7, 'Jane Doe')}>sel</button>;
}

describe('IntelContextPanel AI summary', () => {
  it('requests a Claude summary and renders it', async () => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/intel/dossier/person/')) {
        return { person: { id: 7, first_name: 'Jane', last_name: 'Doe' }, flags: ['WARRANT'], timeline: [{ kind: 'arrest' }], associates: [] };
      }
      if (path === '/intel/ai/summarize') return { summary: 'Jane Doe has one active warrant.' };
      return {};
    });

    render(
      <MemoryRouter><IntelProvider><Harness /><IntelContextPanel /></IntelProvider></MemoryRouter>
    );
    fireEvent.click(screen.getByText('sel'));
    await waitFor(() => expect(screen.getByText(/AI Summary/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/AI Summary/i));
    await waitFor(() => expect(screen.getByText('Jane Doe has one active warrant.')).toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledWith('/intel/ai/summarize', expect.objectContaining({ method: 'POST' }));
  });
});
