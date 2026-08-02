// ============================================================
// RMPG Flex — Click-anywhere identify for OSM overlays
// ============================================================
// PR #3260 shipped 57 OSM categories. Per-layer click binding alone means an
// operator must know which layer a feature belongs to before they can click it,
// and must hit that layer's exact pixels. This reports EVERYTHING under the
// cursor in one popup, grouped by layer.
//
// The pure grouping function is separated from the map wiring so the popup
// content is testable without a live Mapbox instance.
// ============================================================

import { useEffect, useRef } from 'react';
import { mapboxgl } from '../utils/mapboxLoader';
import {
  OSM_VECTOR_CONFIGS, osmInteractiveLayerIds, type VectorTileLayerConfig,
} from './useVectorTileLayers';

export interface OsmIdentifyRow { label: string; value: string }

export interface OsmIdentifyGroup {
  layerId: string;
  label: string;
  color: string;
  rows: OsmIdentifyRow[];
}

/** Minimal shape of the queried features we depend on — keeps this testable. */
interface IdentifiableFeature {
  layer?: { id?: string };
  properties?: Record<string, unknown> | null;
}

/** `vt-<configId>-<suffix>` -> `<configId>`. Returns null for non-OSM layers. */
function configIdFromLayerId(layerId: string): string | null {
  const m = /^vt-(.+)-(fill|outline|line|circle|label)$/.exec(layerId);
  return m ? m[1] : null;
}

/**
 * Group queried features by their originating OSM config, rendering each
 * config's declared detailProps as labelled rows. Several features from one
 * layer collapse into a single group — a click near a junction routinely hits
 * a dozen segments of the same road class, and listing each would bury the
 * other layers under the cursor.
 */
export function buildIdentifyGroups(
  features: IdentifiableFeature[],
  configsById: Map<string, VectorTileLayerConfig>,
): OsmIdentifyGroup[] {
  const out: OsmIdentifyGroup[] = [];
  const seen = new Set<string>();

  for (const f of features) {
    const layerId = f.layer?.id;
    if (!layerId) continue;
    const cfgId = configIdFromLayerId(layerId);
    if (!cfgId) continue;
    const cfg = configsById.get(cfgId);
    if (!cfg) continue;
    if (seen.has(cfg.id)) continue;
    seen.add(cfg.id);

    const props = f.properties || {};
    const rows: OsmIdentifyRow[] = [];

    const titleRaw = props[cfg.labelProp];
    if (titleRaw != null && String(titleRaw).trim() !== '') {
      rows.push({ label: 'Name', value: String(titleRaw) });
    }
    for (const d of cfg.detailProps) {
      const v = props[d.key];
      if (v === undefined || v === null || String(v).trim() === '') continue;
      rows.push({ label: d.label, value: String(v) });
    }

    out.push({ layerId, label: cfg.label, color: cfg.color, rows });
  }

  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderIdentifyHtml(groups: OsmIdentifyGroup[], isLight: boolean): string {
  const fg = isLight ? '#222222' : '#d4d4d4';
  const sub = isLight ? '#666666' : '#888888';
  const rule = isLight ? '#cccccc' : '#444444';

  let html = `<div style="font-family:'JetBrains Mono','Courier New',monospace;color:${fg};font-size:11px;min-width:180px;max-height:260px;overflow-y:auto;">`;
  for (const g of groups) {
    html += `<div style="margin-bottom:6px;">`;
    html += `<div style="font-weight:bold;font-size:11px;color:${g.color};border-bottom:1px solid ${rule};padding-bottom:2px;margin-bottom:3px;">${escapeHtml(g.label)}</div>`;
    if (g.rows.length === 0) {
      html += `<div style="font-size:9px;color:${sub};">no attributes mapped</div>`;
    }
    for (const r of g.rows) {
      html += `<div style="font-size:10px;color:${sub};"><span style="color:${fg};">${escapeHtml(r.label)}:</span> ${escapeHtml(r.value)}</div>`;
    }
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

interface UseOsmIdentifyOptions {
  map: mapboxgl.Map | null;
  popup: mapboxgl.Popup | null;
  /** Config ids currently toggled visible — only these are queried. */
  visibleIds: string[];
  isLight?: boolean;
}

export function useOsmIdentify({ map, popup, visibleIds, isLight = false }: UseOsmIdentifyOptions) {
  const visibleRef = useRef(visibleIds);
  useEffect(() => { visibleRef.current = visibleIds; }, [visibleIds]);
  const isLightRef = useRef(isLight);
  useEffect(() => { isLightRef.current = isLight; }, [isLight]);
  const popupRef = useRef(popup);
  useEffect(() => { popupRef.current = popup; }, [popup]);

  const configsById = useRef(new Map(OSM_VECTOR_CONFIGS.map((c) => [c.id, c])));

  useEffect(() => {
    if (!map) return;

    const onClick = (e: mapboxgl.MapMouseEvent) => {
      const pop = popupRef.current;
      if (!pop) return;

      const visible = new Set(visibleRef.current);
      if (visible.size === 0) return;

      // Only query layers that both exist in the style and are toggled on.
      // queryRenderedFeatures THROWS on an unknown layer id, which would break
      // every click after any style swap that dropped a layer.
      const layerIds: string[] = [];
      for (const cfg of OSM_VECTOR_CONFIGS) {
        if (!visible.has(cfg.id)) continue;
        for (const id of osmInteractiveLayerIds(cfg, isLightRef.current)) {
          if (map.getLayer(id)) layerIds.push(id);
        }
      }
      if (layerIds.length === 0) return;

      let features;
      try {
        features = map.queryRenderedFeatures(e.point, { layers: layerIds });
      } catch {
        return; // style mid-swap — next click retries
      }

      const groups = buildIdentifyGroups(features as unknown as IdentifiableFeature[], configsById.current);
      if (groups.length === 0) return;

      pop.setLngLat(e.lngLat).setHTML(renderIdentifyHtml(groups, isLightRef.current)).addTo(map);
    };

    map.on('click', onClick);
    return () => { map.off('click', onClick); };
  }, [map]);
}

export default useOsmIdentify;
