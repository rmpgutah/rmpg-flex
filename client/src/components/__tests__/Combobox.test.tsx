import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

describe('Combobox (async fetcher)', () => {
  it('calls fetcher with debounced query and renders results', async () => {
    const fetcher = vi.fn(async (q: string) => STATES.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())));
    render(<Combobox value={null} onChange={() => {}} fetcher={fetcher} getLabel={(s: State) => s.name} getKey={(s) => s.code} minQueryLength={2} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'utah' } });
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('utah'));
    await waitFor(() => expect(screen.getByText('Utah')).toBeInTheDocument());
  });

  it('does not call fetcher when query shorter than minQueryLength', async () => {
    const fetcher = vi.fn(async () => []);
    render(<Combobox value={null} onChange={() => {}} fetcher={fetcher} getLabel={(s: State) => s.name} getKey={(s) => s.code} minQueryLength={3} />);
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ut' } });
    await new Promise((r) => setTimeout(r, 350));
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Combobox (keyboard nav)', () => {
  it('ArrowDown moves highlight, Enter selects', () => {
    const onChange = vi.fn();
    render(<Combobox {...baseProps} value={null} onChange={onChange} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });   // highlight Utah
    fireEvent.keyDown(input, { key: 'ArrowDown' });   // highlight California
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(STATES[1]);
  });

  it('Escape closes the dropdown', () => {
    render(<Combobox {...baseProps} value={null} onChange={() => {}} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
