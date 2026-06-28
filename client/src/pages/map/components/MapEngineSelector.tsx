// ============================================================
// RMPG Flex — Map Engine Selector Component
// ============================================================
// Dropdown in the map toolbar that lets users switch between
// available map engines (Mapbox GL, MapLibre GL).
// Only shows engines that have configured tokens.
// ============================================================

import { Map, ChevronDown, Check } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { MAP_ENGINE_LABELS, MAP_ENGINE_DESCRIPTIONS, type MapEngine } from '../../../utils/mapProvider';

interface MapEngineSelectorProps {
  currentEngine: MapEngine | null;
  availableEngines: MapEngine[];
  onSwitch: (engine: MapEngine) => void;
  disabled?: boolean;
}

const ENGINE_ICONS: Record<MapEngine, string> = {
  mapbox: '◆',
  maplibre: '◇',
};

export default function MapEngineSelector({
  currentEngine,
  availableEngines,
  onSwitch,
  disabled,
}: MapEngineSelectorProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!currentEngine || availableEngines.length <= 1) {
    // Single engine — show label only, no dropdown
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-[#888] select-none">
        <Map className="w-3 h-3" />
        <span>{currentEngine ? MAP_ENGINE_LABELS[currentEngine] : 'Detecting…'}</span>
      </div>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-[#ccc] bg-[#141414] border border-[#222] rounded-sm hover:bg-[#1a1a1a] hover:border-[#333] transition-colors disabled:opacity-50"
        title="Switch map engine"
      >
        <Map className="w-3 h-3 text-[#d4a017]" />
        <span>{MAP_ENGINE_LABELS[currentEngine]}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-[#141414] border border-[#222] rounded-sm shadow-lg z-[9999] overflow-hidden">
          {availableEngines.map((eng) => (
            <button
              key={eng}
              type="button"
              onClick={() => {
                onSwitch(eng);
                setOpen(false);
              }}
              className={`w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-[#1a1a1a] transition-colors ${
                eng === currentEngine ? 'bg-[#1a1a1a]' : ''
              }`}
            >
              <span className="text-sm mt-0.5 text-[#d4a017] font-mono">{ENGINE_ICONS[eng]}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-[#e0e0e0]">
                    {MAP_ENGINE_LABELS[eng]}
                  </span>
                  {eng === currentEngine && (
                    <Check className="w-3 h-3 text-[#d4a017]" />
                  )}
                </div>
                <div className="text-[9px] text-[#666] leading-tight mt-0.5">
                  {MAP_ENGINE_DESCRIPTIONS[eng]}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
