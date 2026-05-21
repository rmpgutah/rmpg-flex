// Map Overlays Panel — sidebar toggle panel for all map overlay layers
import React, { useState, useCallback } from 'react';
import { Layers, Flame, History, MapPin, Clock, AlertTriangle, Shield, FileText, Route, SlidersHorizontal, ChevronDown, ChevronRight } from 'lucide-react';
import PanelTitleBar from '../../../components/PanelTitleBar';
import IconButton from '../../../components/IconButton';

export interface OverlayToggle {
  id: string;
  label: string;
  icon: React.ElementType;
  description: string;
  active: boolean;
  onToggle: () => void;
  loading?: boolean;
  group?: string;
}

interface MapOverlaysPanelProps {
  overlays: OverlayToggle[];
  className?: string;
}

const GROUPS: Record<string, { label: string; color: string }> = {
  density: { label: 'Density & Patterns', color: '#f0b428' },
  tactical: { label: 'Tactical & Safety', color: '#f03c3c' },
  routing: { label: 'Routing & ETA', color: '#d4a017' },
  history: { label: 'Historical & Data', color: '#64d264' },
};

export default function MapOverlaysPanel({ overlays, className = '' }: MapOverlaysPanelProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = useCallback((group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  // Group overlays
  const grouped = new Map<string, OverlayToggle[]>();
  overlays.forEach((o) => {
    const g = o.group || 'other';
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g)!.push(o);
  });

  return (
    <div
      className={`flex flex-col ${className}`}
      style={{ background: '#0a0a0a', border: '1px solid #222222', borderRadius: 2 }}
    >
      <PanelTitleBar title="MAP OVERLAYS" icon={Layers} statusLed="amber" />

      <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 350px)' }}>
        {Array.from(grouped.entries()).map(([group, items]) => {
          const gInfo = GROUPS[group] || { label: group, color: '#888888' };
          const collapsed = collapsedGroups.has(group);

          return (
            <div key={group} className="border-b border-[#1a1a1a] last:border-b-0">
              {/* Group header */}
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                aria-expanded={!collapsed}
                aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${gInfo.label}`}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider hover:brightness-110 transition-all"
                style={{
                  background: 'linear-gradient(180deg, #1a1a1a 0%, #141414 100%)',
                  color: gInfo.color,
                }}
              >
                {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {gInfo.label}
                <span className="ml-auto text-[9px] text-[#555555]">
                  {items.filter((i) => i.active).length}/{items.length}
                </span>
              </button>

              {/* Toggle items */}
              {!collapsed && (
                <div className="py-1">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={item.onToggle}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] hover:brightness-110 transition-all group"
                      style={{
                        background: item.active ? '#141414' : 'transparent',
                        color: item.active ? '#cccccc' : '#555555',
                      }}
                    >
                      {/* Custom toggle switch */}
                      <div
                        className="w-7 h-4 shrink-0 relative rounded-full transition-colors"
                        style={{
                          background: item.active ? '#d4a017' : '#2e2e2e',
                        }}
                      >
                        <div
                          className="absolute top-0.5 w-3 h-3 rounded-full transition-all"
                          style={{
                            background: item.active ? '#0a0a0a' : '#666666',
                            left: item.active ? '14px' : '2px',
                          }}
                        />
                      </div>
                      <item.icon
                        className="w-3.5 h-3.5 shrink-0"
                        style={{ color: item.active ? '#cccccc' : '#555555' }}
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0 text-left">
                        <div className="truncate text-[11px]">{item.label}</div>
                        <div className="text-[9px] text-[#555555] truncate">{item.description}</div>
                      </div>
                      {item.loading && (
                        <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#d4a017' }} />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
