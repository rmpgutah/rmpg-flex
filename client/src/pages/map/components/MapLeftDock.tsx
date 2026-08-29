// ============================================================
// RMPG Flex — Map Left Dock ("Layers")
// Always-visible left-side dock replacing the old floating
// Layers Panel (MapOverlaysPanel). Generic renderer over a list
// of { title, items } sections — MapboxMapPage.tsx owns the data.
// ============================================================

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

export default function MapLeftDock({ sections }: MapLeftDockProps) {
  return (
    <div className="relative z-20 h-full w-[220px] bg-surface-raised/95 border-r border-border-default backdrop-blur-sm flex flex-col overflow-y-auto">
      <div className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-brand-gold-500 border-b border-border-default">
        LAYERS
      </div>
      {sections.map((section) => (
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
    </div>
  );
}
