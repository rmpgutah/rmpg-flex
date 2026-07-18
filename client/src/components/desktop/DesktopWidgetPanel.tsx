import React from 'react';
import DesktopClockWidget from './widgets/DesktopClockWidget';
import DesktopOpsSummaryWidget from './widgets/DesktopOpsSummaryWidget';
import DesktopNotificationsWidget from './widgets/DesktopNotificationsWidget';
import DesktopQuickAccessWidget from './widgets/DesktopQuickAccessWidget';

export interface DesktopWidgetPanelProps {
  enabledWidgets: string[];
}

const WIDGET_COMPONENTS: Record<string, React.ComponentType> = {
  'clock': DesktopClockWidget,
  'ops-summary': DesktopOpsSummaryWidget,
  'notifications': DesktopNotificationsWidget,
  'quick-access': DesktopQuickAccessWidget,
};

export default function DesktopWidgetPanel({ enabledWidgets }: DesktopWidgetPanelProps) {
  return (
    <div className="flex flex-col gap-2" style={{ position: 'fixed', right: 16, top: 16, zIndex: 10 }}>
      {enabledWidgets.map(id => {
        const Widget = WIDGET_COMPONENTS[id];
        return Widget ? <Widget key={id} /> : null;
      })}
    </div>
  );
}
