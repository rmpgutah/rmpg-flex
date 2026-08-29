import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Cloud } from 'lucide-react';
import DockSection, { DockToggleRow } from '../DockSection';
import { MapDensityProvider } from '../../hooks/useMapDensity';

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
    fireEvent.click(screen.getByText('Live Conditions'));
    expect(screen.getByText('Traffic')).toBeInTheDocument();
  });

  it('All/None fire independently of the accordion', async () => {
    const onEnableAll = vi.fn();
    const onDisableAll = vi.fn();
    render(
      <DockSection title="OSM Fire & Safety" defaultOpen={false} onEnableAll={onEnableAll} onDisableAll={onDisableAll}>
        <div>Hydrant</div>
      </DockSection>,
    );
    expect(screen.queryByText('Hydrant')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(onEnableAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Hydrant')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'None' }));
    expect(onDisableAll).toHaveBeenCalledTimes(1);
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

  it('keeps the glow translucent when falling back to the var() default color', () => {
    // Previously asserted the bare token ('0 0 4px var(--brand-gold)'). That was
    // valid CSS but silently DISCARDED the 0x80 alpha, so the fallback dot
    // rendered a solid glow instead of a 50% one. withAlpha now routes tokens
    // through color-mix(), which preserves the alpha. See
    // docs/superpowers/specs/2026-07-25-hex-alpha-concat-fix-design.md.
    const onToggle = vi.fn();
    render(<DockToggleRow item={{ id: 'x', label: 'X', active: true, onToggle }} />);
    const dot = screen.getByText('X').closest('button')!.querySelector('span');
    expect(dot).toHaveStyle({
      boxShadow: '0 0 4px color-mix(in srgb, var(--brand-gold) 50.2%, transparent)',
    });
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

describe('DockToggleRow accessibility and density', () => {
  const baseItem = {
    id: 'weather',
    label: 'Weather Radar',
    active: false,
    onToggle: () => {},
    color: 'var(--sev-info)',
    description: 'Precipitation overlay',
    icon: Cloud,
  };

  it('exposes switch semantics so keyboard and screen-reader users can toggle it', () => {
    render(<DockToggleRow item={baseItem} />);
    const row = screen.getByRole('switch', { name: /weather radar/i });
    expect(row).toHaveAttribute('aria-checked', 'false');
  });

  it('reflects the active state in aria-checked', () => {
    render(<DockToggleRow item={{ ...baseItem, active: true }} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('fires onToggle when activated', async () => {
    const onToggle = vi.fn();
    render(<DockToggleRow item={{ ...baseItem, onToggle }} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders a 44px minimum row height in touch density', () => {
    render(
      <MapDensityProvider initialOverride="touch">
        <DockToggleRow item={baseItem} />
      </MapDensityProvider>,
    );
    expect(screen.getByRole('switch')).toHaveStyle({ minHeight: '44px' });
  });

  it('renders the compact row height by default', () => {
    render(
      <MapDensityProvider initialOverride="compact">
        <DockToggleRow item={baseItem} />
      </MapDensityProvider>,
    );
    expect(screen.getByRole('switch')).toHaveStyle({ minHeight: '24px' });
  });

  it('still renders when a layer has no icon', () => {
    const { icon: _icon, ...noIcon } = baseItem;
    render(<DockToggleRow item={noIcon} />);
    expect(screen.getByRole('switch', { name: /weather radar/i })).toBeInTheDocument();
  });

  it('stars a layer without toggling visibility', () => {
    const onToggle = vi.fn();
    const onToggleFavorite = vi.fn();
    render(<DockToggleRow item={{
      id: 'traffic', label: 'Live Traffic', active: false, onToggle, onToggleFavorite, favorite: false,
    }} />);
    fireEvent.click(screen.getByLabelText(/favorite live traffic/i));
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
