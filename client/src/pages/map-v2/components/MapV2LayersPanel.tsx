import { Layers, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

export interface LayerToggleConfig {
  key: string;
  label: string;
  color: string;
  visible: boolean;
  onToggle: () => void;
  count?: number;
}

interface MapV2LayersPanelProps {
  layers: LayerToggleConfig[];
}

/**
 * Compact layers panel for /map-v2 — top-right floating chrome,
 * Spillman dark theme, click to toggle layer visibility.
 *
 * V2-scope: only GeoJSON overlay toggles for now (county, highway,
 * municipality, places, beats). Heatmap, tracking lines, and the
 * other 30+ controls from the v1 panel arrive in subsequent PRs.
 */
export default function MapV2LayersPanel({ layers }: MapV2LayersPanelProps) {
  const [open, setOpen] = useState(true);

  return (
    <div className="absolute top-2 right-2 z-20 font-mono text-[10px] uppercase tracking-wider select-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Collapse layers panel' : 'Expand layers panel'}
        className="flex items-center gap-1.5 px-2 py-1 bg-[#141414] border border-[#222222] text-[#d4a017] hover:bg-[#1a1a1a]"
      >
        <Layers className="w-3 h-3" aria-hidden="true" />
        Layers
      </button>
      {open && (
        <div className="mt-1 bg-[#141414] border border-[#222222] divide-y divide-[#1a1a1a]">
          {layers.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={l.onToggle}
              aria-label={`Toggle ${l.label} layer`}
              className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-[#1a1a1a] text-left"
            >
              {l.visible ? (
                <Eye className="w-3 h-3 text-[#d4a017]" aria-hidden="true" />
              ) : (
                <EyeOff className="w-3 h-3 text-[#666666]" aria-hidden="true" />
              )}
              <span
                className="w-2 h-2 inline-block"
                style={{ background: l.color }}
                aria-hidden="true"
              />
              <span className={l.visible ? 'text-[#e5e7eb]' : 'text-[#666666]'}>
                {l.label}
              </span>
              {typeof l.count === 'number' && (
                <span className="ml-auto text-[#666666] tabular-nums">{l.count}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
