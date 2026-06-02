// ============================================================
// RMPG Flex — Unified Map Legend
// ============================================================
// One always-visible, collapsible legend that reflects EVERY active
// overlay (police-geography coverage, civic boundary outlines, statewide
// roads/addresses, the activity choropleth) instead of the scattered
// per-section mini-legends. Docked bottom-left of the map.
// ============================================================

import React, { useState } from 'react';
import { List, ChevronDown, ChevronUp } from 'lucide-react';
import type { ChoroLegend } from '../../../hooks/useActivityChoropleth';

export interface UnifiedLegendProps {
  hierarchy: { area: boolean; section: boolean; zone: boolean; beat: boolean };
  boundaries: { county: boolean; municipality: boolean };
  statewide: { roads: boolean; addresses: boolean };
  choro: ChoroLegend | null;
  /** Categorical color list for the active Area/Section level (compact). */
  categorical: { label: string; color: string }[];
  isLight: boolean;
  /** Distance from the map bottom (px) — raised when the nav banner is shown. */
  bottomPx?: number;
  /** CSS left offset — shifts right of the LAYERS panel when it's open. */
  leftCss?: string;
}

const HSWATCH: Record<string, string> = { area: '#d4a017', section: '#f59e0b', zone: '#22c55e', beat: '#4ade80' };

const Swatch = ({ color, line, dot }: { color: string; line?: boolean; dot?: boolean }) => (
  <span
    className="inline-block shrink-0"
    style={{
      width: 12,
      height: dot ? 12 : line ? 0 : 12,
      borderRadius: dot ? 6 : 2,
      background: line ? 'transparent' : color,
      borderTop: line ? `2px solid ${color}` : undefined,
      border: dot ? '1px solid #1a1a1a' : undefined,
    }}
  />
);

export default function UnifiedMapLegend({ hierarchy, boundaries, statewide, choro, categorical, isLight, bottomPx = 28, leftCss = '12px' }: UnifiedLegendProps) {
  const [open, setOpen] = useState(true);

  const geoLevels = ([
    ['area', 'Area'], ['section', 'Section'], ['zone', 'Zone'], ['beat', 'Beat'],
  ] as const).filter(([k]) => hierarchy[k]);

  const anyActive = geoLevels.length > 0 || boundaries.county || boundaries.municipality
    || statewide.roads || statewide.addresses || !!choro;
  if (!anyActive) return null;

  const bg = isLight ? 'rgba(255,255,255,0.92)' : 'rgba(10,10,10,0.94)';
  const fg = isLight ? '#222' : '#cfcfcf';
  const sub = isLight ? '#666' : '#888';

  return (
    <div
      className="absolute z-[900] backdrop-blur-md"
      style={{ bottom: bottomPx, left: leftCss, minWidth: 150, maxWidth: 220, background: bg, border: '1px solid #88888840', borderRadius: 2, fontFamily: "'JetBrains Mono','Courier New',monospace" }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1"
        style={{ color: '#d4a017', fontSize: 9, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase' }}
        aria-expanded={open}
      >
        <List className="w-3 h-3" /> Legend
        <span className="ml-auto">{open ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}</span>
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-1.5" style={{ maxHeight: '40vh', overflowY: 'auto' }}>
          {/* Police geography coverage */}
          {geoLevels.length > 0 && (
            <div>
              <div style={{ color: sub, fontSize: 7, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>Geography Coverage</div>
              {geoLevels.map(([k, label]) => (
                <div key={k} className="flex items-center gap-1.5" style={{ marginTop: 1 }}>
                  <Swatch color={HSWATCH[k]} />
                  <span style={{ fontSize: 9, color: fg }}>{label}</span>
                  <span style={{ fontSize: 8, color: sub }}>colored by {label.toLowerCase()}</span>
                </div>
              ))}
              {/* Compact categorical key for Area/Section (few values). */}
              {categorical.length > 0 && categorical.length <= 16 && (
                <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
                  {categorical.map((c) => (
                    <div key={c.label} className="flex items-center gap-1 min-w-0">
                      <Swatch color={c.color} />
                      <span style={{ fontSize: 8, color: fg }} className="truncate">{c.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Civic boundaries (outline only) */}
          {(boundaries.county || boundaries.municipality) && (
            <div>
              <div style={{ color: sub, fontSize: 7, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>Boundaries</div>
              {boundaries.county && (
                <div className="flex items-center gap-1.5"><Swatch color="#9a9a9a" line /><span style={{ fontSize: 9, color: fg }}>County</span></div>
              )}
              {boundaries.municipality && (
                <div className="flex items-center gap-1.5"><Swatch color="#c9c9c9" line /><span style={{ fontSize: 9, color: fg }}>Municipality</span></div>
              )}
            </div>
          )}

          {/* Statewide data */}
          {(statewide.roads || statewide.addresses) && (
            <div>
              <div style={{ color: sub, fontSize: 7, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>Statewide</div>
              {statewide.roads && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {[['Interstate', '#ef4444'], ['US Hwy', '#f59e0b'], ['State', '#e8b84b'], ['Local', '#d4a017']].map(([l, col]) => (
                    <span key={l} className="flex items-center gap-1"><Swatch color={col} line /><span style={{ fontSize: 8, color: fg }}>{l}</span></span>
                  ))}
                </div>
              )}
              {statewide.addresses && (
                <div className="mt-1">
                  <div style={{ fontSize: 7, color: sub, marginBottom: 1 }}>Address points by type</div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {[['Residential', '#22c55e'], ['Commercial', '#f59e0b'], ['Industrial', '#ef4444'], ['Agricultural', '#84cc16'], ['Mixed', '#14b8a6'], ['Other', '#e8b84b']].map(([l, col]) => (
                      <span key={l} className="flex items-center gap-1"><Swatch color={col} dot /><span style={{ fontSize: 8, color: fg }}>{l}</span></span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Activity choropleth ramp */}
          {choro && (
            <div>
              <div style={{ color: sub, fontSize: 7, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>
                Call Activity · {choro.level}
              </div>
              <div className="flex items-center gap-1">
                <span style={{ fontSize: 8, color: sub }}>low</span>
                {choro.colors.slice(1).map((c, i) => (
                  <div key={i} className="h-2 flex-1" style={{ background: c, borderRadius: 1 }} />
                ))}
                <span style={{ fontSize: 8, color: sub }}>{choro.max}+</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
