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
    <div className={`tab-bar ${className}`}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`tab-bar-item ${activeTab === tab.id ? 'active' : ''}`}
          >
            {Icon && <Icon style={{ width: 12, height: 12, marginRight: 4, display: 'inline' }} />}
            {tab.label}
            {tab.count !== undefined && (
              <span style={{ marginLeft: 4, opacity: 0.7 }}>({tab.count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
