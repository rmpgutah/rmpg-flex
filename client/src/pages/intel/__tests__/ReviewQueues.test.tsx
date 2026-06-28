import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import ReviewQueues from '../ReviewQueues';

// Both child panels fetch on mount; stub apiFetch to return empty arrays.
vi.mock('../../../hooks/useApi', () => ({ apiFetch: vi.fn(async () => []) }));

describe('ReviewQueues', () => {
  it('renders the section heading', () => {
    render(<ReviewQueues />);
    expect(screen.getByText(/Review Queues/i)).toBeInTheDocument();
  });
});
