// ============================================================
// RMPG Flex — Map Right Dock ("Info & Tools")
// Always-visible right-side dock: Dispatch Tools / Analysis /
// Diagnostics. Generic renderer, same pattern as MapLeftDock.
// ============================================================

import DockSection, { DockToggleRow, type DockToggleItem } from './DockSection';

export interface MapRightDockSection {
  title: string;
  items: DockToggleItem[];
}

export interface MapRightDockProps {
  sections: MapRightDockSection[];
}

export default function MapRightDock({ sections }: MapRightDockProps) {
  return (
    <div className="relative z-20 h-full w-[220px] bg-surface-raised/95 border-l border-border-default backdrop-blur-sm flex flex-col overflow-y-auto">
      <div className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-brand-gold-500 border-b border-border-default">
        INFO &amp; TOOLS
      </div>
      {sections.map((section) => (
        <DockSection key={section.title} title={section.title}>
          {section.items.map((item) => (
            <DockToggleRow key={item.id} item={item} />
          ))}
        </DockSection>
      ))}
    </div>
  );
}
