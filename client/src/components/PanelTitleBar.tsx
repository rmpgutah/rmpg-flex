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
}: PanelTitleBarProps) {
  return (
    <div className={`panel-title-bar ${className}`}>
      {Icon && <Icon className="title-icon" />}
      <span id={id} className={titleClassName}>{title}</span>
      {children && (
        <div className="ml-auto flex items-center gap-1 flex-wrap min-w-0">
          {children}
        </div>
      )}
    </div>
  );
}
