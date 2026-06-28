import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import ResolutionReviewPanel from '../ResolutionReviewPanel';

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => ([{
    id: 1, person_a: 1, person_b: 2, score: 0.8,
    reasons: '[{"rule":"dob_name","detail":"same DOB"}]',
    a_first: 'John', a_last: 'Smith', a_dob: '1990-01-01',
    b_first: 'Jon', b_last: 'Smith', b_dob: '1990-01-01',
  }])),
}));

describe('ResolutionReviewPanel', () => {
  it('renders pending suggestions with decide buttons', async () => {
    render(<ResolutionReviewPanel />);
    await waitFor(() => expect(screen.getByText(/POSSIBLE DUPLICATE PERSONS/)).toBeInTheDocument());
    expect(screen.getByText('SAME PERSON')).toBeInTheDocument();
    expect(screen.getByText('DIFFERENT')).toBeInTheDocument();
    expect(screen.getByText(/dob_name/)).toBeInTheDocument();
  });
});
