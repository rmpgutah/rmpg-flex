import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HOOKS = [
  'useMapboxDraw.ts',
  'useMapMeasureDraw.ts',
  'useMapDrawing.ts',
  'useMapClustering.ts',
  'useMapboxIncidents.ts',
  'useMapboxRepeatAddresses.ts',
  'useMapDirectionsPanel.ts',
  'useMapCoordinateGrid.ts',
  'useMapRouting.ts',
  'useMapBreadcrumbs.ts',
  'useMapPlacesSearch.ts',
  'useMapInfoPanel.ts',
  'useMapGeofenceAlerts.ts',
];

describe('map overlay paint', () => {
  it('does not use banned field-label gold in Mapbox paint/marker hooks', () => {
    const dir = resolve(__dirname, '..');
    for (const file of HOOKS) {
      const src = readFileSync(resolve(dir, file), 'utf8');
      expect(src.toLowerCase(), file).not.toContain('#d4a017');
    }
  });
});
