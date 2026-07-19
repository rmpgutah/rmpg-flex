import React from 'react';
import type { NavFunction } from '../../data/navCatalog';
import type { DesktopWidgetState } from '../../utils/normalizeDesktopWidgets';
import { useDraggablePosition } from '../../hooks/useDraggablePosition';
import ContextMenu from '../ContextMenu';
import DesktopClockWidget from './widgets/DesktopClockWidget';
import DesktopOpsSummaryWidget from './widgets/DesktopOpsSummaryWidget';
import DesktopNotificationsWidget from './widgets/DesktopNotificationsWidget';
import DesktopQuickAccessWidget from './widgets/DesktopQuickAccessWidget';
import DesktopShiftTimerWidget from './widgets/DesktopShiftTimerWidget';
import DesktopPinnedCallTicker from './widgets/DesktopPinnedCallTicker';
import DesktopMiniMapWidget from './widgets/DesktopMiniMapWidget';

export interface DesktopWidgetPanelProps {
  widgets: DesktopWidgetState[];
  // Role-filtered catalog (DesktopPage's `allFunctions`) — threaded through
  // specifically to DesktopQuickAccessWidget, the only widget that renders a
  // module list. The other widgets take no props.
  catalog: NavFunction[];
  onMoveWidget: (id: string, x: number, y: number) => void;
  onAdjustWidget: (id: string, patch: Partial<Pick<DesktopWidgetState, 'opacity' | 'blur'>>) => void;
}

// Left as `any`: every widget but 'quick-access' takes no props at all, so a
// shared prop type would either make `catalog` optional (which then fails to
// satisfy DesktopQuickAccessWidgetProps's required `catalog`) or required
// (which then fails the no-prop `<Widget />` call sites below) — either way
// forces a real refactor of the no-prop widgets rather than a one-line change.
const WIDGET_COMPONENTS: Record<string, React.ComponentType<any>> = {
  'clock': DesktopClockWidget,
  'ops-summary': DesktopOpsSummaryWidget,
  'notifications': DesktopNotificationsWidget,
  'quick-access': DesktopQuickAccessWidget,
  'shift-timer': DesktopShiftTimerWidget,
  'pinned-call-ticker': DesktopPinnedCallTicker,
  'mini-map': DesktopMiniMapWidget,
};

function clampOpacity(v: number): number {
  return Math.max(0.2, Math.min(1, Math.round(v * 10) / 10));
}

function WidgetFrame({
  widget, catalog, onMoveWidget, onAdjustWidget,
}: {
  widget: DesktopWidgetState;
  catalog: NavFunction[];
  onMoveWidget: (id: string, x: number, y: number) => void;
  onAdjustWidget: (id: string, patch: Partial<Pick<DesktopWidgetState, 'opacity' | 'blur'>>) => void;
}) {
  const { onPointerDown } = useDraggablePosition(widget.x, widget.y, (x, y) => onMoveWidget(widget.id, x, y));
  const Widget = WIDGET_COMPONENTS[widget.id];
  if (!Widget) return null;
  return (
    <ContextMenu
      items={[
        { label: 'Increase opacity', onClick: () => onAdjustWidget(widget.id, { opacity: clampOpacity(widget.opacity + 0.1) }) },
        { label: 'Decrease opacity', onClick: () => onAdjustWidget(widget.id, { opacity: clampOpacity(widget.opacity - 0.1) }) },
        { label: 'Toggle blur', onClick: () => onAdjustWidget(widget.id, { blur: widget.blur > 0 ? 0 : 6 }) },
      ]}
    >
      <div
        data-widget-id={widget.id}
        onPointerDown={onPointerDown}
        style={{
          position: 'absolute',
          left: widget.x,
          top: widget.y,
          opacity: widget.opacity,
          backdropFilter: widget.blur > 0 ? `blur(${widget.blur}px)` : undefined,
          cursor: 'move',
          pointerEvents: 'auto',
        }}
      >
        {widget.id === 'quick-access' ? <Widget catalog={catalog} /> : <Widget />}
      </div>
    </ContextMenu>
  );
}

export default function DesktopWidgetPanel({ widgets = [], catalog, onMoveWidget, onAdjustWidget }: DesktopWidgetPanelProps) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none' }}>
      {widgets.filter(w => w.on).map(w => (
        <WidgetFrame key={w.id} widget={w} catalog={catalog} onMoveWidget={onMoveWidget} onAdjustWidget={onAdjustWidget} />
      ))}
    </div>
  );
}
