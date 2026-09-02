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
import { roadLegendRows, propertyLegendRows } from '../utils/landTypes';
import OsmAttribution from '../../../components/OsmAttribution';
import { iconSvgForCat } from '../../../utils/osmIcons';
import type { VectorTileLayerConfig } from '../../../hooks/useVectorTileLayers';

export interface UnifiedLegendProps {
  hierarchy: { area: boolean; sector: boolean; zone: boolean; beat: boolean };
  boundaries: { county: boolean; municipality: boolean };
  statewide: { roads: boolean; addresses: boolean };
  choro: ChoroLegend | null;
  /** Categorical color list for the active Area/Sector level (compact). */
  categorical: { label: string; color: string }[];
  isLight: boolean;
  /** Distance from the map bottom (px) — raised when the nav banner is shown. */
  bottomPx?: number;
  /** CSS left offset — shifts right of the LAYERS panel when it's open. */
  leftCss?: string;
  /** Currently-visible OSM-sourced vector layer configs, for ODbL attribution + coverage captions. */
  visibleOsmConfigs?: VectorTileLayerConfig[];
}

const HSWATCH: Record<string, string> = { area: '#d4a017', sector: '#f59e0b', zone: '#22c55e', beat: '#4ade80' };

const Swatch = ({ color, line, dot }: { color: string; line?: boolean; dot?: boolean }) => (
  <span
    className="inline-block shrink-0"
    style={{
      width: 12,
      height: dot ? 12 : line ? 0 : 12,
      borderRadius: dot ? 6 : 2,
      background: line ? 'transparent' : color,
      borderTop: line ? `2px solid ${color}` : undefined,
      border: dot ? '1px solid var(--border-subtle)' : undefined,
    }}
  />
);

/**
 * Glyph key for the OSM point overlays that are actually switched on.
 *
 * There was previously no key anywhere in the app: 39 distinct silhouettes
 * shipped to the map with nothing telling an operator what any of them meant.
 * Scoped to visible layers on purpose — a key listing all 39 regardless of
 * what is on screen is a wall of icons nobody reads.
 *
 * Rendered as a data-URI <img> rather than injected markup. The strings are
 * our own module-local artwork, but an <img> cannot execute script under any
 * circumstances, so the key stays inert even if the artwork module ever grows
 * a templated value. It is also the same string that gets rasterised into the
 * map, so the key cannot drift from the sprite it documents.
 */
function OsmIconKey({ visibleOsmConfigs, sub }: { visibleOsmConfigs: VectorTileLayerConfig[]; sub: string }) {
  const rows = visibleOsmConfigs
    .filter((c) => c.categoryRender === 'point' && c.categoryFilter)
    .map((c) => ({ label: c.label, svg: iconSvgForCat(c.categoryFilter as string) }))
    .filter((r): r is { label: string; svg: string } => !!r.svg);
  if (rows.length === 0) return null;

  return (
    <div>
      <div style={{ color: sub, fontSize: 7, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>
        OSM Features
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-[3px]">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-1">
            <img
              alt=""
              aria-hidden="true"
              className="shrink-0"
              width={16}
              height={16}
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.svg)}`}
            />
            <span style={{ fontSize: 8.5, color: sub, lineHeight: 1.15 }}>{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function UnifiedMapLegend({ hierarchy, boundaries, statewide, choro, categorical, isLight, bottomPx = 28, leftCss = '12px', visibleOsmConfigs = [] }: UnifiedLegendProps) {
  const [open, setOpen] = useState(true);

  const geoLevels = ([
    ['area', 'Area'], ['sector', 'Sector'], ['zone', 'Zone'], ['beat', 'Beat'],
  ] as const).filter(([k]) => hierarchy[k]);

  const anyActive = geoLevels.length > 0 || boundaries.county || boundaries.municipality
    || statewide.roads || statewide.addresses || !!choro || visibleOsmConfigs.length > 0;
  if (!anyActive) return null;

  const bg = isLight ? 'rgba(255,255,255,0.92)' : 'rgba(10,10,10,0.94)';
  const fg = isLight ? '#222' : 'var(--text-secondary)';
  const sub = isLight ? '#666' : 'var(--text-muted)';

  return (
    <div
      className="absolute z-40 backdrop-blur-md"
      style={{ bottom: bottomPx, left: leftCss, minWidth: 150, maxWidth: 220, background: bg, border: '1px solid var(--border-subtle)', borderRadius: 2, fontFamily: "'Arial','sans-serif'" }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1"
        style={{ color: 'var(--panel-header-color)', fontSize: 9, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase' }}
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
              {/* Compact categorical key for Area/Sector (few values). */}
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
                  {/* Driven from the shared ROAD_CLASSES taxonomy so the legend
                      always matches the rendered road colors. */}
                  {roadLegendRows().map(({ label, color }) => (
                    <span key={label} className="flex items-center gap-1"><Swatch color={color} line /><span style={{ fontSize: 8, color: fg }}>{label}</span></span>
                  ))}
                </div>
              )}
              {statewide.addresses && (
                <div className="mt-1">
                  <div style={{ fontSize: 7, color: sub, marginBottom: 1 }}>Building / property type</div>
                  {/* Full property taxonomy (same source as the map dots). */}
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                    {propertyLegendRows().map(({ code, label, color }) => (
                      <span key={code} className="flex items-center gap-1 min-w-0" title={`${code} · ${label}`}>
                        <Swatch color={color} dot /><span style={{ fontSize: 8, color: fg }} className="truncate">{label}</span>
                      </span>
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

          <OsmIconKey visibleOsmConfigs={visibleOsmConfigs} sub={sub} />

          <OsmAttribution visibleOsmConfigs={visibleOsmConfigs} />
        </div>
      )}
    </div>
  );
}
