import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockApiFetch = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: (...a: any[]) => mockApiFetch(...a) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

describe('QuickSearchCard (smoke)', () => {
  it('module loads', async () => {
    const mod = await import('../QuickSearchCard');
    expect(mod.default).toBeDefined();
  });
});

describe('QuickSearchCard', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockNavigate.mockReset();
  });

  it('shows result after submit', async () => {
    mockApiFetch.mockResolvedValueOnce([
      { type: 'PERSON', id: 42, label: 'John Smith', subtitle: 'DOB 1985-03-12' },
    ]);
    const { default: QuickSearchCard } = await import('../QuickSearchCard');
    render(<QuickSearchCard />);
    const input = screen.getByPlaceholderText(/person, plate, address/i);
    fireEvent.change(input, { target: { value: 'smith' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(screen.getByText(/John Smith/)).toBeInTheDocument());
  });
});
