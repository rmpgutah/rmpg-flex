import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PersonPicker from '../PersonPicker';

// Mock the shared apiFetch helper used by every picker.
vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));
import { apiFetch } from '../../hooks/useApi';

const personFixture = [
  { id: 4, first_name: 'Camden', last_name: 'Clark', date_of_birth: '1992-08-14', phone: '801-555-0188', city: 'Salt Lake City', state: 'UT' },
  { id: 9, first_name: 'Camille', last_name: 'Cardenas', date_of_birth: '1985-02-01', phone: '801-555-0212', city: 'Provo', state: 'UT' },
];

beforeEach(() => {
  vi.useFakeTimers();
  (apiFetch as ReturnType<typeof vi.fn>).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PersonPicker', () => {
  it('renders the displayValue when editing an existing record', () => {
    render(<PersonPicker value={4} displayValue="Camden Clark" onChange={() => {}} />);
    expect(screen.getByDisplayValue('Camden Clark')).toBeInTheDocument();
  });

  it('does not query the server until input is >= 2 chars', async () => {
    render(<PersonPicker value={null} onChange={() => {}} />);
    const input = screen.getByPlaceholderText(/search by name/i);
    fireEvent.change(input, { target: { value: 'C' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('debounces 300ms then calls /records/persons/search?q=…', async () => {
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue(personFixture);
    render(<PersonPicker value={null} onChange={() => {}} />);
    const input = screen.getByPlaceholderText(/search by name/i);
    fireEvent.change(input, { target: { value: 'Cam' } });
    expect(apiFetch).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(310); });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith('/records/persons/search?q=Cam');
  });

  it('coalesces rapid keystrokes into a single query (true debounce)', async () => {
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue(personFixture);
    render(<PersonPicker value={null} onChange={() => {}} />);
    const input = screen.getByPlaceholderText(/search by name/i);
    fireEvent.change(input, { target: { value: 'Ca' } });
    await act(async () => { vi.advanceTimersByTime(100); });
    fireEvent.change(input, { target: { value: 'Cam' } });
    await act(async () => { vi.advanceTimersByTime(100); });
    fireEvent.change(input, { target: { value: 'Camd' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(310); });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenLastCalledWith('/records/persons/search?q=Camd');
  });

  it('renders matching people and emits the FK id + person object on selection', async () => {
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue(personFixture);
    const onChange = vi.fn();
    render(<PersonPicker value={null} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/search by name/i);
    fireEvent.change(input, { target: { value: 'Cam' } });
    // Flush debounce timer + the apiFetch resolution + the React state batch.
    await act(async () => { await vi.advanceTimersByTimeAsync(310); });
    expect(screen.getByText('Camden Clark')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Camden Clark'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(4, personFixture[0]);
    expect((input as HTMLInputElement).value).toBe('Camden Clark');
  });

  it('the clear button resets to no selection', async () => {
    const onChange = vi.fn();
    render(<PersonPicker value={4} displayValue="Camden Clark" onChange={onChange} />);
    const clearBtn = screen.getByLabelText(/clear selection/i);
    fireEvent.click(clearBtn);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('clears the selection when the user re-types after picking', async () => {
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const onChange = vi.fn();
    render(<PersonPicker value={4} displayValue="Camden Clark" onChange={onChange} />);
    const input = screen.getByDisplayValue('Camden Clark');
    fireEvent.change(input, { target: { value: 'Cam X' } });
    // Editing the input nukes the previous selection so the form FK doesn't
    // get stuck pointing at the wrong record while the user types a new name.
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('shows "No matches" only after >= 2 chars and a completed fetch', async () => {
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<PersonPicker value={null} onChange={() => {}} />);
    const input = screen.getByPlaceholderText(/search by name/i);
    fireEvent.change(input, { target: { value: 'Zz' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(310); });
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });

  it('falls back to "Person #<id>" when first/last name are missing', async () => {
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 99, date_of_birth: '1970-01-01' }]);
    render(<PersonPicker value={null} onChange={() => {}} />);
    const input = screen.getByPlaceholderText(/search by name/i);
    fireEvent.change(input, { target: { value: 'an' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(310); });
    expect(screen.getByText('Person #99')).toBeInTheDocument();
  });
});
