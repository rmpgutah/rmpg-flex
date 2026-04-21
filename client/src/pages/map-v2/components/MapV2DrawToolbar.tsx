import { Ruler, Pencil, Crosshair, Trash2, X } from 'lucide-react';
import type { DrawMode } from '../hooks/useOlDrawTool';

interface MapV2DrawToolbarProps {
  mode: DrawMode;
  setMode: (m: DrawMode) => void;
  onClear: () => void;
}

const TOOLS: { key: Exclude<DrawMode, null>; label: string; icon: typeof Ruler; hint: string }[] = [
  { key: 'measure', label: 'Measure', icon: Ruler, hint: 'Distance between points' },
  { key: 'perimeter', label: 'Perimeter', icon: Pencil, hint: 'Polygon area' },
  { key: 'radius', label: 'Radius', icon: Crosshair, hint: 'Circle radius' },
];

/**
 * Floating drawing toolbar for /map-v2 — bottom-left, Spillman dark.
 * Single-active mode (clicking the active tool exits drawing). Trash
 * icon clears all drawn shapes on the layer.
 */
export default function MapV2DrawToolbar({ mode, setMode, onClear }: MapV2DrawToolbarProps) {
  return (
    <div className="absolute bottom-8 left-2 z-20 flex items-center bg-[#141414] border border-[#222222] font-mono text-[10px] uppercase tracking-wider select-none">
      {TOOLS.map(({ key, label, icon: Icon, hint }) => {
        const active = mode === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => setMode(active ? null : key)}
            title={hint}
            aria-label={active ? `Exit ${label} tool` : `${label} tool`}
            aria-pressed={active}
            className={
              'flex items-center gap-1.5 px-2 py-1.5 border-r border-[#1a1a1a] hover:bg-[#1a1a1a] ' +
              (active ? 'bg-[#1a1a1a] text-[#d4a017]' : 'text-[#9ca3af]')
            }
          >
            <Icon className="w-3 h-3" aria-hidden="true" />
            {label}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear all drawings"
        title="Clear all drawn shapes"
        className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-[#1a1a1a] text-[#9ca3af]"
      >
        <Trash2 className="w-3 h-3" aria-hidden="true" />
      </button>
      {mode && (
        <button
          type="button"
          onClick={() => setMode(null)}
          aria-label="Exit drawing"
          title="Exit drawing (Esc)"
          className="flex items-center gap-1.5 px-2 py-1.5 border-l border-[#1a1a1a] hover:bg-[#1a1a1a] text-[#888888]"
        >
          <X className="w-3 h-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
