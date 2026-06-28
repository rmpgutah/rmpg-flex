import { useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { useFeatureFlags, type FeatureFlags } from '../context/FeatureFlagsContext';

export interface MapTool {
  id: string;
  icon: string;
  label: string;
  flag: keyof FeatureFlags | null;
  component: React.ComponentType<{ map: mapboxgl.Map; onClose: () => void }>;
}

interface Props {
  map: mapboxgl.Map | null;
  tools: MapTool[];
}

export default function MapToolbar({ map, tools }: Props) {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const flags = useFeatureFlags();

  if (!map) return null;

  const visible = tools.filter(t => t.flag === null || flags[t.flag]);
  const active = visible.find(t => t.id === activeTool);
  const toggle = (id: string) => setActiveTool(prev => prev === id ? null : id);

  return (
    <div className="absolute left-3 top-1/2 -translate-y-1/2 z-50 flex items-start gap-2 pointer-events-none">
      <div className="tactical-dark flex flex-col gap-1 p-1.5 rounded border border-surface-raised pointer-events-auto">
        {visible.map(tool => (
          <button
            key={tool.id}
            aria-label={tool.label}
            title={tool.label}
            onClick={() => toggle(tool.id)}
            className={`w-7 h-7 flex items-center justify-center rounded text-sm transition-colors ${
              activeTool === tool.id
                ? 'bg-brand-500 text-black'
                : 'bg-surface-raised text-rmpg-300 hover:bg-rmpg-700'
            }`}
          >
            {tool.icon}
          </button>
        ))}
      </div>
      {active && (
        <div className="pointer-events-auto">
          <active.component map={map} onClose={() => setActiveTool(null)} />
        </div>
      )}
    </div>
  );
}
