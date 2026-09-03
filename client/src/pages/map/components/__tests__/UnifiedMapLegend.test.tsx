import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import UnifiedMapLegend from '../UnifiedMapLegend';
import type { VectorTileLayerConfig } from '../../../../hooks/useVectorTileLayers';

const base = {
  hierarchy: { area: false, sector: false, zone: false, beat: false },
  boundaries: { county: false, municipality: false },
  choro: null,
  categorical: [] as { label: string; color: string }[],
  isLight: false,
};

function osmCfg(partial: Partial<VectorTileLayerConfig> & Pick<VectorTileLayerConfig, 'id' | 'label' | 'categoryRender'>): VectorTileLayerConfig {
  return {
    description: partial.label,
    name: 'osm-x',
    sourceLayer: 'x',
    sourceMinzoom: 10,
    sourceMaxzoom: 16,
    kind: 'icon',
    minzoom: 14,
    color: '#38bdf8',
    labelProp: 'name',
    detailProps: [],
    defaultVisible: false,
    source: 'osm',
    attribution: '© OpenStreetMap',
    categoryFilter: partial.id.split('_').pop(),
    ...partial,
  };
}

describe('UnifiedMapLegend', () => {
  it('shows statewide road classes when UGRC roads are on', () => {
    render(<UnifiedMapLegend {...base} statewide={{ roads: true, addresses: false }} />);
    expect(screen.getByText('Statewide')).toBeInTheDocument();
    expect(screen.getByText('Interstate')).toBeInTheDocument();
  });

  it('keys OSM points, dashed lines, and camera cones separately', () => {
    render(
      <UnifiedMapLegend
        {...base}
        statewide={{ roads: false, addresses: false }}
        visibleOsmConfigs={[
          osmCfg({ id: 'osm_surveillance_alpr', label: 'Cameras (ALPR)', categoryRender: 'point', categoryFilter: 'alpr' }),
          osmCfg({ id: 'osm_traffic_restriction', label: 'Restrictions', categoryRender: 'line', categoryFilter: 'restriction', color: '#f97316' }),
          osmCfg({ id: 'osm_surveillance_camera_cone', label: 'Camera view cones', categoryRender: 'polygon', categoryFilter: 'camera_cone' }),
        ]}
      />,
    );
    expect(screen.getByText('Cameras (ALPR)')).toBeInTheDocument();
    expect(screen.getByText('Restrictions')).toBeInTheDocument();
    expect(screen.getByText('Camera view cones')).toBeInTheDocument();
  });
});
