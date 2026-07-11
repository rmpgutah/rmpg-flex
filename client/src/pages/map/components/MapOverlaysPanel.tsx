// Map Overlays Panel — tabbed toggle panel for all map overlay layers
import React, { useState, useMemo } from 'react';
import { Layers, Search } from 'lucide-react';
import PanelTitleBar from '../../../components/PanelTitleBar';

export interface OverlayToggle {
  id: string;
  label: string;
  icon?: React.ElementType;
  description?: string;
  active: boolean;
  onToggle: () => void;
  loading?: boolean;
  group?: string;
  color?: string;
}

export interface LayerGroup {
  id: string;
  label: string;
  layers: OverlayToggle[];
}

interface MapOverlaysPanelProps {
  overlays?: OverlayToggle[];
  groups?: LayerGroup[];
  open?: boolean;
  onClose?: () => void;
  className?: string;
}

const FALLBACK_GROUP_LABEL: Record<string, string> = {
  density: 'Density & Patterns',
  tactical: 'Tactical & Safety',
  routing: 'Routing & ETA',
  history: 'Historical & Data',
};

export default function MapOverlaysPanel({ overlays, groups, open, onClose, className = '' }: MapOverlaysPanelProps) {
  // If `groups` is provided, use it directly. Otherwise bucket a flat
  // `overlays` list by its `.group` property (legacy callers).
  const resolvedGroups: LayerGroup[] = useMemo(() => {
    if (groups) return groups;
    const grouped = new Map<string, OverlayToggle[]>();
    (overlays ?? []).forEach((o) => {
      const g = o.group || 'other';
      if (!grouped.has(g)) grouped.set(g, []);
      grouped.get(g)!.push(o);
    });
    return Array.from(grouped.entries()).map(([id, layers]) => ({
      id, label: FALLBACK_GROUP_LABEL[id] ?? id, layers,
    }));
  }, [groups, overlays]);

  const [activeTab, setActiveTab] = useState<string>(resolvedGroups[0]?.id ?? '');
  const [search, setSearch] = useState('');

  // Guard against the active tab id vanishing if `groups` changes shape.
  const currentTab = resolvedGroups.some((g) => g.id === activeTab) ? activeTab : (resolvedGroups[0]?.id ?? '');

  const query = search.trim().toLowerCase();
  const matchesQuery = (item: OverlayToggle) => !query || item.label.toLowerCase().includes(query);

  const activeGroup = resolvedGroups.find((g) => g.id === currentTab);
  const visibleItems = query ? (activeGroup?.layers.filter(matchesQuery) ?? []) : (activeGroup?.layers ?? []);

  // Cross-tab hint: only computed while searching and only when the active
  // tab has zero matches — avoids extra work on every keystroke otherwise.
  const crossTabMatch = useMemo(() => {
    if (!query || visibleItems.length > 0) return null;
    for (const g of resolvedGroups) {
      if (g.id === currentTab) continue;
      const count = g.layers.filter(matchesQuery).length;
      if (count > 0) return { groupId: g.id, groupLabel: g.label, count };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, visibleItems.length, resolvedGroups, currentTab]);

  if (open === false) return null;

  return (
    <div
      className={`flex flex-col ${className}`}
      style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-default)', borderRadius: 2 }}
    >
      <PanelTitleBar title="MAP TOOLS" icon={Layers} statusLed="amber" />

      {/* Tabs */}
      <div role="tablist" className="flex border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        {resolvedGroups.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={g.id === currentTab}
            onClick={() => setActiveTab(g.id)}
            className="flex-1 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors"
            style={{
              color: g.id === currentTab ? 'var(--brand-gold)' : 'var(--text-secondary)',
              borderBottom: g.id === currentTab ? '2px solid var(--brand-gold)' : '2px solid transparent',
              background: g.id === currentTab ? 'var(--surface-raised)' : 'transparent',
            }}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <Search style={{ width: 11, height: 11, color: 'var(--text-secondary)', flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Search tools…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 text-[10px] bg-transparent outline-none"
          style={{ color: 'var(--text-primary)', border: 'none' }}
        />
      </div>

      <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 350px)' }}>
        {visibleItems.length === 0 && crossTabMatch && (
          <button
            type="button"
            onClick={() => setActiveTab(crossTabMatch.groupId)}
            className="w-full text-left px-3 py-2 text-[10px]"
            style={{ color: 'var(--brand-gold)' }}
          >
            {crossTabMatch.count} result{crossTabMatch.count !== 1 ? 's' : ''} in another tab — {crossTabMatch.groupLabel}
          </button>
        )}
        {visibleItems.length === 0 && !crossTabMatch && (
          <div className="px-3 py-4 text-[10px] text-center" style={{ color: 'var(--text-secondary)' }}>
            No tools match &ldquo;{search}&rdquo;
          </div>
        )}
        <div className="py-1">
          {visibleItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={item.onToggle}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] transition-all"
              style={{
                background: item.active ? 'var(--surface-raised)' : 'transparent',
                color: item.active ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              <div
                className="w-7 h-4 shrink-0 relative rounded-full transition-colors"
                style={{ background: item.active ? 'var(--brand-gold)' : 'var(--surface-raised)' }}
              >
                <div
                  className="absolute top-0.5 w-3 h-3 rounded-full transition-all"
                  style={{
                    background: item.active ? 'var(--surface-base)' : 'var(--text-secondary)',
                    left: item.active ? '14px' : '2px',
                  }}
                />
              </div>
              {item.icon && (
                <item.icon
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: item.active ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                  aria-hidden="true"
                />
              )}
              <div className="flex-1 min-w-0 text-left">
                <div className="truncate text-[11px]">{item.label}</div>
                {item.description && (
                  <div className="text-[9px] truncate" style={{ color: 'var(--text-secondary)' }}>{item.description}</div>
                )}
              </div>
              {item.loading && (
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--brand-gold)' }} />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
