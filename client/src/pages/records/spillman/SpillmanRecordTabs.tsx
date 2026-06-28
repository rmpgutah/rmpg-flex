import React from 'react';
import { UserCircle, Car, Building2, Briefcase, Package } from 'lucide-react';

export type RecordTabId = 'persons' | 'vehicles' | 'properties' | 'businesses' | 'evidence';

export interface SpillmanRecordTab {
  id: RecordTabId;
  label: string;
  count: number;
}

interface Props {
  tabs: SpillmanRecordTab[];
  activeTab: RecordTabId;
  onSelect: (id: RecordTabId) => void;
}

const ICONS: Record<RecordTabId, React.ElementType> = {
  persons: UserCircle,
  vehicles: Car,
  properties: Building2,
  businesses: Briefcase,
  evidence: Package,
};

export default function SpillmanRecordTabs({ tabs, activeTab, onSelect }: Props) {
  return (
    <div className="spm-record-tabs" role="tablist" aria-label="Record type tabs">
      {tabs.map((tab) => {
        const Icon = ICONS[tab.id];
        const on = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(tab.id)}
            className={`spm-record-tab ${on ? 'on' : ''}`}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{tab.label}</span>
            <span className="spm-record-tab-count">({tab.count})</span>
          </button>
        );
      })}
    </div>
  );
}
