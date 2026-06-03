import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ViolationStack } from '../ViolationStack';
import { newDraft } from '../violationStackHelpers';

describe('ViolationStack', () => {
  it('renders one card per draft', () => {
    const drafts = [newDraft(), newDraft()];
    render(<ViolationStack value={drafts} onChange={() => {}} />);
    expect(screen.getAllByText(/Violation \d/)).toHaveLength(2);
  });

  it('"+ Add Violation" appends a new empty card', () => {
    const onChange = vi.fn();
    const drafts = [newDraft()];
    render(<ViolationStack value={drafts} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Add Violation/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(next).toHaveLength(2);
    expect(next[1].statute_citation).toBe('');
  });

  it('"Remove" deletes the targeted card', () => {
    const onChange = vi.fn();
    const drafts = [newDraft(), newDraft()];
    render(<ViolationStack value={drafts} onChange={onChange} />);
    const removeButtons = screen.getAllByRole('button', { name: /Remove/i });
    fireEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith([drafts[1]]);
  });

  it('renders running total of fine amounts', () => {
    const drafts = [
      { ...newDraft(), fine_amount: 175 },
      { ...newDraft(), fine_amount: 50 },
    ];
    render(<ViolationStack value={drafts} onChange={() => {}} />);
    expect(screen.getByText(/\$225\.00/)).toBeInTheDocument();
  });

  it('typing in description input fires onChange with patched draft', () => {
    const onChange = vi.fn();
    const drafts = [newDraft()];
    render(<ViolationStack value={drafts} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/description/i);
    fireEvent.change(input, { target: { value: 'Speeding' } });
    expect(onChange.mock.calls[0][0][0].description).toBe('Speeding');
  });
});
