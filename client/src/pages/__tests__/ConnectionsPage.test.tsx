import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ConnectionsPage from '../ConnectionsPage';

const mockFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (url: string, opts?: any) => opts === undefined ? mockFetch(url) : mockFetch(url, opts),
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

describe('ConnectionsPage - type filter', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('renders a checkbox for each node type present in the graph', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Jane Doe' }])
      .mockResolvedValueOnce({
        nodes: [
          { id: 'person-42', type: 'person', entityId: 42, label: 'Jane Doe', metadata: {}, depth: 0 },
          { id: 'incident-1', type: 'incident', entityId: 1, label: 'I-0001', metadata: {}, depth: 1 },
          { id: 'warrant-5', type: 'warrant', entityId: 5, label: 'W-005', metadata: {}, depth: 1 },
        ],
        edges: [
          { source: 'person-42', target: 'incident-1', relationship: 'suspect', sourceTable: 'incident_persons' },
          { source: 'person-42', target: 'warrant-5', relationship: 'warrant_active', sourceTable: 'warrants' },
        ],
      });

    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'jones' } });
    await waitFor(() => screen.getByText('Jane Doe'));
    fireEvent.click(screen.getByText('Jane Doe'));

    await waitFor(() => {
      expect(screen.getByLabelText(/Show person/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Show incident/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Show warrant/i)).toBeInTheDocument();
    });
  });

  it('unchecking a type hides those nodes AND their edges', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Jane Doe' }])
      .mockResolvedValueOnce({
        nodes: [
          { id: 'person-42', type: 'person', entityId: 42, label: 'Jane Doe', metadata: {}, depth: 0 },
          { id: 'incident-1', type: 'incident', entityId: 1, label: 'I-0001', metadata: {}, depth: 1 },
          { id: 'warrant-5', type: 'warrant', entityId: 5, label: 'W-005', metadata: {}, depth: 1 },
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

    await waitFor(() => expect(container.querySelectorAll('svg circle').length).toBeGreaterThanOrEqual(3));

    fireEvent.click(screen.getByLabelText(/Show incident/i));

    await waitFor(() => {
      const circles = container.querySelectorAll('svg g[data-testid="zoom-target"] circle');
      expect(circles.length).toBe(2);
      const lines = container.querySelectorAll('svg line');
      expect(lines.length).toBe(1);
    });
  });

  it('always keeps the seed node visible even if its type is unchecked', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Jane Doe' }])
      .mockResolvedValueOnce({
        nodes: [
          { id: 'person-42', type: 'person', entityId: 42, label: 'Jane Doe', metadata: {}, depth: 0 },
          { id: 'person-99', type: 'person', entityId: 99, label: 'Other Person', metadata: {}, depth: 1 },
        ],
        edges: [
          { source: 'person-42', target: 'person-99', relationship: 'co_suspect', sourceTable: 'incident_persons' },
        ],
      });

    const { container } = render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'jones' } });
    await waitFor(() => screen.getByText('Jane Doe'));
    fireEvent.click(screen.getByText('Jane Doe'));

    await waitFor(() => expect(container.querySelectorAll('svg circle').length).toBe(2));

    fireEvent.click(screen.getByLabelText(/Show person/i));

    await waitFor(() => {
      const circles = container.querySelectorAll('svg g[data-testid="zoom-target"] circle');
      expect(circles.length).toBe(1);
    });
  });
});

describe('ConnectionsPage - depth slider', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('renders a depth slider that defaults to 2', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Jane' }])
      .mockResolvedValueOnce({
        nodes: [{ id: 'person-42', type: 'person', entityId: 42, label: 'Jane', metadata: {}, depth: 0 }],
        edges: [],
      });
    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'jan' } });
    await waitFor(() => screen.getByText('Jane'));
    fireEvent.click(screen.getByText('Jane'));

    const slider = await screen.findByLabelText(/Graph depth/i);
    expect((slider as HTMLInputElement).value).toBe('2');
    expect((slider as HTMLInputElement).min).toBe('1');
    expect((slider as HTMLInputElement).max).toBe('3');
  });

  it('changing the slider refetches the graph with the new depth', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Jane' }])
      .mockResolvedValueOnce({
        nodes: [{ id: 'person-42', type: 'person', entityId: 42, label: 'Jane', metadata: {}, depth: 0 }],
        edges: [],
      })
      .mockResolvedValueOnce({
        nodes: [{ id: 'person-42', type: 'person', entityId: 42, label: 'Jane', metadata: {}, depth: 0 }],
        edges: [],
      });

    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'jan' } });
    await waitFor(() => screen.getByText('Jane'));
    fireEvent.click(screen.getByText('Jane'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/connections/graph?type=person&id=42&depth=2'));
    });

    fireEvent.change(screen.getByLabelText(/Graph depth/i), { target: { value: '3' } });
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/connections/graph?type=person&id=42&depth=3'));
    });
  });
});

