// ============================================================
// RMPG Flex — Feature Inspector panel
// ============================================================
// Identify results for RMPG's own overlays. Renders from the shared
// describeOsmFeature description, so this panel and the map's feature-click
// popup can never drift apart on field selection or unit conversion.
// ============================================================

import { MapPin, X } from 'lucide-react';
import IconButton from '../../../components/IconButton';
import { describeOsmFeature } from '../../../utils/osmFeatureDescription';
import { OSM_ICON_BY_CAT } from '../../../utils/osmIcons';
import { configIdFromLayerId, osmGroupAndCatFromLayerId } from '../../../utils/osmLayerLabels';
import { cadDetailRows } from '../utils/mapCadInspect';
import type { InspectedFeature, InspectionResult } from '../../../hooks/useMapFeatureInspect';
import { mergeOverride, type OsmOverride } from '../../../hooks/useOsmOverrides';

export interface FeatureInspectorPanelProps {
  result: InspectionResult;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onClose: () => void;
  onHoverFeature: (feature: InspectedFeature | null) => void;
  osmOverrides?: Map<string, OsmOverride>;
  onEditOsmFeature?: (info: {
    osmId: string; group: string; cat: string | null;
    categoryLabel: string; featureName: string; osmTags: Record<string, unknown>;
  }) => void;
}

/** The catalog icon for a feature's category. OSM_ICON_BY_CAT holds raw SVG
 *  strings built for map.addImage, not React nodes — safe to inject only
 *  because they are in-repo constants, never OSM-derived text. */
function CategoryIcon({ layerId }: { layerId: string }) {
  // .split('_').slice(2) assumes no catalog group name contains an underscore
  // (true of all 10 current groups). UGRC layers (utah_roads, utah_addresses)
  // don't carry a category segment at all, so this resolves to '' for them —
  // fall back to a neutral marker glyph rather than rendering nothing.
  const cat = (configIdFromLayerId(layerId) ?? '').split('_').slice(2).join('_');
  const svg = OSM_ICON_BY_CAT[cat]?.svg;
  if (!svg) {
    return <MapPin className="w-3.5 h-3.5 shrink-0 text-fg-muted" aria-hidden />;
  }
  return <span className="w-3.5 h-3.5 shrink-0" aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />;
}

function CadDetailRows({ feature }: { feature: InspectedFeature }) {
  const title = String(feature.properties.__cad_title ?? feature.categoryLabel);
  const rows = cadDetailRows(feature);
  return (
    <div className="px-2 py-2 space-y-2">
      <div>
        <div className="text-[12px] font-semibold text-rmpg-100">{title}</div>
        <div className="text-[8px] uppercase tracking-wider text-fg-muted">{feature.categoryLabel}</div>
      </div>
      {rows.length > 0 && (
        <div className="space-y-[1px]">
          {rows.map((r) => (
            <div key={r.key} className="flex gap-2 text-[10px] leading-[1.5]">
              <span className="w-24 shrink-0 text-[color:var(--field-label-color)]">{r.label}</span>
              <span className="text-rmpg-200">{r.value}</span>
            </div>
          ))}
        </div>
      )}
      <div className="text-[8px] text-fg-muted">Source: CAD</div>
    </div>
  );
}

