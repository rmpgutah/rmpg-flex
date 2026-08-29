import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MapLeftDock from '../MapLeftDock';

describe('MapLeftDock', () => {
  it('renders each section title and its items', () => {
    const sections = [
      { title: 'Live Conditions', items: [{ id: 'traffic', label: 'Live Traffic', active: false, onToggle: vi.fn() }] },
      { title: 'Boundaries', items: [{ id: 'beats', label: 'Beat Boundaries', active: true, onToggle: vi.fn() }] },
    ];
    render(<MapLeftDock sections={sections} />);
    expect(screen.getByText('Live Conditions')).toBeInTheDocument();
    expect(screen.getByText('Live Traffic')).toBeInTheDocument();
    expect(screen.getByText('Boundaries')).toBeInTheDocument();
    expect(screen.getByText('Beat Boundaries')).toBeInTheDocument();
  });

  it('calls the right item onToggle when clicked', () => {
    const onToggle = vi.fn();
    const sections = [{ title: 'Live Conditions', items: [{ id: 'traffic', label: 'Live Traffic', active: false, onToggle }] }];
    render(<MapLeftDock sections={sections} />);
    fireEvent.click(screen.getByText('Live Traffic'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('has an accessible dock heading', () => {
    render(<MapLeftDock sections={[]} />);
    expect(screen.getByText('LAYERS')).toBeInTheDocument();
  });

  it('forwards collapsible=false to a non-collapsible section', () => {
    const sections = [{ title: 'Live Conditions', collapsible: false, items: [{ id: 'p1audio', label: 'P1 Audio Alert', active: true, onToggle: vi.fn() }] }];
    render(<MapLeftDock sections={sections} />);
    fireEvent.click(screen.getByText('Live Conditions'));
    expect(screen.getByText('P1 Audio Alert')).toBeInTheDocument();
  });

  it('filters layers by the find box and reports how many are on', () => {
    const sections = [
      { title: 'OSM Fire & Safety', items: [
        { id: 'osm_safety_hydrant', label: 'Fire hydrants', active: true, onToggle: vi.fn() },
        { id: 'osm_safety_station', label: 'Stations', active: false, onToggle: vi.fn() },
      ] },
      { title: 'Live Conditions', items: [{ id: 'traffic', label: 'Live Traffic', active: false, onToggle: vi.fn() }] },
    ];
    render(<MapLeftDock sections={sections} />);
    expect(screen.getByText(/1 on/i)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: /find layer/i }), { target: { value: 'hydrant' } });
    expect(screen.getByText('Fire hydrants')).toBeInTheDocument();
    expect(screen.queryByText('Live Traffic')).not.toBeInTheDocument();
  });

  it('lists favorited layers in a Favorites section', () => {
    const onToggleFavorite = vi.fn();
    const sections = [{
      title: 'Live Conditions',
      items: [{ id: 'traffic', label: 'Live Traffic', active: false, onToggle: vi.fn(), favorite: true, onToggleFavorite }],
    }];
    render(<MapLeftDock sections={sections} />);
    expect(screen.getByText('Favorites')).toBeInTheDocument();
    expect(screen.getAllByText('Live Traffic').length).toBeGreaterThan(1);
  });
});
