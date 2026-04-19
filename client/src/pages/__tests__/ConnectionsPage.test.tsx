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

describe('ConnectionsPage - graph fetch & render', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('fetches /connections/graph when a seed is picked', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Jane Doe' }])
      .mockResolvedValueOnce({
        nodes: [
          { id: 'person-42', type: 'person', entityId: 42, label: 'Jane Doe', metadata: {}, depth: 0 },
          { id: 'incident-1', type: 'incident', entityId: 1, label: 'I-0001', metadata: {}, depth: 1 },
        ],
        edges: [
          { source: 'person-42', target: 'incident-1', relationship: 'suspect', sourceTable: 'incident_persons' },
        ],
      });

    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'jones' } });
    await waitFor(() => screen.getByText('Jane Doe'));
    fireEvent.click(screen.getByText('Jane Doe'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/connections/graph?type=person&id=42')
      );
    });
  });

  it('renders SVG nodes for each returned node', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Jane Doe' }])
      .mockResolvedValueOnce({
        nodes: [
          { id: 'person-42', type: 'person', entityId: 42, label: 'Jane Doe', metadata: {}, depth: 0 },
          { id: 'incident-1', type: 'incident', entityId: 1, label: 'I-0001', metadata: {}, depth: 1 },
          { id: 'warrant-5', type: 'warrant', entityId: 5, label: 'W-005 (active)', metadata: { status: 'active' }, depth: 1 },
        ],
        edges: [
          { source: 'person-42', target: 'incident-1', relationship: 'suspect', sourceTable: 'incident_persons' },
          { source: 'person-42', target: 'warrant-5', relationship: 'warrant_active', sourceTable: 'warrants' },
        ],
      });

    const { container } = render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'jones' } });
    await waitFor(() => screen.getByText('Jane Doe'));
    fireEvent.click(screen.getByText('Jane Doe'));

    await waitFor(() => {
      const circles = container.querySelectorAll('svg circle');
      expect(circles.length).toBeGreaterThanOrEqual(3);
    });
    await waitFor(() => {
      const lines = container.querySelectorAll('svg line');
      expect(lines.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows loading state while fetching graph', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Jane Doe' }])
      .mockImplementationOnce(() => new Promise(resolve => {
        setTimeout(() => resolve({ nodes: [], edges: [] }), 10000);
      }));

    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'j' } });
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'jones' } });
    await waitFor(() => screen.getByText('Jane Doe'));
    fireEvent.click(screen.getByText('Jane Doe'));
    await waitFor(() => {
      expect(screen.getByText(/Building graph/i)).toBeInTheDocument();
    });
  });

  it('shows "no connections" message for graph with only the seed node', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Lonely' }])
      .mockResolvedValueOnce({
        nodes: [{ id: 'person-42', type: 'person', entityId: 42, label: 'Lonely', metadata: {}, depth: 0 }],
        edges: [],
      });

    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'lon' } });
    await waitFor(() => screen.getByText('Lonely'));
    fireEvent.click(screen.getByText('Lonely'));
    await waitFor(() => {
      expect(screen.getByText(/No connections found/i)).toBeInTheDocument();
    });
  });
});

describe('ConnectionsPage - pan/zoom', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('applies a transform to the graph group when zoom fires', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Jane Doe' }])
      .mockResolvedValueOnce({
        nodes: [
          { id: 'person-42', type: 'person', entityId: 42, label: 'Jane Doe', metadata: {}, depth: 0 },
          { id: 'incident-1', type: 'incident', entityId: 1, label: 'I-0001', metadata: {}, depth: 1 },
        ],
        edges: [{ source: 'person-42', target: 'incident-1', relationship: 'suspect', sourceTable: 'incident_persons' }],
      });

    const { container } = render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'jones' } });
    await waitFor(() => screen.getByText('Jane Doe'));
    fireEvent.click(screen.getByText('Jane Doe'));

    await waitFor(() => {
      const g = container.querySelector('svg g[data-testid="zoom-target"]');
      expect(g).toBeTruthy();
    });
  });

  it('renders reset view button that is clickable', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Jane Doe' }])
      .mockResolvedValueOnce({
        nodes: [{ id: 'person-42', type: 'person', entityId: 42, label: 'Jane', metadata: {}, depth: 0 }],
        edges: [],
      });

    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'jones' } });
    await waitFor(() => screen.getByText('Jane Doe'));
    fireEvent.click(screen.getByText('Jane Doe'));

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /reset view/i });
      expect(btn).toBeInTheDocument();
    });
  });
});
