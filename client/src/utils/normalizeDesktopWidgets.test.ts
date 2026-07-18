// client/src/utils/normalizeDesktopWidgets.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeDesktopWidgets, serializeDesktopWidgets, ALL_WIDGET_IDS } from './normalizeDesktopWidgets';

describe('normalizeDesktopWidgets', () => {
  it('upgrades a v1 on/off string array into freeform per-widget state, all "on"', () => {
    const raw = JSON.stringify(['clock', 'quick-access']);
    const widgets = normalizeDesktopWidgets(raw);
    const byId = Object.fromEntries(widgets.map(w => [w.id, w]));
    expect(byId['clock'].on).toBe(true);
    expect(byId['quick-access'].on).toBe(true);
    // every known widget id is present, even ones absent from the old array
    expect(ALL_WIDGET_IDS.every(id => byId[id])).toBe(true);
    expect(byId['ops-summary'].on).toBe(false);
    expect(byId['shift-timer'].on).toBe(false); // new widget ids default OFF, never auto-enabled
    expect(byId['clock'].opacity).toBe(1);
    expect(byId['clock'].blur).toBe(0);
    expect(typeof byId['clock'].x).toBe('number');
  });

  it('passes through an already-v2-shape array, filling defaults for missing widget ids', () => {
    const raw = JSON.stringify([{ id: 'clock', x: 10, y: 10, on: true, opacity: 0.8, blur: 4 }]);
    const widgets = normalizeDesktopWidgets(raw);
    const byId = Object.fromEntries(widgets.map(w => [w.id, w]));
    expect(byId['clock']).toEqual({ id: 'clock', x: 10, y: 10, on: true, opacity: 0.8, blur: 4 });
    expect(byId['mini-map'].on).toBe(false);
  });

  it('returns v1 defaults (4 widgets on, 3 new ones off) for null/undefined/invalid JSON', () => {
    for (const raw of [null, undefined, '{not json']) {
      const widgets = normalizeDesktopWidgets(raw);
      const byId = Object.fromEntries(widgets.map(w => [w.id, w]));
      expect(byId['clock'].on).toBe(true);
      expect(byId['ops-summary'].on).toBe(true);
      expect(byId['notifications'].on).toBe(true);
      expect(byId['quick-access'].on).toBe(true);
      expect(byId['shift-timer'].on).toBe(false);
      expect(byId['pinned-call-ticker'].on).toBe(false);
      expect(byId['mini-map'].on).toBe(false);
    }
  });

  it('serializeDesktopWidgets round-trips through normalizeDesktopWidgets', () => {
    const widgets = normalizeDesktopWidgets(null);
    expect(normalizeDesktopWidgets(serializeDesktopWidgets(widgets))).toEqual(widgets);
  });
});
