import { describe, it, expect } from 'vitest';
import { PLACE_CATEGORIES } from '../useMapPlacesSearch';

describe('PLACE_CATEGORIES', () => {
  it('uses literal hex colors, never CSS variables or banned gold', () => {
    for (const cat of PLACE_CATEGORIES) {
      expect(cat.color, cat.id).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(cat.color.toLowerCase()).not.toBe('#d4a017');
    }
  });
});
