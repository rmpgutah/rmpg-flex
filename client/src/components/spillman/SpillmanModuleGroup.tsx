import React, { useState } from 'react';

export interface ModuleTab {
  /** Tab identifier (used as key and for onTabChange) */
  id: string;
  /** Display label */
  label: string;
  /** Optional badge count */
  count?: number;
  /** Whether this tab is disabled */
  disabled?: boolean;
}

export interface ModuleGroupSpec {
  /** Group header label */
  label: string;
  /** Visual tone for the group header */
  tone?: 'steel' | 'red' | 'gold' | 'green' | 'neutral';
  /** Tabs within this group */
  tabs: ModuleTab[];
}

export interface SpillmanModuleGroupProps {
  /** Array of tab groups */
  groups: ModuleGroupSpec[];
  /** Currently active tab id */
  activeTab: string;
  /** Called when a tab is clicked */
  onTabChange: (tabId: string) => void;
  /** Render the content for the active tab */
  children?: React.ReactNode;
  /** Extra class on the outer container */
  className?: string;
}

const TONE_CLASSES: Record<string, string> = {
  steel: 'spm-modgroup-head--steel',
  red:   'spm-modgroup-head--red',
  gold:  'spm-modgroup-head--gold',
  green: 'spm-modgroup-head--green',
  neutral: 'spm-modgroup-head--neutral',
};

/**
 * Feature-consolidation component: organises many tabs into labelled category
 * groups with Spillman-chrome headers.
 *
 * Usage:
 *   <SpillmanModuleGroup
 *     groups={[
 *       { label: 'Case', tone: 'steel', tabs: [
 *           { id: 'overview',    label: 'Overview'    },
 *           { id: 'narrative',   label: 'Narrative'   },
 *       ]},
 *       { label: 'Links', tone: 'gold', tabs: [
 *           { id: 'persons',     label: 'Persons',  count: 3 },
 *           { id: 'vehicles',    label: 'Vehicles'           },
 *       ]},
 *     ]}
 *     activeTab={tab}
 *     onTabChange={setTab}
 *   >
 *     {renderTabContent(tab)}
 *   </SpillmanModuleGroup>
 */
export default function SpillmanModuleGroup({
  groups,
  activeTab,
  onTabChange,
  children,
  className = '',
}: SpillmanModuleGroupProps) {
  return (
    <div className={`spm-modgroup ${className}`}>
      {/* Grouped tab strip */}
      <div className="spm-modgroup-strip" role="tablist">
        {groups.map((group) => (
          <div key={group.label} className="spm-modgroup-group">
            <div
              className={`spm-modgroup-head ${TONE_CLASSES[group.tone ?? 'neutral']}`}
              aria-hidden="true"
            >
              {group.label}
            </div>
            <div className="spm-modgroup-tabs">
              {group.tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  disabled={tab.disabled}
                  className={`spm-modgroup-tab${activeTab === tab.id ? ' on' : ''}${tab.disabled ? ' disabled' : ''}`}
                  onClick={() => !tab.disabled && onTabChange(tab.id)}
                >
                  <span>{tab.label}</span>
                  {tab.count != null && (
                    <span className="spm-modgroup-count">{tab.count}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Active tab content */}
      {children != null && (
        <div className="spm-modgroup-body" role="tabpanel">
          {children}
        </div>
      )}
    </div>
  );
}
