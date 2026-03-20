// ============================================================
// RMPG Flex — Panel Title Bar (Spillman Flex Window Chrome)
// Desktop-window-style title bar for panels and sections
// ============================================================

import React from 'react';

interface PanelTitleBarProps {
  title: string;
  icon?: React.ElementType;
  children?: React.ReactNode;
  className?: string;
  titleClassName?: string;
  id?: string;
  /** Show a colored LED status dot (green/red/amber/blue) */
  statusLed?: 'green' | 'red' | 'amber' | 'blue' | 'off';
  /** Pulse the LED indicator */
  ledPulse?: boolean;
}

export default function PanelTitleBar({
  title,
  icon: Icon,
  children,
  className = '',
  titleClassName = '',
  id,
  statusLed,
  ledPulse = false,
}: PanelTitleBarProps) {
  return (
    <div className={`panel-title-bar ${className}`}>
      {Icon && <Icon className="title-icon" />}
      {statusLed && statusLed !== 'off' && (
        <span className={`led-dot led-${statusLed}${ledPulse ? ' animate-led-pulse' : ''}`} />
      )}
      <span id={id} className={titleClassName}>{title}</span>
      {children && (
        <div className="ml-auto flex items-center gap-1 flex-wrap min-w-0">
          {children}
        </div>
      )}
    </div>
  );
}