function DetailRows({
  feature, osmOverrides, onEditOsmFeature,
}: {
  feature: InspectedFeature;
  osmOverrides?: Map<string, OsmOverride>;
  onEditOsmFeature?: FeatureInspectorPanelProps['onEditOsmFeature'];
}) {
  if (feature.kind === 'cad') return <CadDetailRows feature={feature} />;
  const osmId = String(feature.properties.osm_id ?? '').trim();
  const props = mergeOverride(feature.properties, osmOverrides?.get(osmId));
  const d = describeOsmFeature(props, {
    categoryLabel: feature.categoryLabel,
    groupLabel: feature.groupLabel ?? undefined,
    coverage: feature.coverage,
  });
  const parsed = osmGroupAndCatFromLayerId(feature.layerId);
  const canEdit = Boolean(onEditOsmFeature) && osmId !== '' && parsed;

  return (
    <div className="px-2 py-2 space-y-2">
      <div>
        <div className="text-[12px] font-semibold text-rmpg-100">{d.title}</div>
        <div className="text-[8px] uppercase tracking-wider text-fg-muted">{d.categoryLabel}</div>
      </div>

      {d.rows.length > 0 && (
        <div className="space-y-[1px]">
          {d.rows.map((r) => (
            <div key={r.key} className="flex gap-2 text-[10px] leading-[1.5]">
              <span className="w-24 shrink-0 text-[color:var(--field-label-color)]">{r.label}</span>
              <span className="text-rmpg-200">{r.value}</span>
            </div>
          ))}
        </div>
      )}

      {d.extras.length > 0 && (
        <div className="pt-1 border-t border-border-default space-y-[1px]">
          {d.extras.map((r) => (
            <div key={r.key} className="flex gap-2 text-[9px] leading-[1.45]">
              <span className="w-24 shrink-0 text-fg-muted">{r.label}</span>
              <span className="text-fg-muted">{r.value}</span>
            </div>
          ))}
        </div>
      )}

      {d.coverage && (
        <div className="pt-1 border-t border-border-default text-[8.5px] leading-[1.4] text-fg-muted">
          {d.coverage}
        </div>
      )}

      {(d.rmpg.verified || d.rmpg.note || d.rmpg.overriddenFields.length > 0) && (
        <div className="pt-1 border-t border-border-default space-y-[2px]">
          {/* The whole point of the edit layer: ground-truthed vs crowd-sourced. */}
          {d.rmpg.verified && (
            <div className="text-[9px] font-bold tracking-wide text-[color:var(--sev-ok)]">
              ✓ RMPG VERIFIED{d.rmpg.verifiedAt ? ` · ${d.rmpg.verifiedAt}` : ''}
            </div>
          )}
          {d.rmpg.note && <div className="text-[10px] leading-[1.45] text-rmpg-200">{d.rmpg.note}</div>}
          {d.rmpg.overriddenFields.length > 0 && (
            // Naming the corrected fields keeps RMPG's value from reading as OSM's.
            <div className="text-[8px] text-fg-muted">
              Corrected by RMPG: {d.rmpg.overriddenFields.join(', ')}
            </div>
          )}
        </div>
      )}

      <div className="text-[8px] text-fg-muted">
        Source: OpenStreetMap · extract {d.provenance.extractDate}
        {d.provenance.editedDate ? ` · edited ${d.provenance.editedDate}` : ''}
      </div>
      {d.osmLink && (
        <a href={d.osmLink.url} target="_blank" rel="noopener noreferrer"
           className="block text-[8px] text-brand-gold-400 hover:underline">
          {d.osmLink.id} on openstreetmap.org ↗
        </a>
      )}
      {canEdit && parsed && (
        <button
          type="button"
          className="w-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide"
          style={{ color: '#0a1422', background: 'var(--brand-gold)', borderRadius: 2 }}
          onClick={() => onEditOsmFeature?.({
            osmId,
            group: parsed.group,
            cat: parsed.cat,
            categoryLabel: feature.categoryLabel,
            featureName: String(feature.properties.name ?? ''),
            osmTags: feature.properties,
          })}
        >
          Edit / Verify
        </button>
      )}
    </div>
  );
}

export default function FeatureInspectorPanel({
  result, selectedIndex, onSelect, onClose, onHoverFeature, osmOverrides, onEditOsmFeature,
}: FeatureInspectorPanelProps) {
  const [lng, lat] = result.lngLat;
  const selected = result.features[selectedIndex];

  return (
    <div className="absolute bottom-4 right-4 z-30 w-[320px] max-h-[60%] flex flex-col
                    bg-surface-raised/95 border border-border-default backdrop-blur-sm overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border-default">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--panel-header-color)]">
          {result.features.length === 0
            ? 'Inspector'
            : `${result.features.length} feature${result.features.length === 1 ? '' : 's'}`}
        </div>
        <IconButton aria-label="Close feature inspector" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </IconButton>
      </div>

      <div className="px-2 py-1 text-[9px] text-fg-muted border-b border-border-default">
        {lng.toFixed(5)}, {lat.toFixed(5)}
        {result.widened && <span className="ml-1">· nearest nearby</span>}
      </div>

      {result.features.length === 0 ? (
        <div className="px-2 py-3 text-[10px] text-fg-secondary">
          No overlay or CAD features here. Turn on more overlays, or click closer to a unit, call, or mapped feature.
        </div>
      ) : (
        <div className="flex flex-col overflow-y-auto">
          {result.features.length > 1 && (
            <div className="border-b border-border-default">
              {result.features.map((f, i) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => onSelect(i)}
                  onMouseEnter={() => onHoverFeature(f)}
                  onMouseLeave={() => onHoverFeature(null)}
                  className={`w-full flex items-center gap-2 px-2 py-1 text-left text-[10px]
                    ${i === selectedIndex ? 'bg-surface-sunken text-rmpg-100' : 'text-fg-secondary'}`}
                >
                  <CategoryIcon layerId={f.layerId} />
                  <span className="truncate flex-1">
                    {String(f.properties.__cad_title ?? f.properties.name ?? '') || f.categoryLabel}
                  </span>
                  {f.awayLabel && <span className="text-[9px] text-fg-muted">{f.awayLabel}</span>}
                </button>
              ))}
            </div>
          )}
          {result.features.length === 1 && result.features[0].awayLabel && (
            <div className="px-2 pt-1 text-[9px] text-fg-muted">{result.features[0].awayLabel}</div>
          )}
          {selected && (
            <DetailRows
              feature={selected}
              osmOverrides={osmOverrides}
              onEditOsmFeature={onEditOsmFeature}
            />
          )}
        </div>
      )}
    </div>
  );
}
