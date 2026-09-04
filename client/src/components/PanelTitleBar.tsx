// ============================================================
// RMPG Flex — Panel Title Bar (Spillman Flex Window Chrome)
// Desktop-window-style title bar for panels and sections.
// Features: title icon, status LED, window chrome buttons
// (minimize/maximize/close), inline action slots.
// ============================================================

import React, { useCallback } from 'react';

interface PanelTitleBarProps {
  title: string;
  icon?: React.ElementType;
  children?: React.ReactNode;
  className?: string;
  titleClassName?: string;
  id?: string;
  statusLed?: string;
  ledPulse?: boolean;
  /** Show window chrome minimize/maximize/close dots (Spillman Flex style) */
  windowChrome?: boolean;
  /** Callback when the close button is clicked */
  onClose?: () => void;
  /** Callback when the minimize button is clicked */
  onMinimize?: () => void;
  /** Callback when the maximize button is clicked */
  onMaximize?: () => void;
  /** Hide title text (icon-only mode) */
  iconOnly?: boolean;
}

function PanelTitleBar({
  title,
  icon: Icon,
  children,
  className = '',
  titleClassName = '',
  id,
  statusLed,
  ledPulse,
  windowChrome = false,
  onClose,
  onMinimize,
  onMaximize,
  iconOnly = false,
}: PanelTitleBarProps) {
  const handleChromeAction = useCallback((action?: () => void) => {
    if (action) action();
  }, []);

  return (
    <div
      className={`panel-title-bar ${className}`}
      role="heading"
      aria-level={3}
      data-panel-header="true"
    >
      {/* Window chrome buttons (left side, Spillman Flex style) */}
      {windowChrome && (
        <div className="flex items-center gap-1 mr-1.5">
          <button
            type="button"
            className={`window-chrome-btn window-chrome-close ${onClose ? '' : 'opacity-40 cursor-default'}`}
            onClick={() => handleChromeAction(onClose)}
            aria-label={onClose ? `Close ${title} panel` : `Close ${title} panel (disabled)`}
            tabIndex={onClose ? 0 : -1}
          />
          <button
            type="button"
            className={`window-chrome-btn window-chrome-minimize ${onMinimize ? '' : 'opacity-40 cursor-default'}`}
            onClick={() => handleChromeAction(onMinimize)}
            aria-label={onMinimize ? `Minimize ${title} panel` : `Minimize ${title} panel (disabled)`}
            tabIndex={onMinimize ? 0 : -1}
          />
          <button
            type="button"
            className={`window-chrome-btn window-chrome-maximize ${onMaximize ? '' : 'opacity-40 cursor-default'}`}
            onClick={() => handleChromeAction(onMaximize)}
            aria-label={onMaximize ? `Maximize ${title} panel` : `Maximize ${title} panel (disabled)`}
            tabIndex={onMaximize ? 0 : -1}
          />
        </div>
      )}

      {/* Title icon */}
      {Icon && <Icon className="title-icon" aria-hidden="true" />}

      {/* Status LED indicator */}
      {statusLed && (
        <span className={`led-dot ${statusLed} ${ledPulse ? 'animate-led-blink' : ''}`} aria-hidden="true" />
      )}

      {/* Title text (hidden in iconOnly mode) */}
      {!iconOnly && (
        <span id={id} className={`select-none whitespace-nowrap shrink-0 ${titleClassName}`}>
          {title}
        </span>
      )}

      {/* Right-aligned action slot */}
      {children && (
        <div className="ml-auto flex items-center gap-1.5 min-w-0 overflow-x-auto scrollbar-dark whitespace-nowrap">
          {children}
        </div>
      )}
    </div>
  );
}

export default React.memo(PanelTitleBar);
