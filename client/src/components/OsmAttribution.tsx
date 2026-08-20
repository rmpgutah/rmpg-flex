// ============================================================
// RMPG Flex — OSM Attribution & Coverage Captions
// ============================================================
// ODbL requires attribution whenever OpenStreetMap-derived data is
// rendered. Separately — and more importantly for an authoritative
// law-enforcement records system — crowd-sourced coverage is never
// complete, so every visible OSM layer must carry a coverage caveat:
// absence of a feature must read as "not mapped in OpenStreetMap",
// never "none exist." Pure presentational component: a plain function
// of its props, no hooks, so it is trivially unit-testable.
// ============================================================

import React from 'react';
import type { VectorTileLayerConfig } from '../hooks/useVectorTileLayers';

export interface OsmAttributionProps {
  /** Currently-visible OSM-sourced layer configs (source === 'osm'). */
  visibleOsmConfigs: VectorTileLayerConfig[];
}

export default function OsmAttribution({ visibleOsmConfigs }: OsmAttributionProps) {
  if (visibleOsmConfigs.length === 0) return null;

  const attribution = visibleOsmConfigs[0].attribution;

  // Dedupe coverage captions — one visible caption per distinct class,
  // no matter how many layers share it.
  const captions: string[] = [];
  const seen = new Set<string>();
  for (const cfg of visibleOsmConfigs) {
    if (cfg.coverage && !seen.has(cfg.coverage)) {
      seen.add(cfg.coverage);
      captions.push(cfg.coverage);
    }
  }

  return (
    <div className="mt-1.5 space-y-0.5 border-t border-surface-hover pt-1">
      <div className="text-[8px] leading-tight text-fg-muted">{attribution}</div>
      {captions.map((caption) => (
        <div key={caption} className="text-[8px] leading-tight text-fg-secondary">
          {caption}
        </div>
      ))}
    </div>
  );
}
