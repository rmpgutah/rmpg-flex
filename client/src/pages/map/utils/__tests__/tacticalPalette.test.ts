import { describe, it, expect } from 'vitest';
import {
  TACTICAL_SURFACE_BASE, TACTICAL_SURFACE_RAISED, TACTICAL_BORDER,
  TACTICAL_TEXT_MUTED, TACTICAL_BRAND_GOLD,
} from '../tacticalPalette';

describe('tacticalPalette', () => {
  it('matches the night palette values in theme-palettes.css', () => {
    // Values sourced from client/src/styles/theme-palettes.css's
    // `:root, html.theme-dark, .tactical-dark` block — kept in sync manually
    // since these are plain hex strings for use outside React/Tailwind.
    expect(TACTICAL_SURFACE_BASE).toBe('#0d1722');
    expect(TACTICAL_SURFACE_RAISED).toBe('#15212e');
    expect(TACTICAL_BORDER).toBe('#2a3a4d');
    expect(TACTICAL_TEXT_MUTED).toBe('#8fa3b8');
    expect(TACTICAL_BRAND_GOLD).toBe('#d4a017');
  });
});
