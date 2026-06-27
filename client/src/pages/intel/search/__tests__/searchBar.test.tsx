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

  // v1047 — replaces `window.prompt('Name this search:')` with an inline
  // themed popover. Validate the flow: click star → type name → submit
  // calls onSave with the trimmed name.
  it('opens the inline save-name popover and submits the name (v1047)', () => {
    const onSave = vi.fn();
    render(<SearchBar value="flag:warrant" onChange={() => {}} onSave={onSave} />);
    fireEvent.click(screen.getByLabelText(/save this search/i));
    const nameInput = screen.getByPlaceholderText(/name \(e\.g\./i);
    fireEvent.change(nameInput, { target: { value: '  Active warrants  ' } });
    fireEvent.click(screen.getByText(/^save$/i));
    expect(onSave).toHaveBeenCalledWith('Active warrants');
  });

  it('save popover refuses empty names (v1047)', () => {
    const onSave = vi.fn();
    render(<SearchBar value="x" onChange={() => {}} onSave={onSave} />);
    fireEvent.click(screen.getByLabelText(/save this search/i));
    // Save button should be disabled while name is empty.
    const saveBtn = screen.getByText(/^save$/i) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });
});