describe('ConnectionsPage - shortest path', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('selecting a node shows a "Start path" action', async () => {
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
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'jon' } });
    await waitFor(() => screen.getByText('Jane Doe'));
    fireEvent.click(screen.getByText('Jane Doe'));
    await waitFor(() => expect(container.querySelectorAll('svg circle').length).toBeGreaterThanOrEqual(2));

    // Click the incident node's <g> via its label text
    const incidentLabel = await screen.findByText(/I-0001/i);
    fireEvent.click(incidentLabel.closest('g') as any);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start path/i })).toBeInTheDocument();
    });
  });

  it('path mode: clicking a second node calls /connections/path and highlights', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Jane Doe' }])
      .mockResolvedValueOnce({
        nodes: [
          { id: 'person-42', type: 'person', entityId: 42, label: 'Jane Doe', metadata: {}, depth: 0 },
          { id: 'incident-1', type: 'incident', entityId: 1, label: 'I-0001', metadata: {}, depth: 1 },
          { id: 'person-99', type: 'person', entityId: 99, label: 'Other', metadata: {}, depth: 2 },
        ],
        edges: [
          { source: 'person-42', target: 'incident-1', relationship: 'suspect', sourceTable: 'incident_persons' },
          { source: 'incident-1', target: 'person-99', relationship: 'witness', sourceTable: 'incident_persons' },
        ],
      })
      .mockResolvedValueOnce({
        path: [
          { id: 'person-42', type: 'person', entityId: 42, label: 'Jane Doe', metadata: {}, depth: 0 },
          { id: 'incident-1', type: 'incident', entityId: 1, label: 'I-0001', metadata: {}, depth: 1 },
          { id: 'person-99', type: 'person', entityId: 99, label: 'Other', metadata: {}, depth: 2 },
        ],
        edges: [
          { source: 'person-42', target: 'incident-1', relationship: 'suspect', sourceTable: 'incident_persons' },
          { source: 'incident-1', target: 'person-99', relationship: 'witness', sourceTable: 'incident_persons' },
        ],
      });

    const { container } = render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'j' } });
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'jon' } });
    await waitFor(() => screen.getByText('Jane Doe'));
    fireEvent.click(screen.getByText('Jane Doe'));
    await waitFor(() => expect(container.querySelectorAll('svg circle').length).toBeGreaterThanOrEqual(3));

    // Click Jane's node, then Start path
    const janeEls = screen.getAllByText('Jane Doe');
    const janeInSvg = janeEls.find(el => el.closest('svg')) as HTMLElement;
    fireEvent.click(janeInSvg.closest('g') as any);
    const startBtn = await screen.findByRole('button', { name: /start path/i });
    fireEvent.click(startBtn);

    // Banner visible
    await waitFor(() => {
      expect(screen.getByText(/click a second node/i)).toBeInTheDocument();
    });

    // Click Other — path query fires
    const otherEl = screen.getByText('Other');
    fireEvent.click(otherEl.closest('g') as any);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining(
        '/connections/path?fromType=person&fromId=42&toType=person&toId=99'
      ));
    });
  });

  it('Clear path exits path mode', async () => {
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
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'jon' } });
    await waitFor(() => screen.getByText('Jane Doe'));
    fireEvent.click(screen.getByText('Jane Doe'));
    await waitFor(() => expect(container.querySelectorAll('svg circle').length).toBeGreaterThanOrEqual(2));

    const janeEls = screen.getAllByText('Jane Doe');
    const janeInSvg = janeEls.find(el => el.closest('svg')) as HTMLElement;
    fireEvent.click(janeInSvg.closest('g') as any);
    fireEvent.click(await screen.findByRole('button', { name: /start path/i }));
    await waitFor(() => expect(screen.getByText(/click a second node/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /cancel path/i }));
    await waitFor(() => {
      expect(screen.queryByText(/click a second node/i)).not.toBeInTheDocument();
    });
  });
});

