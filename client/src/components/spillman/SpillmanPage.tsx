import React from 'react';
import SpillmanMenuBar from './SpillmanMenuBar';
import SpillmanToolbar from './SpillmanToolbar';
import type { MenuSpec } from './SpillmanMenuBar';
import type { ToolbarButton } from './SpillmanToolbar';

export interface SpillmanPageProps {
  /** Module name shown in the steel-blue title bar */
  title: string;
  /** Optional Spillman screen code (right of title bar) */
  screenName?: string;
  /** Optional Lucide icon node */
  icon?: React.ReactNode;
  /** Menus for the SpillmanMenuBar (omit to hide menu bar) */
  menus?: MenuSpec[];
  /** Buttons for the SpillmanToolbar (omit to hide toolbar) */
  toolbar?: ToolbarButton[];
  /** Optional leading content before toolbar buttons */
  toolbarLeading?: React.ReactNode;
  /** Status bar left slot */
  statusLeft?: React.ReactNode;
  /** Status bar right slot */
  statusRight?: React.ReactNode;
  /** Content rendered in the page body */
  children: React.ReactNode;
  /** Extra class names on the outer wrapper */
  className?: string;
}

/**
 * Full-page Spillman Flex window shell. Wraps any module in:
 *   spm-page skin → title bar → [menu bar] → [toolbar] → body → [status bar]
 *
 * Usage:
 *   <SpillmanPage title="WARRANTS" screenName="WR-100" menus={...} toolbar={...}>
 *     ...page content...
 *   </SpillmanPage>
 */
export default function SpillmanPage({
  title,
  screenName,
  icon,
  menus,
  toolbar,
  toolbarLeading,
  statusLeft,
  statusRight,
  children,
  className = '',
}: SpillmanPageProps) {
  const hasStatus = statusLeft != null || statusRight != null;

  return (
    <div className={`spm-page spm-page-shell flex flex-col min-h-0 flex-1 ${className}`}>
      {/* Steel-blue window title bar */}
      <div className="spm-page-titlebar">
        {icon && <span className="spm-page-title-icon">{icon}</span>}
        <span className="spm-page-title">{title}</span>
        {screenName && <span className="spm-page-screen">{screenName}</span>}
      </div>

      {/* Optional Spillman menu bar */}
      {menus && menus.length > 0 && <SpillmanMenuBar menus={menus} />}

      {/* Optional Spillman toolbar */}
      {toolbar && toolbar.length > 0 && (
        <SpillmanToolbar
          buttons={toolbar}
          leading={toolbarLeading}
          ariaLabel={`${title} toolbar`}
        />
      )}

      {/* Page body */}
      <div className="spm-page-body flex-1 min-h-0 overflow-auto scrollbar-dark">
        {children}
      </div>

      {/* Optional status bar */}
      {hasStatus && (
        <div className="spm-window-status">
          <span>{statusLeft}</span>
          <span>{statusRight}</span>
        </div>
      )}
    </div>
  );
}
