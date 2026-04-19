import { Layers, Eye, EyeOff, PanelLeftOpen, PanelLeftClose } from 'lucide-react';
import { useState } from 'react';

/** Segmented control descriptor — renders as a row of small buttons
 *  beneath a layer toggle when the layer is visible. */
export interface SegmentedControl<T extends string | number = string | number> {
  kind: 'segmented';
  /** Tiny uppercase prefix label (e.g. "DAYS", "MODE") */
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}

export type LayerControl = SegmentedControl;

export interface LayerToggleConfig {
  key: string;
  label: string;
  color: string;
  visible: boolean;
  onToggle: () => void;
  count?: number;
  /** Optional inline controls — rendered when layer is visible */
  controls?: LayerControl[];
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
  const [search, setSearch] = useState('');

  // Filter sections by search query (matches against layer label)
  const filteredSections = !search.trim() ? sections : sections
    .map((sec) => ({
      ...sec,
      layers: sec.layers.filter((l) => l.label.toLowerCase().includes(search.toLowerCase())),
    }))
    .filter((sec) => sec.layers.length > 0);

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

      {/* Search bar */}
      <div className="px-2 py-1 bg-[#0d0d0d] border-b border-[#1a1a1a]">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter layers…"
          aria-label="Filter layers by name"
          className="w-full bg-[#141414] border border-[#222222] outline-none px-1.5 py-0.5 text-[#e5e7eb] placeholder:text-[#666666] font-mono text-[10px] normal-case"
        />
      </div>

      {/* Sections */}
      <div className="divide-y divide-[#1a1a1a] max-h-[70vh] overflow-y-auto">
        {filteredSections.length === 0 && search.trim() && (
          <div className="px-2 py-2 text-[#666666] text-[9px]">No layers match</div>
        )}
        {filteredSections.map((sec) => {
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
                <div key={l.key}>
                  <button
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
                  {/* Inline controls — only when layer is visible */}
                  {l.visible && l.controls && l.controls.length > 0 && (
                    <div className="bg-[#0d0d0d] border-t border-[#1a1a1a] px-2 py-1 space-y-1">
                      {l.controls.map((c, ci) => (
                        <div key={ci} className="flex items-center gap-1.5">
                          <span className="text-[7px] font-bold text-[#666666] w-8 flex-shrink-0">
                            {c.label}
                          </span>
                          <div className="flex flex-wrap gap-0.5 flex-1">
                            {c.options.map((opt) => {
                              const active = opt.value === c.value;
                              return (
                                <button
                                  key={String(opt.value)}
                                  type="button"
                                  onClick={() => c.onChange(opt.value)}
                                  aria-pressed={active}
                                  aria-label={`${c.label} ${opt.label}`}
                                  className={
                                    'px-1 py-0 text-[8px] font-bold font-mono ' +
                                    (active
                                      ? 'bg-[#1a1a1a] text-[#d4a017] border border-[#d4a01755]'
                                      : 'text-[#888888] hover:text-[#e5e7eb] border border-transparent')
                                  }
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
