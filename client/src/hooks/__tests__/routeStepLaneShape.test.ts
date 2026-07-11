import { describe, it, expect } from 'vitest';
import type { RouteStepLane } from '../useMapRouting';

// Guards against silent drift between the canonical RouteStepLane type
// (useMapRouting.ts) and HudInstruments.tsx's deliberately-separate local
// HudLane mirror (that file avoids cross-lane imports by convention — see
// its header comment). If RouteStepLane ever gains/removes a field, this
// test's object literal will produce a TS error at compile time here,
// prompting a human to check whether HudLane (and the rendering logic that
// reads it) needs the same update — since nothing else enforces that link.
describe('RouteStepLane shape contract', () => {
  it('has exactly the fields HudLane (HudInstruments.tsx) expects', () => {
    const sample: RouteStepLane = { valid: true, active: false, indications: ['straight'] };
    const keys = Object.keys(sample).sort();
    expect(keys).toEqual(['active', 'indications', 'valid']);
  });
});