describe('ConnectionsPage - save investigation', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('shows SAVE INVESTIGATION button that is disabled without a seed', () => {
    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    const btn = screen.getByRole('button', { name: /save investigation/i });
    expect(btn).toBeDisabled();
  });

  it('opens the save modal when clicked', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Jane Doe' }])
      .mockResolvedValueOnce({
        nodes: [
          { id: 'person-42', type: 'person', entityId: 42, label: 'Jane Doe', metadata: {}, depth: 0 },
          { id: 'incident-1', type: 'incident', entityId: 1, label: 'I-0001', metadata: {}, depth: 1 },
        ],
        edges: [{ source: 'person-42', target: 'incident-1', relationship: 'suspect', sourceTable: 'incident_persons' }],
      });

    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'jon' } });
    await waitFor(() => screen.getByText('Jane Doe'));
    fireEvent.click(screen.getByText('Jane Doe'));
    await waitFor(() => expect(screen.getByRole('button', { name: /save investigation/i })).not.toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: /save investigation/i }));
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /save investigation/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    });
  });

  it('POSTs the investigation with seed_nodes and pinned_layout', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Jane Doe' }])
      .mockResolvedValueOnce({
        nodes: [
          { id: 'person-42', type: 'person', entityId: 42, label: 'Jane Doe', metadata: {}, depth: 0 },
          { id: 'incident-1', type: 'incident', entityId: 1, label: 'I-0001', metadata: {}, depth: 1 },
        ],
        edges: [{ source: 'person-42', target: 'incident-1', relationship: 'suspect', sourceTable: 'incident_persons' }],
      })
      .mockResolvedValueOnce({ id: 77, user_id: 1, name: 'Jones case' });

    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'jon' } });
    await waitFor(() => screen.getByText('Jane Doe'));
    fireEvent.click(screen.getByText('Jane Doe'));
    await waitFor(() => expect(screen.getByRole('button', { name: /save investigation/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /save investigation/i }));
    await waitFor(() => screen.getByRole('dialog', { name: /save investigation/i }));
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Jones case' } });
    fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Repeat burglary suspect' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/connections/investigations'),
        expect.anything(),
      );
    });
  });

  it('closes the modal on successful save', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Jane Doe' }])
      .mockResolvedValueOnce({
        nodes: [{ id: 'person-42', type: 'person', entityId: 42, label: 'Jane Doe', metadata: {}, depth: 0 }],
        edges: [],
      })
      .mockResolvedValueOnce({ id: 77, user_id: 1, name: 'X' });

    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'jon' } });
    await waitFor(() => screen.getByText('Jane Doe'));
    fireEvent.click(screen.getByText('Jane Doe'));
    await waitFor(() => expect(screen.getByRole('button', { name: /save investigation/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /save investigation/i }));
    await waitFor(() => screen.getByRole('dialog', { name: /save investigation/i }));
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /save investigation/i })).not.toBeInTheDocument();
    });
  });

  it('Cancel closes the modal without calling the API', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Jane Doe' }])
      .mockResolvedValueOnce({
        nodes: [{ id: 'person-42', type: 'person', entityId: 42, label: 'Jane Doe', metadata: {}, depth: 0 }],
        edges: [],
      });

    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'jon' } });
    await waitFor(() => screen.getByText('Jane Doe'));
    fireEvent.click(screen.getByText('Jane Doe'));
    await waitFor(() => expect(screen.getByRole('button', { name: /save investigation/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /save investigation/i }));
    await waitFor(() => screen.getByRole('dialog', { name: /save investigation/i }));
    const callsBeforeCancel = mockFetch.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockFetch.mock.calls.length).toBe(callsBeforeCancel);
  });
});

