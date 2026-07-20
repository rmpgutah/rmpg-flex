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

  it('renders as always-expanded with no toggle button when collapsible is false', () => {
    render(<DockSection title="Live Conditions" collapsible={false}><div>Traffic</div></DockSection>);
    expect(screen.getByText('Traffic')).toBeInTheDocument();
    // No clickable header button — just static text, so clicking the title does nothing.
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

  it('produces a valid (non-concatenated) box-shadow when falling back to the var() default color', () => {
    const onToggle = vi.fn();
    render(<DockToggleRow item={{ id: 'x', label: 'X', active: true, onToggle }} />);
    const dot = screen.getByText('X').closest('button')!.querySelector('span');
    expect(dot).toHaveStyle({ boxShadow: '0 0 4px var(--brand-gold)' });
  });

  it('still applies the alpha-suffixed glow for an explicit hex color', () => {
    const onToggle = vi.fn();
    render(<DockToggleRow item={{ id: 'y', label: 'Y', active: true, onToggle, color: '#22c55e' }} />);
    const dot = screen.getByText('Y').closest('button')!.querySelector('span');
    expect(dot).toHaveStyle({ boxShadow: '0 0 4px #22c55e80' });
  });

  it('renders a colored left-border accent when pinned is true', () => {
    const onToggle = vi.fn();
    render(<DockToggleRow item={{ id: 'p1audio', label: 'P1 Audio Alert', active: true, onToggle, color: '#ef4444', pinned: true }} />);
    const row = screen.getByText('P1 Audio Alert').closest('button')!;
    expect(row).toHaveStyle({ borderLeft: '3px solid #ef4444' });
  });

  it('has no left-border accent when pinned is false or omitted', () => {
    const onToggle = vi.fn();
    render(<DockToggleRow item={{ id: 'traffic', label: 'Live Traffic', active: true, onToggle, color: '#22c55e' }} />);
    const row = screen.getByText('Live Traffic').closest('button')!;
    expect(row).not.toHaveStyle({ borderLeft: '3px solid #22c55e' });
  });
});
