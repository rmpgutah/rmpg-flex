import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ConnectionsPage from '../ConnectionsPage';

const mockFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (url: string) => mockFetch(url),
}));

describe('ConnectionsPage', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('renders the page title', () => {
    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    expect(screen.getByText(/CONNECTIONS ANALYST/i)).toBeInTheDocument();
  });

  it('renders the seed search input', () => {
    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    expect(screen.getByLabelText(/Seed search/i)).toBeInTheDocument();
  });

  it('renders the empty canvas', () => {
    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    expect(screen.getByTestId('graph-canvas')).toBeInTheDocument();
  });
});

describe('ConnectionsPage - search', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('calls /connections/search when user types', async () => {
    mockFetch.mockResolvedValue([]);
    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    const input = screen.getByLabelText(/Seed search/i);
    fireEvent.change(input, { target: { value: 'jones' } });
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/connections/search?q=jones'));
    }, { timeout: 1000 });
  });

  it('renders dropdown results', async () => {
    mockFetch.mockResolvedValue([
      { id: 42, type: 'person', label: 'Jane Doe' },
      { id: 17, type: 'incident', label: 'I-0001 Burglary' },
    ]);
    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    const input = screen.getByLabelText(/Seed search/i);
    fireEvent.change(input, { target: { value: 'jones' } });
    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('I-0001 Burglary')).toBeInTheDocument();
    });
  });

  it('clicking a result sets it as the seed and hides the dropdown', async () => {
    mockFetch.mockResolvedValue([{ id: 42, type: 'person', label: 'Jane Doe' }]);
    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    const input = screen.getByLabelText(/Seed search/i);
    fireEvent.change(input, { target: { value: 'jones' } });
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Jane Doe'));
    await waitFor(() => {
      expect(screen.getByTestId('seed-display')).toHaveTextContent(/Jane Doe/i);
      expect(screen.getByTestId('seed-display')).toHaveTextContent(/person/i);
      expect(screen.queryByRole('option', { name: /Jane Doe/i })).not.toBeInTheDocument();
    });
  });

  it('does not call search for input < 2 chars (avoids noise)', async () => {
    mockFetch.mockResolvedValue([]);
    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    const input = screen.getByLabelText(/Seed search/i);
    fireEvent.change(input, { target: { value: 'j' } });
    await new Promise(r => setTimeout(r, 400));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
