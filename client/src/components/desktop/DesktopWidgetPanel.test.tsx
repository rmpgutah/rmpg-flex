import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../../hooks/useApi', () => ({ apiFetch: vi.fn().mockResolvedValue({}) }));
vi.mock('../../hooks/useClock', () => ({ useClock: () => ({ time: '12:00:00', date: 'Sat, Jul 18, 2026' }) }));
vi.mock('../../hooks/useNavBadges', () => ({ useNavBadges: () => ({ badges: {} }) }));

import DesktopWidgetPanel from './DesktopWidgetPanel';
import { normalizeDesktopWidgets } from '../../utils/normalizeDesktopWidgets';

// normalizeDesktopWidgets(null) turns 'quick-access' on by default (v1 default-on
// set), and DesktopQuickAccessWidget calls useNavigate() — so every render here
// needs a Router ancestor, same as the v1 test this file replaces.
describe('DesktopWidgetPanel — freeform layout', () => {
  it('positions each enabled widget absolutely at its own x/y, applying opacity + blur', () => {
    const widgets = normalizeDesktopWidgets(null).map(w => w.id === 'clock' ? { ...w, x: 300, y: 40, opacity: 0.6, blur: 4 } : w);
    const onMoveWidget = vi.fn();
    render(<MemoryRouter><DesktopWidgetPanel widgets={widgets} catalog={[]} onMoveWidget={onMoveWidget} onAdjustWidget={vi.fn()} /></MemoryRouter>);
    const clockPanel = screen.getByText('12:00:00').closest('[data-widget-id="clock"]') as HTMLElement;
    expect(clockPanel).toHaveStyle({ position: 'absolute', left: '300px', top: '40px', opacity: '0.6' });
    expect(clockPanel.style.backdropFilter).toContain('blur(4px)');
  });

  it('renders only widgets with on:true', () => {
    const widgets = normalizeDesktopWidgets(null); // v1 defaults: clock/ops-summary/notifications/quick-access on, others off
    render(<MemoryRouter><DesktopWidgetPanel widgets={widgets} catalog={[]} onMoveWidget={vi.fn()} onAdjustWidget={vi.fn()} /></MemoryRouter>);
    expect(screen.queryByText(/Shift Timer/i)).not.toBeInTheDocument();
  });

  it('lets clicks pass through empty canvas while keeping each widget frame clickable (regression: full-canvas overlay bug)', () => {
    const widgets = normalizeDesktopWidgets(null).map(w => w.id === 'clock' ? { ...w, x: 300, y: 40 } : w);
    render(<MemoryRouter><DesktopWidgetPanel widgets={widgets} catalog={[]} onMoveWidget={vi.fn()} onAdjustWidget={vi.fn()} /></MemoryRouter>);

    const clockPanel = screen.getByText('12:00:00').closest('[data-widget-id="clock"]') as HTMLElement;
    // The widget frame itself must remain interactive.
    expect(clockPanel).toHaveStyle({ pointerEvents: 'auto' });

    // The outer wrapper (which paints above icons/notes via zIndex: 10) must stay
    // pointer-events: none so canvas space NOT covered by any widget passes clicks
    // through to whatever sits underneath. Previously an intermediate full-`inset: 0`
    // div re-enabled pointerEvents: 'auto' across the ENTIRE canvas, silently
    // swallowing every click regardless of whether a widget was visually there.
    const outerWrapper = clockPanel.parentElement as HTMLElement;
    expect(outerWrapper).toHaveStyle({ position: 'absolute', inset: '0px', pointerEvents: 'none' });

    // No element between the outer wrapper and the widget frame should re-enable
    // pointer-events across the full canvas — the widget frame's parent must be
    // the outer wrapper directly (no intermediate full-coverage div).
    expect(outerWrapper.style.pointerEvents).toBe('none');
  });

  it('right-clicking a widget offers opacity and blur adjustments that call onAdjustWidget', () => {
    const widgets = normalizeDesktopWidgets(null).map(w => w.id === 'clock' ? { ...w, opacity: 1, blur: 0 } : w);
    const onAdjustWidget = vi.fn();
    render(<MemoryRouter><DesktopWidgetPanel widgets={widgets} catalog={[]} onMoveWidget={vi.fn()} onAdjustWidget={onAdjustWidget} /></MemoryRouter>);
    const clockPanel = screen.getByText('12:00:00').closest('[data-widget-id="clock"]') as HTMLElement;
    fireEvent.contextMenu(clockPanel);
    fireEvent.click(screen.getByText('Decrease opacity'));
    expect(onAdjustWidget).toHaveBeenCalledWith('clock', { opacity: 0.9 });
    // ContextMenu closes itself after each item click, so re-open before the next pick.
    fireEvent.contextMenu(clockPanel);
    fireEvent.click(screen.getByText('Toggle blur'));
    expect(onAdjustWidget).toHaveBeenCalledWith('clock', { blur: 6 });
  });
});
