// ============================================================
// RMPG Flex — Panel Title Bar (Spillman Flex Window Chrome)
// Desktop-window-style title bar for panels and sections
// ============================================================

import React from 'react';

export interface PanelTitleBarProps {
  title: string;
  icon?: React.ElementType;
  children?: React.ReactNode;
  /** Inline badge element rendered next to title */
  badge?: React.ReactNode;
  /** Action buttons rendered at the right side */
  actions?: React.ReactNode;
  className?: string;
  titleClassName?: string;
  id?: string;
}

export default function PanelTitleBar({
  title,
  icon: Icon,
  children,
  badge,
  actions,
  className = '',
  titleClassName = '',
  id,
}: PanelTitleBarProps) {
  return (
    <div className={`panel-title-bar ${className}`}>
      {Icon && <Icon className="title-icon" />}
      <span id={id} className={titleClassName}>{title}</span>
      {badge}
      {(children || actions) && (
        <div className="ml-auto flex items-center gap-1 flex-wrap min-w-0">
          {children}
          {actions}
        </div>
      )}
    </div>
  );
}
