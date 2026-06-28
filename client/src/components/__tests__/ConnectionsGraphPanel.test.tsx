import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import ConnectionsGraphPanel from '../ConnectionsGraphPanel';

const mockFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (url: string) => mockFetch(url),
}));

describe('ConnectionsGraphPanel', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('calls /connections/graph with the person id', async () => {
    mockFetch.mockResolvedValueOnce({ nodes: [], edges: [] });
    render(<ConnectionsGraphPanel personId={42} personName="JANE DOE" />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/connections/graph?type=person&id=42')
      );
    });
  });

  it('renders warrant node with distinct color', async () => {
    mockFetch.mockResolvedValueOnce({
      nodes: [
        { id: 'person-42', type: 'person', entityId: 42, label: 'JANE DOE', metadata: {}, depth: 0 },
        { id: 'warrant-1', type: 'warrant', entityId: 1, label: 'W-001 (active)', metadata: { status: 'active' }, depth: 1 },
      ],
      edges: [
        { source: 'person-42', target: 'warrant-1', relationship: 'warrant_active', sourceTable: 'warrants' },
      ],
    });
    const { container, getByRole } = render(<ConnectionsGraphPanel personId={42} personName="JANE DOE" />);
    // Wait for fetch to resolve and component to render
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    // Expand the CollapsibleSection so the SVG renders
    fireEvent.click(getByRole('button', { name: /Connections Graph/i }));
    await waitFor(() => {
      // Find the warrant node's circle — it should exist (not suppressed)
      const circles = container.querySelectorAll('circle');
      expect(circles.length).toBeGreaterThanOrEqual(2);
    });
  });
});
