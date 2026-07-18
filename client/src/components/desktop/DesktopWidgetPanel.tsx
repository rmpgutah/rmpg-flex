import React from 'react';
import type { NavFunction } from '../../data/navCatalog';
import DesktopClockWidget from './widgets/DesktopClockWidget';
import DesktopOpsSummaryWidget from './widgets/DesktopOpsSummaryWidget';
import DesktopNotificationsWidget from './widgets/DesktopNotificationsWidget';
import DesktopQuickAccessWidget from './widgets/DesktopQuickAccessWidget';

export interface DesktopWidgetPanelProps {
  enabledWidgets: string[];
  // Role-filtered catalog (DesktopPage's `allFunctions`) — threaded through
  // specifically to DesktopQuickAccessWidget, the only enabled widget that
  // renders a module list. The other three widgets take no props.
  catalog: NavFunction[];
}

const WIDGET_COMPONENTS: Record<string, React.ComponentType<any>> = {
  'clock': DesktopClockWidget,
  'ops-summary': DesktopOpsSummaryWidget,
  'notifications': DesktopNotificationsWidget,
  'quick-access': DesktopQuickAccessWidget,
};

export default function DesktopWidgetPanel({ enabledWidgets, catalog }: DesktopWidgetPanelProps) {
  return (
    <div className="flex flex-col gap-2" style={{ position: 'fixed', right: 16, top: 16, zIndex: 10 }}>
      {enabledWidgets.map(id => {
        const Widget = WIDGET_COMPONENTS[id];
        if (!Widget) return null;
        return id === 'quick-access' ? <Widget key={id} catalog={catalog} /> : <Widget key={id} />;
      })}
    </div>
  );
}
