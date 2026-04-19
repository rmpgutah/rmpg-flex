import { Layers, Eye, EyeOff, PanelLeftOpen, PanelLeftClose } from 'lucide-react';
import { useState } from 'react';

export interface LayerToggleConfig {
  key: string;
  label: string;
  color: string;
  visible: boolean;
  onToggle: () => void;
  count?: number;
}

export interface LayerSection {
  /** Stable id, used for keys */
  id: string;
  /** Section header label, displayed in tiny uppercase */
  title: string;
  layers: LayerToggleConfig[];
}

interface MapV2LayersPanelProps {
  sections: LayerSection[];
  /** Optional WS connectivity LED in the header (green/red) */
  isConnected?: boolean;
}

/**
 * Spillman-style layers sidebar for /map-v2 — left edge, collapsible
 * via PanelLeftOpen/Close buttons, sectioned with per-section ON/OFF
 * mass toggles. Mirrors the v1 MapLayersPanel structure (sections +
 * tiny uppercase headers + connection LED) so dispatchers' existing
 * muscle memory transfers from /map.
 *
 * Per-tool config controls (heatmap mode picker, breadcrumb playback,
 * day-range pickers, etc.) land in subsequent PRs that thread the
 * appropriate state through the panel — this PR establishes the
 * sectioned layout chrome.
 */
export default function MapV2LayersPanel({ sections, isConnected }: MapV2LayersPanelProps) {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Show layers"
        aria-label="Show layers panel"
        className="absolute top-2 left-2 z-20 p-1.5 bg-[#141414] border border-[#222222] hover:bg-[#1a1a1a] text-[#d4a017]"
      >
        <PanelLeftOpen className="w-4 h-4" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div
      className="absolute top-2 left-2 z-20 bg-[#0a0a0a] border border-[#222222] font-mono text-[10px] uppercase tracking-wider select-none shadow-lg"
      style={{ width: 'clamp(180px, 16vw, 220px)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[#222222]">
        <Layers className="w-3.5 h-3.5 text-[#d4a017]" aria-hidden="true" />
        <span className="flex-1 text-[10px] font-bold text-[#e5e7eb]">Layers</span>
        {typeof isConnected === 'boolean' && (
          <div
            className={
              'w-1.5 h-1.5 rounded-full ' +
              (isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-500')
            }
            title={isConnected ? 'Connected' : 'Disconnected'}
            aria-label={isConnected ? 'Connected' : 'Disconnected'}
          />
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          title="Hide layers"
          aria-label="Hide layers panel"
          className="p-0.5 hover:bg-[#1a1a1a] text-[#888888]"
        >
          <PanelLeftClose className="w-3 h-3" aria-hidden="true" />
        </button>
      </div>

      {/* Sections */}
      <div className="divide-y divide-[#1a1a1a]">
        {sections.map((sec) => {
          const allOn = sec.layers.every((l) => l.visible);
          const anyOn = sec.layers.some((l) => l.visible);
          const massToggle = (target: boolean) => {
            for (const l of sec.layers) if (l.visible !== target) l.onToggle();
          };
          return (
            <div key={sec.id}>
              {/* Section header with ON/OFF mass toggle */}
              <div className="flex items-center justify-between px-2 py-1 bg-[#0d0d0d]">
                <span className="text-[8px] font-bold text-[#666666]">{sec.title}</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => massToggle(true)}
                    aria-label={`Enable all ${sec.title}`}
                    className={
                      'text-[7px] font-bold px-1 ' +
                      (allOn ? 'text-green-300' : 'text-green-400 hover:text-green-300')
                    }
                  >
                    ON
                  </button>
                  <button
                    type="button"
                    onClick={() => massToggle(false)}
                    aria-label={`Disable all ${sec.title}`}
                    className={
                      'text-[7px] font-bold px-1 ' +
                      (!anyOn ? 'text-red-300' : 'text-red-400 hover:text-red-300')
                    }
                  >
                    OFF
                  </button>
                </div>
              </div>
              {/* Layers in this section */}
              {sec.layers.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  onClick={l.onToggle}
                  aria-label={`Toggle ${l.label} layer`}
                  className="w-full flex items-center gap-2 px-2 py-1 hover:bg-[#1a1a1a] text-left"
                >
                  {l.visible ? (
                    <Eye className="w-3 h-3 text-[#d4a017]" aria-hidden="true" />
                  ) : (
                    <EyeOff className="w-3 h-3 text-[#666666]" aria-hidden="true" />
                  )}
                  <span
                    className="w-2 h-2 inline-block flex-shrink-0"
                    style={{ background: l.color }}
                    aria-hidden="true"
                  />
                  <span className={'flex-1 truncate ' + (l.visible ? 'text-[#e5e7eb]' : 'text-[#666666]')}>
                    {l.label}
                  </span>
                  {typeof l.count === 'number' && (
                    <span className="text-[#666666] tabular-nums text-[9px]">{l.count}</span>
                  )}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
