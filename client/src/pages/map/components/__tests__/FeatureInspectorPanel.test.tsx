import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FeatureInspectorPanel from '../FeatureInspectorPanel';
import type { InspectionResult } from '../../../../hooks/useMapFeatureInspect';

const base = { lngLat: [-111.85355, 40.64199] as [number, number], widened: false, timestamp: 0 };

const school = {
  key: 'w101', layerId: 'vt-osm_sites_school-circle',
  categoryLabel: 'Schools & childcare', groupLabel: 'Sensitive & high-risk sites',
  properties: { name: 'Woodstock Elementary School', 'addr:city': 'Salt Lake City', maxheight: '3.8' },
  geometry: { type: 'Point', coordinates: [-111.85355, 40.64199] } as any,
};
const hydrant = {
  key: 'n55', layerId: 'vt-osm_safety_hydrant-circle',
  categoryLabel: 'Fire hydrants', groupLabel: 'Fire & life safety',
  properties: { name: 'Hydrant 12' },
  geometry: { type: 'Point', coordinates: [-111.853, 40.642] } as any,
};

const noop = () => {};
const props = { selectedIndex: 0, onSelect: noop, onClose: noop, onHoverFeature: noop };

describe('FeatureInspectorPanel', () => {
  it('shows the selected feature detail without an extra click', () => {
    const result: InspectionResult = { ...base, features: [school] };
    render(<FeatureInspectorPanel {...props} result={result} />);
    expect(screen.getByText('Woodstock Elementary School')).toBeInTheDocument();
    expect(screen.getByText('Salt Lake City')).toBeInTheDocument();
  });

  it('renders OSM metric tags in US units', () => {
    const result: InspectionResult = { ...base, features: [school] };
    render(<FeatureInspectorPanel {...props} result={result} />);
    expect(screen.getByText('12\' 6"')).toBeInTheDocument();
    expect(screen.queryByText('3.8')).not.toBeInTheDocument();
  });

  it('lists every hit and reports the selection', () => {
    const onSelect = vi.fn();
    const result: InspectionResult = { ...base, features: [school, hydrant] };
    render(<FeatureInspectorPanel {...props} result={result} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Hydrant 12'));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('reports hover so the map can highlight the geometry', () => {
    const onHoverFeature = vi.fn();
    const result: InspectionResult = { ...base, features: [school, hydrant] };
    render(<FeatureInspectorPanel {...props} result={result} onHoverFeature={onHoverFeature} />);
    fireEvent.mouseEnter(screen.getByText('Hydrant 12'));
    expect(onHoverFeature).toHaveBeenCalledWith(hydrant);
    fireEvent.mouseLeave(screen.getByText('Hydrant 12'));
    expect(onHoverFeature).toHaveBeenLastCalledWith(null);
  });

  it('states plainly when nothing is there', () => {
    const result: InspectionResult = { ...base, features: [] };
    render(<FeatureInspectorPanel {...props} result={result} />);
    expect(screen.getByText(/no overlay features here/i)).toBeInTheDocument();
    expect(screen.getByText(/-111\.85355/)).toBeInTheDocument();
  });

  it('shows the distance only when the search had to widen', () => {
    const away = { ...hydrant, awayLabel: '90 ft NE' };
    render(<FeatureInspectorPanel {...props}
      result={{ ...base, widened: true, features: [away] }} />);
    expect(screen.getByText('90 ft NE')).toBeInTheDocument();
  });

  it('marks an RMPG-verified feature distinctly from OSM data', () => {
    const verified = { ...school, properties: { ...school.properties, __rmpg_verified: true } };
    render(<FeatureInspectorPanel {...props} result={{ ...base, features: [verified] }} />);
    expect(screen.getByText(/RMPG VERIFIED/i)).toBeInTheDocument();
  });

  it('never leaks a raw layer id to the operator', () => {
    render(<FeatureInspectorPanel {...props} result={{ ...base, features: [school] }} />);
    expect(document.body.textContent).not.toContain('vt-osm_');
  });

  it('offers Edit / Verify when the feature has an OSM id', () => {
    const onEditOsmFeature = vi.fn();
    const withId = {
      ...hydrant,
      properties: { ...hydrant.properties, osm_id: 'n55' },
    };
    render(
      <FeatureInspectorPanel
        {...props}
        result={{ ...base, features: [withId] }}
        onEditOsmFeature={onEditOsmFeature}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /edit \/ verify/i }));
    expect(onEditOsmFeature).toHaveBeenCalledWith(expect.objectContaining({
      osmId: 'n55',
      group: 'safety',
      cat: 'hydrant',
    }));
  });

  it('falls back to a neutral marker glyph for UGRC layers with no icon category', () => {
    // configIdFromLayerId(...).split('_').slice(2) yields '' for utah_roads /
    // utah_addresses — OSM_ICON_BY_CAT[''] is undefined, so this must render
    // a real glyph (lucide MapPin) instead of an empty gray square.
    const road = {
      key: 'r1', layerId: 'utah_roads',
      categoryLabel: 'Roads', groupLabel: null,
      properties: { name: 'State Street' },
      geometry: { type: 'LineString', coordinates: [[-111.85, 40.64], [-111.86, 40.65]] } as any,
    };
    const { container } = render(<FeatureInspectorPanel {...props} result={{ ...base, features: [road] }} />);
    const icon = container.querySelector('svg[aria-hidden]');
    expect(icon).toBeInTheDocument();
    expect(icon?.getAttribute('class')).toMatch(/lucide/);
    expect(container.querySelector('span.bg-rmpg-600')).not.toBeInTheDocument();
  });
});
