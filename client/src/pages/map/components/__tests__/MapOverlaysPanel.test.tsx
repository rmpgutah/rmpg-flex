import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MapOverlaysPanel from '../MapOverlaysPanel';
import type { LayerGroup } from '../MapOverlaysPanel';

function makeGroups(): LayerGroup[] {
  return [
    { id: 'live', label: 'Live Data', layers: [
      { id: 'heatmap', label: 'Crime Heatmap', active: false, onToggle: vi.fn() },
      { id: 'traffic', label: 'Live Traffic', active: false, onToggle: vi.fn() },
    ] },
    { id: 'analysis', label: 'Analysis', layers: [
      { id: 'ruler', label: 'Ruler', active: false, onToggle: vi.fn() },
    ] },
  ];
}

describe('MapOverlaysPanel — tabs + search', () => {
  it('renders one tab button per group and only the active tab\'s tools', () => {
    render(<MapOverlaysPanel groups={makeGroups()} open />);
    expect(screen.getByRole('tab', { name: /live data/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /analysis/i })).toBeInTheDocument();
    expect(screen.getByText('Crime Heatmap')).toBeInTheDocument();
    expect(screen.queryByText('Ruler')).not.toBeInTheDocument();
  });

  it('switches tabs on click', () => {
    render(<MapOverlaysPanel groups={makeGroups()} open />);
    fireEvent.click(screen.getByRole('tab', { name: /analysis/i }));
    expect(screen.getByText('Ruler')).toBeInTheDocument();
    expect(screen.queryByText('Crime Heatmap')).not.toBeInTheDocument();
  });

  it('search filters the active tab\'s tools by label substring', () => {
    render(<MapOverlaysPanel groups={makeGroups()} open />);
    fireEvent.change(screen.getByPlaceholderText(/search tools/i), { target: { value: 'traffic' } });
    expect(screen.getByText('Live Traffic')).toBeInTheDocument();
    expect(screen.queryByText('Crime Heatmap')).not.toBeInTheDocument();
  });

  it('shows a cross-tab hint when the active tab has zero matches but another tab does', () => {
    render(<MapOverlaysPanel groups={makeGroups()} open />);
    fireEvent.change(screen.getByPlaceholderText(/search tools/i), { target: { value: 'ruler' } });
    expect(screen.getByText(/1 result in another tab/i)).toBeInTheDocument();
  });

  it('clicking the cross-tab hint switches to the matching tab', () => {
    render(<MapOverlaysPanel groups={makeGroups()} open />);
    fireEvent.change(screen.getByPlaceholderText(/search tools/i), { target: { value: 'ruler' } });
    fireEvent.click(screen.getByText(/1 result in another tab/i));
    expect(screen.getByText('Ruler')).toBeInTheDocument();
  });
});
