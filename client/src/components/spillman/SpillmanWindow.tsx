import React from 'react';

export interface SpillmanWindowProps {
  title: string;
  screenName?: string;
  statusLeft?: React.ReactNode;
  statusRight?: React.ReactNode;
  onMinimize?: () => void;
  onMaximize?: () => void;
  onClose?: () => void;
  children: React.ReactNode;
}

/** Spillman window shell: grey title bar (title / screen name / controls),
 *  a body region, and an optional status bar. */
export default function SpillmanWindow({
  title, screenName, statusLeft, statusRight,
  onMinimize, onMaximize, onClose, children,
}: SpillmanWindowProps) {
  const hasStatus = statusLeft != null || statusRight != null;
  return (
    <div className="spm-window">
      <div className="spm-window-titlebar">
        <span className="spm-window-title">{title}</span>
        {screenName && <span className="spm-window-screen">{screenName}</span>}
        <span className="spm-window-controls">
          {onMinimize && (
            <button type="button" aria-label="Minimize" onClick={onMinimize}>–</button>
          )}
          {onMaximize && (
            <button type="button" aria-label="Maximize" onClick={onMaximize}>□</button>
          )}
          {onClose && (
            <button type="button" className="spm-window-close" aria-label="Close" onClick={onClose}>×</button>
          )}
        </span>
      </div>
      <div className="spm-window-body">{children}</div>
      {hasStatus && (
        <div className="spm-window-status">
          <span>{statusLeft}</span>
          <span>{statusRight}</span>
        </div>
      )}
    </div>
  );
}
