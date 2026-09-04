// ============================================================
// RMPG Flex — Tab Bar (Spillman Flex Tabs)
// Sharp-cornered, keyboard-navigable tab bar for switching
// views within panels. Arrow keys, Home/End supported.
// ============================================================

import React, { useCallback, useRef } from 'react';

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
  /** Spillman Flex mode — thicker tabs with gold active indicator */
  spillman?: boolean;
}

function TabBar({
  tabs,
  activeTab,
  onTabChange,
  className = '',
  spillman = false,
}: TabBarProps) {
  const tabListRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, tabId: string) => {
    const idx = tabs.findIndex(t => t.id === tabId);
    let nextIdx = -1;

    switch (e.key) {
      case 'ArrowRight':
        nextIdx = idx < tabs.length - 1 ? idx + 1 : 0;
        break;
      case 'ArrowLeft':
        nextIdx = idx > 0 ? idx - 1 : tabs.length - 1;
        break;
      case 'Home':
        nextIdx = 0;
        break;
      case 'End':
        nextIdx = tabs.length - 1;
        break;
    }

    if (nextIdx >= 0 && nextIdx !== idx) {
      e.preventDefault();
      onTabChange(tabs[nextIdx].id);
      buttonRefs.current[nextIdx]?.focus();
    }
  }, [tabs, onTabChange]);

  return (
    <div
      ref={tabListRef}
      className={`${spillman ? 'spillman-tab-bar' : 'tab-bar'} ${className}`}
      role="tablist"
      aria-label="Section tabs"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            type="button"
            key={tab.id}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            ref={(el) => { buttonRefs.current[tabs.indexOf(tab)] = el; }}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, tab.id)}
            className={`${spillman ? 'spillman-tab' : 'tab-bar-item'} ${isActive ? 'active' : ''}`}
            title={tab.label}
          >
            {Icon && (
              <Icon
                style={{
                  width: spillman ? 12 : 14,
                  height: spillman ? 12 : 14,
                  marginRight: spillman ? 5 : 6,
                  display: 'inline',
                  color: isActive ? 'var(--brand-gold)' : 'inherit',
                }}
              />
            )}
            {tab.label}
            {tab.count !== undefined && (
              <span className={`font-mono tabular-nums ${spillman ? 'ml-1.5 text-[9px] opacity-60' : ''}`} style={{ marginLeft: spillman ? undefined : 6, opacity: spillman ? undefined : 0.6, fontSize: spillman ? undefined : '0.9em' }}>
                {spillman ? `[${tab.count}]` : `(${tab.count})`}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default React.memo(TabBar);
