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
  statusLed?: string;
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
  ledPulse,
}: PanelTitleBarProps) {
  return (
    /* 35: role="heading" for accessibility on panel title bars */
    <div className={`panel-title-bar ${className}`} role="heading" aria-level={3}>
      {/* 36: aria-hidden on decorative title icon */}
      {Icon && <Icon className="title-icon" aria-hidden="true" />}
      {/* 37: Status LED indicator support when statusLed prop is provided */}
      {statusLed && (
        <span className={`led-dot ${statusLed} ${ledPulse ? 'animate-led-blink' : ''}`} aria-hidden="true" />
      )}
      <span id={id} className={`select-none whitespace-nowrap shrink-0 ${titleClassName}`}>{title}</span>
      {children && (
        /* 38: Prevent children wrap from squishing title text */
        <div className="ml-auto flex items-center gap-1.5 min-w-0 overflow-x-auto scrollbar-dark whitespace-nowrap">
          {children}
        </div>
      )}
    </div>
  );
}
