import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
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
});
