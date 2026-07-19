import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MapRightDock from '../MapRightDock';

describe('MapRightDock', () => {
  it('renders each section title and its items', () => {
    const sections = [
      { title: 'Dispatch Tools', items: [{ id: 'directions', label: 'Directions', active: false, onToggle: vi.fn() }] },
      { title: 'Analysis', items: [{ id: 'ruler', label: 'Ruler', active: false, onToggle: vi.fn() }] },
      { title: 'Diagnostics', items: [{ id: 'identify', label: 'Identify', active: false, onToggle: vi.fn() }] },
    ];
    render(<MapRightDock sections={sections} />);
    expect(screen.getByText('Dispatch Tools')).toBeInTheDocument();
    expect(screen.getByText('Directions')).toBeInTheDocument();
    expect(screen.getByText('Diagnostics')).toBeInTheDocument();
    expect(screen.getByText('Identify')).toBeInTheDocument();
  });

  it('calls the right item onToggle when clicked', () => {
    const onToggle = vi.fn();
    const sections = [{ title: 'Analysis', items: [{ id: 'ruler', label: 'Ruler', active: false, onToggle }] }];
    render(<MapRightDock sections={sections} />);
    fireEvent.click(screen.getByText('Ruler'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('has an accessible dock heading', () => {
    render(<MapRightDock sections={[]} />);
    expect(screen.getByText('INFO & TOOLS')).toBeInTheDocument();
  });
});
