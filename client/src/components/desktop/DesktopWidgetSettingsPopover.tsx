// client/src/components/desktop/DesktopWidgetSettingsPopover.tsx
import React from 'react';

const ALL_WIDGETS: { id: string; label: string }[] = [
  { id: 'clock', label: 'Clock & Shift' },
  { id: 'ops-summary', label: 'Live Ops Summary' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'quick-access', label: 'Quick Access' },
];

export interface DesktopWidgetSettingsPopoverProps {
  enabledWidgets: string[];
  onToggle: (id: string, enabled: boolean) => void;
  onClose: () => void;
}

export default function DesktopWidgetSettingsPopover({ enabledWidgets, onToggle, onClose }: DesktopWidgetSettingsPopoverProps) {
  return (
    <div
      style={{ position: 'fixed', right: 16, top: 16, width: 220, background: 'var(--surface-raised)', border: '1px solid var(--border-default)', zIndex: 2000 }}
      className="p-2"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--rmpg-400)' }}>Widgets</span>
        <button type="button" onClick={onClose} className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Close</button>
      </div>
      {ALL_WIDGETS.map(w => (
        <label key={w.id} className="flex items-center gap-2 text-[11px] py-1" style={{ color: 'var(--text-primary)' }}>
          <input
            type="checkbox"
            checked={enabledWidgets.includes(w.id)}
            onChange={(e) => onToggle(w.id, e.target.checked)}
          />
          {w.label}
        </label>
      ))}
    </div>
  );
}
