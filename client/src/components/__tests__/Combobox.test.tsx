import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Combobox } from '../Combobox';

type State = { code: string; name: string };
const STATES: State[] = [
  { code: 'UT', name: 'Utah' },
  { code: 'CA', name: 'California' },
  { code: 'NV', name: 'Nevada' },
];

const baseProps = {
  options: STATES,
  getLabel: (s: State) => s.name,
  getKey: (s: State) => s.code,
};

describe('Combobox (sync)', () => {
  it('renders the current value label in the input', () => {
    render(<Combobox {...baseProps} value={STATES[0]} onChange={() => {}} />);
    expect(screen.getByDisplayValue('Utah')).toBeInTheDocument();
  });

  it('opens dropdown and filters by typed query (case-insensitive)', () => {
    render(<Combobox {...baseProps} value={null} onChange={() => {}} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ne' } });
    expect(screen.getByText('Nevada')).toBeInTheDocument();
    expect(screen.queryByText('Utah')).not.toBeInTheDocument();
  });

  it('calls onChange with selected option on click', () => {
    const onChange = vi.fn();
    render(<Combobox {...baseProps} value={null} onChange={onChange} />);
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(screen.getByText('California'));
    expect(onChange).toHaveBeenCalledWith(STATES[1]);
  });

  it('clears value when user empties the input and blurs', () => {
    const onChange = vi.fn();
    render(<Combobox {...baseProps} value={STATES[0]} onChange={onChange} />);
    const input = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
