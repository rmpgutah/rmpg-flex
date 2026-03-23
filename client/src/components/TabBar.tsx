// ============================================================
// RMPG Flex — Tab Bar (Spillman Flex Tabs)
// Sharp-cornered tab bar for switching views within panels
// ============================================================

import React from 'react';

interface Tab {
  id: string;
  label: string;
  count?: number;
  icon?: React.ElementType;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

export default function TabBar({
  tabs,
  activeTab,
  onTabChange,
  className = '',
}: TabBarProps) {
  return (
    <div className={`tab-bar ${className}`} role="tablist">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button type="button"
            key={tab.id}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`tabpanel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(e) => {
              const idx = tabs.findIndex(t => t.id === tab.id);
              if (e.key === 'ArrowRight' && idx < tabs.length - 1) {
                e.preventDefault();
                onTabChange(tabs[idx + 1].id);
              } else if (e.key === 'ArrowLeft' && idx > 0) {
                e.preventDefault();
                onTabChange(tabs[idx - 1].id);
              } else if (e.key === 'Home') {
                e.preventDefault();
                onTabChange(tabs[0].id);
              } else if (e.key === 'End') {
                e.preventDefault();
                onTabChange(tabs[tabs.length - 1].id);
              }
            }}
            className={`tab-bar-item ${activeTab === tab.id ? 'active' : ''}`}
          >
            {Icon && <Icon style={{ width: 12, height: 12, marginRight: 4, display: 'inline', color: activeTab === tab.id ? '#3b8ad4' : 'inherit' }} />}
            {tab.label}
            {tab.count !== undefined && (
              <span className="font-mono tabular-nums" style={{ marginLeft: 4, opacity: 0.6, fontSize: '0.9em' }}>({tab.count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
