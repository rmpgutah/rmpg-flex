import React from 'react';

export interface ToolbarButton {
  id: string;
  icon?: React.ReactNode;
  label?: string;
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
}

interface SpillmanToolbarProps {
  buttons: ToolbarButton[];
  leading?: React.ReactNode;
  ariaLabel: string;
}

/** A Spillman toolbar row of icon+label buttons. Icon-agnostic: pass any node. */
export default function SpillmanToolbar({ buttons, leading, ariaLabel }: SpillmanToolbarProps) {
  return (
    <div className="spm-toolbar" role="toolbar" aria-label={ariaLabel}>
      {leading && <div className="spm-toolbar-leading">{leading}</div>}
      {buttons.map((b) => (
        <button
          key={b.id}
          type="button"
          className={`toolbar-btn${b.primary ? ' toolbar-btn-primary' : ''}`}
          title={b.title ?? b.label}
          aria-label={b.label ?? b.title ?? b.id}
          disabled={b.disabled}
          onClick={b.onClick}
        >
          {b.icon}
          {b.label && <span className="spm-toolbar-label">{b.label}</span>}
        </button>
      ))}
    </div>
  );
}
