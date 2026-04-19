import { useState } from 'react';
import { Network } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';

export default function ConnectionsPage() {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="p-4 space-y-4 h-full flex flex-col">
      <PanelTitleBar title="CONNECTIONS ANALYST" icon={Network} />

      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Search for a person, vehicle, case, incident..."
          className="flex-1 bg-surface-raised border border-[#222222] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-[#d4a017] focus:outline-none"
          style={{ borderRadius: 2 }}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          aria-label="Seed search"
        />
      </div>

      <div
        data-testid="graph-canvas"
        className="flex-1 bg-surface-sunken border border-[#222222] flex items-center justify-center text-gray-500 text-sm"
        style={{ borderRadius: 2, minHeight: 400 }}
      >
        Seed a graph by searching above.
      </div>
    </div>
  );
}
