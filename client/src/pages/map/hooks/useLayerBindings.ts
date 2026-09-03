// ============================================================
// RMPG Flex — Layer Bindings
// Joins the declarative layer registry (presentation) to the page's
// live state (behavior) and emits the DockToggleItem[] the existing
// dock renderers already consume.
//
// buildDockSections is a PURE function on purpose: it lets the
// registry-completeness property be tested without mounting the
// 1,893-line MapboxMapPage.
// ============================================================

import type { DockToggleItem } from '../components/DockSection';
import {
  LAYER_BY_ID, MAP_LAYER_REGISTRY, type MapLayerGroup,
} from '../config/layerRegistry';

export interface LayerBinding {
  active: boolean;
  onToggle: () => void;
  loading?: boolean;
  error?: string | null;
  /** Overrides the registry label for layers that interpolate live state
   *  (heatmap mode, projection, atmosphere preset). */
  label?: string;
  /** Overrides the registry description for layers whose helper text depends
   *  on live state (e.g. the GPU overlay explaining that it needs a Mercator
   *  or Globe projection). */
  description?: string;
}

export type LayerBindingMap = Record<string, LayerBinding>;

export interface DockSectionData {
  title: MapLayerGroup;
  items: DockToggleItem[];
  collapsible?: boolean;
  /** OSM groups start collapsed — 9 groups of ~56 toggles is a scroll wall. */
  defaultOpen?: boolean;
  onEnableAll?: () => void;
  onDisableAll?: () => void;
}

/** Safety-critical toggles must never hide inside a collapsed section. */
const NON_COLLAPSIBLE_GROUPS: ReadonlySet<MapLayerGroup> = new Set<MapLayerGroup>([
  'Live Conditions',
]);

export function buildDockSections(
  groups: MapLayerGroup[],
  bindings: LayerBindingMap,
  favorites?: { ids: ReadonlySet<string>; onToggle: (id: string) => void },
): DockSectionData[] {
  return groups.map((group) => {
    const items = MAP_LAYER_REGISTRY
      .filter((layer) => layer.group === group && bindings[layer.id] !== undefined)
      .map((layer): DockToggleItem => {
        const binding = bindings[layer.id];
        return {
          id: layer.id,
          label: binding.label ?? layer.label,
          icon: layer.icon,
          color: layer.colorVar,
          description: binding.description ?? layer.description,
          pinned: layer.pinned,
          active: binding.active,
          onToggle: binding.onToggle,
          loading: binding.loading,
          error: binding.error,
          favorite: favorites?.ids.has(layer.id),
          onToggleFavorite: favorites ? () => favorites.onToggle(layer.id) : undefined,
        };
      });
    const osm = group.startsWith('OSM');
    const bulk = osm || group === 'Administrative Boundaries';
    return {
      title: group,
      collapsible: NON_COLLAPSIBLE_GROUPS.has(group) ? false : undefined,
      defaultOpen: osm ? false : undefined,
      onEnableAll: bulk && items.length
        ? () => { for (const i of items) if (!i.active) i.onToggle(); }
        : undefined,
      onDisableAll: bulk && items.length
        ? () => { for (const i of items) if (i.active) i.onToggle(); }
        : undefined,
      items,
    };
  });
}

/**
 * Development guard against the one way this refactor can fail silently:
 * a layer that exists in the registry but was never wired up (renders
 * nothing), or a binding whose id was typo'd (renders nothing, no error).
 */
export function findUnboundLayers(bindings: LayerBindingMap): {
  missingBinding: string[];
  unknownBinding: string[];
} {
  const missingBinding = MAP_LAYER_REGISTRY
    .filter((l) => bindings[l.id] === undefined)
    .map((l) => l.id);
  const unknownBinding = Object.keys(bindings).filter((id) => !LAYER_BY_ID.has(id));
  return { missingBinding, unknownBinding };
}
