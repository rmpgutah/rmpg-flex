import React from 'react';

export interface TabSpec {
  id: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
  badge?: string;
  disabled?: boolean;
}

export interface SpillmanTabPanelProps {
  /** Tabs to display */
  tabs: TabSpec[];
  /** Currently active tab id */
  activeTab: string;
  /** Called when a tab is selected */
  onTabChange: (id: string) => void;
  /** Tab bar style: 'form' = raised Spillman form tabs, 'record' = record-type strip */
  variant?: 'form' | 'record' | 'classic';
  /** Content below the tab strip */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Reusable Spillman-styled tab strip + content area.
 * Uses `spm-form-tab` (raised, scoped to spm-page) by default.
 */
export default function SpillmanTabPanel({
  tabs,
  activeTab,
  onTabChange,
  variant = 'form',
  children,
  className = '',
}: SpillmanTabPanelProps) {
  const stripClass =
    variant === 'record' ? 'spm-record-tabs' :
    variant === 'classic' ? 'spillman-tab-bar' :
    'spm-form-tabs';

  const tabClass =
    variant === 'record' ? 'spm-record-tab' :
    variant === 'classic' ? 'spillman-tab' :
    'spm-form-tab';

  return (
    <div className={`spm-tabpanel ${className}`}>
      {/* Tab strip */}
      <div className={stripClass} role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            disabled={tab.disabled}
            className={`${tabClass}${activeTab === tab.id ? ' on' : ''}${tab.disabled ? ' opacity-40 cursor-not-allowed' : ''}`}
            onClick={() => !tab.disabled && onTabChange(tab.id)}
          >
            {tab.icon && <span className="mr-1">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.count != null && (
              <span className="spm-record-tab-count ml-1">({tab.count})</span>
            )}
            {tab.badge && (
              <span className="ml-1 px-1 text-[9px] font-bold rounded-sm bg-red-700 text-white">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {children != null && (
        <div className="spm-tabpanel-body">
          {children}
        </div>
      )}
    </div>
  );
}
