import { describe, it, expect } from 'vitest';
import {
  PROPERTY_TYPES, ROAD_CLASSES, ptTypeColorExpression, roadColorExpression,
} from '../landTypes';

describe('UGRC land/road colors', () => {
  it('never uses a CSS var() — Mapbox paint cannot resolve it', () => {
    const blob = JSON.stringify([PROPERTY_TYPES, ROAD_CLASSES, ptTypeColorExpression(), roadColorExpression()]);
    expect(blob).not.toContain('var(');
  });

  it('never uses the banned #d4a017 gold', () => {
    const blob = JSON.stringify([PROPERTY_TYPES, ROAD_CLASSES]).toLowerCase();
    expect(blob).not.toContain('d4a017');
  });
});
