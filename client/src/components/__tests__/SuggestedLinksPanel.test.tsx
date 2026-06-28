import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import SuggestedLinksPanel from '../SuggestedLinksPanel';

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => ([{
    id: 1, source_type: 'call', source_id: 3, entity_type: 'person', entity_id: 5,
    extracted_text: 'contact with John Smith', match_basis: 'name',
    entity_label: 'John Smith', source_label: 'CFS-1042',
  }])),
}));

describe('SuggestedLinksPanel', () => {
  it('renders pending suggestions with LINK/DISMISS actions', async () => {
    render(<SuggestedLinksPanel />);
    await waitFor(() => expect(screen.getByText(/SUGGESTED LINKS FROM NARRATIVES/)).toBeInTheDocument());
    expect(screen.getByText('John Smith')).toBeInTheDocument();
    expect(screen.getByText('CFS-1042')).toBeInTheDocument();
    expect(screen.getByText('LINK')).toBeInTheDocument();
    expect(screen.getByText('DISMISS')).toBeInTheDocument();
  });
});
