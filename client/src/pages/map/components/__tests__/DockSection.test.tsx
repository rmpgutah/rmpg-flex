import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DockSection, { DockToggleRow } from '../DockSection';

describe('DockSection', () => {
  it('renders children when defaultOpen is true (default)', () => {
    render(<DockSection title="Live Conditions"><div>Traffic</div></DockSection>);
    expect(screen.getByText('Traffic')).toBeInTheDocument();
  });

  it('hides children when defaultOpen is false', () => {
    render(<DockSection title="Live Conditions" defaultOpen={false}><div>Traffic</div></DockSection>);
    expect(screen.queryByText('Traffic')).not.toBeInTheDocument();
  });

  it('toggles visibility when the header is clicked', () => {
    render(<DockSection title="Live Conditions"><div>Traffic</div></DockSection>);
    fireEvent.click(screen.getByText('Live Conditions'));
    expect(screen.queryByText('Traffic')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Live Conditions'));
    expect(screen.getByText('Traffic')).toBeInTheDocument();
  });
});

describe('DockToggleRow', () => {
  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(<DockToggleRow item={{ id: 'traffic', label: 'Live Traffic', active: false, onToggle }} />);
    fireEvent.click(screen.getByText('Live Traffic'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows the label and respects the active flag in its title attribute', () => {
    const onToggle = vi.fn();
    render(<DockToggleRow item={{ id: 'traffic', label: 'Live Traffic', active: true, onToggle, description: 'Real-time congestion' }} />);
    const row = screen.getByText('Live Traffic').closest('button')!;
    expect(row).toHaveAttribute('title', 'Real-time congestion');
  });

  it('falls back to the theme brand-gold token (not a hardcoded hex) when no color is given', () => {
    const onToggle = vi.fn();
    render(<DockToggleRow item={{ id: 'x', label: 'X', active: true, onToggle }} />);
    const dot = screen.getByText('X').closest('button')!.querySelector('span');
    expect(dot).toHaveStyle({ background: 'var(--brand-gold)' });
  });
});
