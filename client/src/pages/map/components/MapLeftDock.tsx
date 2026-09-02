// ============================================================
// RMPG Flex — Map Left Dock ("Layers")
// Always-visible left-side dock replacing the old floating
// Layers Panel (MapOverlaysPanel). Generic renderer over a list
// of { title, items } sections — MapboxMapPage.tsx owns the data.
// ============================================================

import { useMemo, useState } from 'react';
import DockSection, { DockToggleRow, type DockToggleItem } from './DockSection';

export interface MapLeftDockSection {
  title: string;
  items: DockToggleItem[];
  /** Forwarded to DockSection — when false, this section renders
   *  always-expanded with no collapse control. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  onEnableAll?: () => void;
  onDisableAll?: () => void;
}

export interface MapLeftDockProps {
  sections: MapLeftDockSection[];
}

export function LayersDockBody({ sections }: MapLeftDockProps) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();

  const favorites = useMemo(
    () => sections.flatMap((s) => s.items).filter((i) => i.favorite),
    [sections],
  );

  const visible = useMemo(() => {
    if (!needle) return sections;
    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          const hay = `${item.label} ${item.id} ${item.description ?? ''}`.toLowerCase();
          return hay.includes(needle);
        }),
        collapsible: false,
      }))
      .filter((section) => section.items.length > 0);
  }, [needle, sections]);

  const active = useMemo(
    () => sections.flatMap((s) => s.items).filter((i) => i.active),
    [sections],
  );

  return (
    <>
      <div className="px-2 py-1.5 border-b border-border-subtle">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[10px] text-fg-muted">{active.length} on</span>
        </div>
        <input
          type="search"
          aria-label="Find layer"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find layer"
          className="w-full px-2 py-1 text-[11px] bg-surface-overlay border border-border-subtle rounded text-fg-primary placeholder:text-fg-muted"
        />
      </div>
      {!needle && favorites.length > 0 && (
        <DockSection title="Favorites" collapsible={false}>
          {favorites.map((item) => (
            <DockToggleRow key={`fav-${item.id}`} item={item} />
          ))}
        </DockSection>
      )}
      {visible.map((section) => (
        <DockSection
          key={section.title}
          title={section.title}
          collapsible={section.collapsible}
          defaultOpen={section.defaultOpen}
          onEnableAll={section.onEnableAll}
          onDisableAll={section.onDisableAll}
        >
          {section.items.map((item) => (
            <DockToggleRow key={item.id} item={item} />
          ))}
        </DockSection>
      ))}
      {needle && visible.length === 0 && (
        <div className="px-3 py-2 text-[10px] text-rmpg-500">No layers match “{query.trim()}”.</div>
      )}
    </>
  );
}

export default function MapLeftDock({ sections }: MapLeftDockProps) {
  return (
    <div className="relative z-20 h-full w-[220px] bg-surface-raised/95 border-r border-border-default backdrop-blur-sm flex flex-col overflow-y-auto">
      <div className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-brand-gold-500 border-b border-border-default">
        LAYERS
      </div>
      <LayersDockBody sections={sections} />
    </div>
  );
}
