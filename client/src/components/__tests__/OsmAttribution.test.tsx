import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import OsmAttribution from '../OsmAttribution';
import type { VectorTileLayerConfig } from '../../hooks/useVectorTileLayers';

function makeConfig(overrides: Partial<VectorTileLayerConfig>): VectorTileLayerConfig {
  return {
    id: 'osm_test_1',
    label: 'Test Layer',
    description: 'Test Layer',
    name: 'osm-test',
    sourceLayer: 'test',
    sourceMinzoom: 6,
    sourceMaxzoom: 16,
    kind: 'point',
    minzoom: 10,
    color: '#c3ccd6',
    labelProp: 'name',
    detailProps: [],
    defaultVisible: false,
    source: 'osm',
    attribution: '© OpenStreetMap contributors (ODbL) · extract 2026-08-01',
    ...overrides,
  };
}

describe('OsmAttribution', () => {
  it('renders nothing when the visible list is empty', () => {
    const { container } = render(<OsmAttribution visibleOsmConfigs={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the ODbL text and extract date when one layer is visible', () => {
    render(<OsmAttribution visibleOsmConfigs={[makeConfig({ coverage: 'Crowd-sourced — coverage is incomplete. Absence does not indicate none present.' })]} />);
    expect(screen.getByText(/© OpenStreetMap contributors \(ODbL\)/)).toBeInTheDocument();
    expect(screen.getByText(/2026-08-01/)).toBeInTheDocument();
  });

  it('shows the boundary caption for a jurisdiction layer', () => {
    render(
      <OsmAttribution
        visibleOsmConfigs={[
          makeConfig({
            id: 'osm_jurisdiction_1',
            coverage: 'Reference boundaries from OpenStreetMap. Not a legal determination of jurisdiction or authority.',
          }),
        ]}
      />,
    );
    expect(
      screen.getByText('Reference boundaries from OpenStreetMap. Not a legal determination of jurisdiction or authority.'),
    ).toBeInTheDocument();
  });

  it('deduplicates: two layers sharing a coverage class produce that caption exactly once', () => {
    const caption = 'Crowd-sourced — coverage is incomplete. Absence does not indicate none present.';
    render(
      <OsmAttribution
        visibleOsmConfigs={[
          makeConfig({ id: 'osm_a', coverage: caption }),
          makeConfig({ id: 'osm_b', coverage: caption }),
        ]}
      />,
    );
    expect(screen.getAllByText(caption)).toHaveLength(1);
  });

  it('shows two distinct captions when two different coverage classes are visible', () => {
    const sparse = 'Crowd-sourced — only mapped features are shown. Expect unmapped features in the field.';
    const attribute = 'Crowd-sourced road attributes. Unstyled roads are untagged, not confirmed paved.';
    render(
      <OsmAttribution
        visibleOsmConfigs={[
          makeConfig({ id: 'osm_a', coverage: sparse }),
          makeConfig({ id: 'osm_b', coverage: attribute }),
        ]}
      />,
    );
    expect(screen.getByText(sparse)).toBeInTheDocument();
    expect(screen.getByText(attribute)).toBeInTheDocument();
  });
});
