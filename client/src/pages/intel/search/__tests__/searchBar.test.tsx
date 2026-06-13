import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import SearchBar from '../SearchBar';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn(async () => []) }));

describe('SearchBar', () => {
  it('renders input and fires onChange', () => {
    const onChange = vi.fn();
    render(<SearchBar value="" onChange={onChange} onSave={() => {}} />);
    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: 'plate:8XQ' } });
    expect(onChange).toHaveBeenCalledWith('plate:8XQ');
  });

  it('shows the operator hint', () => {
    render(<SearchBar value="" onChange={() => {}} onSave={() => {}} />);
    expect(screen.getByText(/plate:/)).toBeInTheDocument();
  });
});
