import { describe, it, expect } from 'vitest';
import {
  configIdFromLayerId, humanLayerLabel, layerGroupLabel, isOverlayLayer, metresToUsDistance,
  osmGroupAndCatFromLayerId,
} from '../osmLayerLabels';
import { OSM_GROUPS } from '../../config/osmLayers.generated';

describe('configIdFromLayerId', () => {
  it('strips the vt- envelope and the render suffix', () => {
    expect(configIdFromLayerId('vt-osm_safety_emerg-circle')).toBe('osm_safety_emerg');
    expect(configIdFromLayerId('vt-osm_traffic_maxspeed-line')).toBe('osm_traffic_maxspeed');
    expect(configIdFromLayerId('vt-osm_jurisdiction_tribal-fill')).toBe('osm_jurisdiction_tribal');
  });

  it('strips camera halo and cone-outline suffixes introduced by the surveillance paint', () => {
    expect(configIdFromLayerId('vt-osm_surveillance_alpr-halo')).toBe('osm_surveillance_alpr');
    expect(configIdFromLayerId('vt-osm_surveillance_camera-halo')).toBe('osm_surveillance_camera');
    expect(configIdFromLayerId('vt-osm_surveillance_camera_cone-outline-alpr')).toBe('osm_surveillance_camera_cone');
    expect(configIdFromLayerId('vt-osm_surveillance_camera_cone-outline-camera')).toBe('osm_surveillance_camera_cone');
    expect(humanLayerLabel('vt-osm_surveillance_alpr-halo')).toBe('Cameras (ALPR)');
    expect(humanLayerLabel('vt-osm_surveillance_camera_cone-outline-alpr')).toBe('Camera view cones');
  });

  it('handles a layer id with no suffix', () => {
    expect(configIdFromLayerId('vt-osm_safety_hydrant')).toBe('osm_safety_hydrant');
  });

  it('returns null for layers we do not own', () => {
    expect(configIdFromLayerId('road-label')).toBeNull();
    expect(configIdFromLayerId('building')).toBeNull();
    expect(configIdFromLayerId('tilequery')).toBeNull();
  });
});

describe('humanLayerLabel', () => {
  it('resolves the exact id from the reported bug to a readable label', () => {
    // Observed live: the Identify popup printed "vt-osm_safety_emerg-circle".
    const label = humanLayerLabel('vt-osm_safety_emerg-circle');
    expect(label).toBeTruthy();
    expect(label).not.toContain('vt-');
    expect(label).not.toContain('_');
  });

  it('resolves EVERY generated OSM category, in every render suffix', () => {
    for (const g of OSM_GROUPS) {
      for (const c of g.categories) {
        for (const suffix of ['-circle', '-line', '-fill', '-label']) {
          const id = `vt-osm_${g.name}_${c.cat}${suffix}`;
          expect(humanLayerLabel(id), `unlabelled: ${id}`).toBe(c.label);
        }
      }
    }
  });

  it('labels the pre-existing UGRC vector layers too', () => {
    expect(humanLayerLabel('vt-utah_roads-line')).toBe('Utah Roads');
    expect(humanLayerLabel('vt-utah_addresses-circle')).toBe('Utah Address Points');
  });

  it('returns null for foreign layers so callers can fall back safely', () => {
    expect(humanLayerLabel('road-primary')).toBeNull();
    expect(humanLayerLabel('vt-not_a_real_layer-circle')).toBeNull();
  });

  it('never leaks a raw id as the label', () => {
    for (const g of OSM_GROUPS) {
      for (const c of g.categories) {
        const l = humanLayerLabel(`vt-osm_${g.name}_${c.cat}-circle`)!;
        expect(l).not.toMatch(/^vt-/);
        expect(l).not.toMatch(/^osm_/);
      }
    }
  });
});

describe('osmGroupAndCatFromLayerId', () => {
  it('splits catalog group and category, including multi-underscore cats', () => {
    expect(osmGroupAndCatFromLayerId('vt-osm_safety_hydrant-circle')).toEqual({ group: 'safety', cat: 'hydrant' });
    expect(osmGroupAndCatFromLayerId('vt-osm_surveillance_camera_cone-outline-alpr'))
      .toEqual({ group: 'surveillance', cat: 'camera_cone' });
  });
});

describe('layerGroupLabel', () => {
  it('gives the functional group for context', () => {
    expect(layerGroupLabel('vt-osm_safety_hydrant-circle')).toBe('Fire & Life Safety');
  });
});

describe('isOverlayLayer', () => {
  it('is true for ours and false for the basemap', () => {
    expect(isOverlayLayer('vt-osm_safety_hydrant-circle')).toBe(true);
    expect(isOverlayLayer('road-primary')).toBe(false);
  });
});

describe('metresToUsDistance', () => {
  it('converts metres to feet under 1000 ft', () => {
    expect(metresToUsDistance(0)).toBe('0 ft');
    expect(metresToUsDistance(10)).toBe('33 ft');
    expect(metresToUsDistance(100)).toBe('328 ft');
  });

  it('switches to miles past 1000 ft', () => {
    expect(metresToUsDistance(500)).toBe('0.3 mi');
    expect(metresToUsDistance(20000)).toBe('12 mi');
  });

  it('never emits a bare metric number', () => {
    for (const m of [0, 1, 7, 50, 999, 5000]) {
      const s = metresToUsDistance(m);
      expect(s === '' || /(ft|mi)$/.test(s), `bad unit for ${m}: "${s}"`).toBe(true);
    }
  });

  it('is defensive about junk input', () => {
    expect(metresToUsDistance(NaN)).toBe('');
    expect(metresToUsDistance(-5)).toBe('');
  });
});
