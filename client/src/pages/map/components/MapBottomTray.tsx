// ============================================================
// RMPG Flex — Map Bottom Tray
// Below the 1024px breakpoint, the Roster/Layers/Info & Tools
// docks collapse into this single bottom tabbed tray. Reuses
// MapRosterDock (Roster tab) and the same section-data shape the
// desktop docks take (Layers / Info & Tools tabs), rendered
// through DockSection/DockToggleRow so content matches exactly.
// ============================================================

import { useState } from 'react';
import DockSection, { DockToggleRow } from './DockSection';
import MapRosterDock, { type MapRosterDockProps } from './MapRosterDock';
import type { MapLeftDockSection } from './MapLeftDock';
import type { MapRightDockSection } from './MapRightDock';

type TrayTab = 'roster' | 'layers' | 'info' | null;

export interface MapBottomTrayProps {
  rosterProps: MapRosterDockProps;
  leftSections: MapLeftDockSection[];
  rightSections: MapRightDockSection[];
}

export default function MapBottomTray({ rosterProps, leftSections, rightSections }: MapBottomTrayProps) {
  const [activeTab, setActiveTab] = useState<TrayTab>(null);

  const selectTab = (tab: Exclude<TrayTab, null>) => {
    setActiveTab((current) => (current === tab ? null : tab));
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-30">
      {activeTab && (
        <div className="max-h-[45vh] overflow-y-auto bg-surface-raised/95 border-t border-border-default backdrop-blur-sm">
          {activeTab === 'roster' && <MapRosterDock {...rosterProps} open />}
          {activeTab === 'layers' && leftSections.map((section) => (
            <DockSection key={section.title} title={section.title}>
              {section.items.map((item) => <DockToggleRow key={item.id} item={item} />)}
            </DockSection>
          ))}
          {activeTab === 'info' && rightSections.map((section) => (
            <DockSection key={section.title} title={section.title}>
              {section.items.map((item) => <DockToggleRow key={item.id} item={item} />)}
            </DockSection>
          ))}
        </div>
      )}
      <div className="flex border-t border-border-default bg-surface-raised/95 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => selectTab('roster')}
          className={`flex-1 py-2 text-[10px] font-semibold uppercase tracking-wider transition-colors ${activeTab === 'roster' ? 'text-brand-gold-500' : 'text-rmpg-400'}`}
        >
          Roster
        </button>
        <button
          type="button"
          onClick={() => selectTab('layers')}
          className={`flex-1 py-2 text-[10px] font-semibold uppercase tracking-wider transition-colors border-l border-border-subtle ${activeTab === 'layers' ? 'text-brand-gold-500' : 'text-rmpg-400'}`}
        >
          Layers
        </button>
        <button
          type="button"
          onClick={() => selectTab('info')}
          className={`flex-1 py-2 text-[10px] font-semibold uppercase tracking-wider transition-colors border-l border-border-subtle ${activeTab === 'info' ? 'text-brand-gold-500' : 'text-rmpg-400'}`}
        >
          Info & Tools
        </button>
      </div>
    </div>
  );
}