describe('ConnectionsPage - load investigation', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('lists saved investigations in a dropdown', async () => {
    mockFetch
      .mockResolvedValueOnce([
        { id: 1, user_id: 1, name: 'Jones case', description: null, seed_nodes: '[{"type":"person","id":42}]', pinned_layout: null, annotations: null, shared_user_ids: '[]' },
        { id: 2, user_id: 1, name: 'Smith burglary', description: 'repeat offender', seed_nodes: '[{"type":"person","id":99}]', pinned_layout: null, annotations: null, shared_user_ids: '[]' },
      ]);

    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /load investigation/i }));
    await waitFor(() => {
      expect(screen.getByText(/Jones case/i)).toBeInTheDocument();
      expect(screen.getByText(/Smith burglary/i)).toBeInTheDocument();
    });
  });

  it('opening an investigation sets the seed and requests the graph', async () => {
    mockFetch
      .mockResolvedValueOnce([
        { id: 1, user_id: 1, name: 'Jones case', seed_nodes: '[{"type":"person","id":42}]', pinned_layout: null, annotations: null, shared_user_ids: '[]' },
      ])
      .mockResolvedValueOnce({
        id: 1, user_id: 1, name: 'Jones case',
        seed_nodes: '[{"type":"person","id":42}]',
        pinned_layout: '{"person-42":{"x":100,"y":200}}',
        annotations: null,
        shared_user_ids: '[]',
      })
      .mockResolvedValueOnce({
        nodes: [{ id: 'person-42', type: 'person', entityId: 42, label: 'Jane Doe', metadata: {}, depth: 0 }],
        edges: [],
      });

    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /load investigation/i }));
    await waitFor(() => screen.getByText(/Jones case/i));
    fireEvent.click(screen.getByText(/Jones case/i));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/connections/graph?type=person&id=42')
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('seed-display')).toBeInTheDocument();
    });
  });

  it('applies pinned_layout to nodes after loading', async () => {
    mockFetch
      .mockResolvedValueOnce([
        { id: 1, user_id: 1, name: 'Pinned case', seed_nodes: '[{"type":"person","id":42}]', pinned_layout: null, annotations: null, shared_user_ids: '[]' },
      ])
      .mockResolvedValueOnce({
        id: 1, user_id: 1, name: 'Pinned case',
        seed_nodes: '[{"type":"person","id":42}]',
        pinned_layout: '{"person-42":{"x":250,"y":350},"incident-1":{"x":600,"y":150}}',
        annotations: null,
        shared_user_ids: '[]',
      })
      .mockResolvedValueOnce({
        nodes: [
          { id: 'person-42', type: 'person', entityId: 42, label: 'Jane', metadata: {}, depth: 0 },
          { id: 'incident-1', type: 'incident', entityId: 1, label: 'I-1', metadata: {}, depth: 1 },
        ],
        edges: [{ source: 'person-42', target: 'incident-1', relationship: 'suspect', sourceTable: 'incident_persons' }],
      });

    const { container } = render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /load investigation/i }));
    await waitFor(() => screen.getByText(/Pinned case/i));
    fireEvent.click(screen.getByText(/Pinned case/i));

    await waitFor(() => {
      expect(container.querySelectorAll('svg g[data-testid="zoom-target"] circle').length).toBeGreaterThanOrEqual(2);
    });

    await waitFor(() => {
      const nodeGroups = container.querySelectorAll('svg g[data-testid="zoom-target"] > g');
      const foundPinned = Array.from(nodeGroups).some(g => {
        const circle = g.querySelector('circle');
        if (!circle) return false;
        const cx = Number(circle.getAttribute('cx'));
        return Math.abs(cx - 600) < 20 || Math.abs(cx - 250) < 20;
      });
      expect(foundPinned).toBe(true);
    }, { timeout: 3000 });
  });
});

describe('ConnectionsPage - annotations', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('selecting a node shows an Add note action; saving stores the annotation', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Jane Doe' }])
      .mockResolvedValueOnce({
        nodes: [
          { id: 'person-42', type: 'person', entityId: 42, label: 'Jane Doe', metadata: {}, depth: 0 },
          { id: 'incident-1', type: 'incident', entityId: 1, label: 'I-1', metadata: {}, depth: 1 },
        ],
        edges: [{ source: 'person-42', target: 'incident-1', relationship: 'suspect', sourceTable: 'incident_persons' }],
      });

    const { container } = render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'jon' } });
    await waitFor(() => screen.getByText('Jane Doe'));
    fireEvent.click(screen.getByText('Jane Doe'));
    await waitFor(() => expect(container.querySelectorAll('svg circle').length).toBeGreaterThanOrEqual(2));

    const incLabel = screen.getByText('I-1');
    fireEvent.click(incLabel.closest('g') as any);

    const addNoteBtn = await screen.findByRole('button', { name: /add note|edit note/i });
    fireEvent.click(addNoteBtn);

    const textarea = await screen.findByLabelText(/note for/i);
    fireEvent.change(textarea, { target: { value: 'Cold case, primary suspect unclear' } });
    fireEvent.click(screen.getByRole('button', { name: /save note/i }));

    await waitFor(() => {
      expect(screen.getByText(/Cold case, primary suspect unclear/i)).toBeInTheDocument();
    });
  });

  it('annotated nodes show a visual indicator', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Jane' }])
      .mockResolvedValueOnce({
        nodes: [
          { id: 'person-42', type: 'person', entityId: 42, label: 'Jane', metadata: {}, depth: 0 },
          { id: 'incident-1', type: 'incident', entityId: 1, label: 'I-1', metadata: {}, depth: 1 },
        ],
        edges: [{ source: 'person-42', target: 'incident-1', relationship: 'suspect', sourceTable: 'incident_persons' }],
      });

    const { container } = render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'ja' } });
    await waitFor(() => screen.getByText('Jane'));
    fireEvent.click(screen.getByText('Jane'));
    await waitFor(() => expect(container.querySelectorAll('svg circle').length).toBeGreaterThanOrEqual(2));

    fireEvent.click(screen.getByText('I-1').closest('g') as any);
    fireEvent.click(await screen.findByRole('button', { name: /add note/i }));
    fireEvent.change(await screen.findByLabelText(/note for/i), { target: { value: 'foo' } });
    fireEvent.click(screen.getByRole('button', { name: /save note/i }));

    await waitFor(() => {
      const annotatedGroups = container.querySelectorAll('svg g[data-has-annotation="true"]');
      expect(annotatedGroups.length).toBe(1);
    });
  });

  it('SAVE INVESTIGATION includes annotations in payload', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Jane' }])
      .mockResolvedValueOnce({
        nodes: [{ id: 'person-42', type: 'person', entityId: 42, label: 'Jane', metadata: {}, depth: 0 }],
        edges: [],
      })
      .mockResolvedValueOnce({ id: 100, user_id: 1, name: 'test' });

    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'ja' } });
    await waitFor(() => screen.getByText('Jane'));
    fireEvent.click(screen.getByText('Jane'));
    await waitFor(() => screen.getByTestId('seed-display'));

    const janeGroup = screen.getAllByText('Jane').find(el => el.closest('svg'));
    fireEvent.click(janeGroup!.closest('g') as any);
    fireEvent.click(await screen.findByRole('button', { name: /add note/i }));
    fireEvent.change(await screen.findByLabelText(/note for/i), { target: { value: 'watchlist' } });
    fireEvent.click(screen.getByRole('button', { name: /save note/i }));

    fireEvent.click(screen.getByRole('button', { name: /save investigation/i }));
    await waitFor(() => screen.getByRole('dialog', { name: /save investigation/i }));
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'test' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('/connections/investigations') && c[1]?.method === 'POST'
      );
      expect(postCall).toBeTruthy();
      const body = JSON.parse(postCall![1].body);
      expect(body.annotations).toBeTruthy();
      expect(body.annotations['person-42']).toBe('watchlist');
    });
  });

  it('LOAD INVESTIGATION restores annotations', async () => {
    mockFetch
      .mockResolvedValueOnce([{
        id: 5, user_id: 1, name: 'WithNote',
        seed_nodes: '[{"type":"person","id":42}]',
        pinned_layout: null,
        annotations: '{"person-42":"prior arrest"}',
        shared_user_ids: '[]',
      }])
      .mockResolvedValueOnce({
        id: 5, user_id: 1, name: 'WithNote',
        seed_nodes: '[{"type":"person","id":42}]',
        pinned_layout: null,
        annotations: '{"person-42":"prior arrest"}',
        shared_user_ids: '[]',
      })
      .mockResolvedValueOnce({
        nodes: [{ id: 'person-42', type: 'person', entityId: 42, label: 'Jane', metadata: {}, depth: 0 }],
        edges: [],
      });

    const { container } = render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /load investigation/i }));
    await waitFor(() => screen.getByText(/WithNote/i));
    fireEvent.click(screen.getByText(/WithNote/i));

    await waitFor(() => {
      const annotatedGroups = container.querySelectorAll('svg g[data-has-annotation="true"]');
      expect(annotatedGroups.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('ConnectionsPage - PNG export', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('EXPORT PNG button is disabled without a seed', () => {
    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /export png/i })).toBeDisabled();
  });

  it('EXPORT PNG button is enabled once the graph has nodes', async () => {
    mockFetch
      .mockResolvedValueOnce([{ id: 42, type: 'person', label: 'Jane' }])
      .mockResolvedValueOnce({
        nodes: [{ id: 'person-42', type: 'person', entityId: 42, label: 'Jane', metadata: {}, depth: 0 }],
        edges: [],
      });

    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Seed search/i), { target: { value: 'ja' } });
    await waitFor(() => screen.getByText('Jane'));
    fireEvent.click(screen.getByText('Jane'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export png/i })).not.toBeDisabled();
    });
  });
});
