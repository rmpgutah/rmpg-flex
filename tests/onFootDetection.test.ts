import { describe, it, expect } from 'vitest';
import { classifyActivity, detectTransition, type ActivityPoint } from '../src/utils/onFootDetection';

const pt = (activity: string | null, conf: string | null = 'high'): ActivityPoint =>
  ({ activity, activity_confidence: conf });

describe('classifyActivity', () => {
  it('walking/running at medium+ confidence → on_foot', () => {
    expect(classifyActivity(pt('walking', 'high'))).toBe('on_foot');
    expect(classifyActivity(pt('walking', 'medium'))).toBe('on_foot');
    expect(classifyActivity(pt('running', 'high'))).toBe('on_foot');
  });
  it('automotive at medium+ confidence → in_vehicle', () => {
    expect(classifyActivity(pt('automotive', 'high'))).toBe('in_vehicle');
    expect(classifyActivity(pt('automotive', 'medium'))).toBe('in_vehicle');
  });
  it('low confidence, stationary, cycling, unknown, missing → unknown', () => {
    expect(classifyActivity(pt('walking', 'low'))).toBe('unknown');
    expect(classifyActivity(pt('stationary'))).toBe('unknown');
    expect(classifyActivity(pt('cycling'))).toBe('unknown');
    expect(classifyActivity(pt('unknown'))).toBe('unknown');
    expect(classifyActivity(pt(null))).toBe('unknown');
    expect(classifyActivity({})).toBe('unknown');
  });
});

describe('detectTransition (debounced)', () => {
  it('fires ON_FOOT only after 2+ consecutive on-foot points', () => {
    expect(detectTransition('in_vehicle', [pt('walking'), pt('walking')])).toBe('ON_FOOT');
    expect(detectTransition('in_vehicle', [pt('automotive'), pt('walking')])).toBe(null);
    expect(detectTransition('in_vehicle', [pt('walking')])).toBe(null); // single ping
  });
  it('fires BACK_IN_VEHICLE only after 2+ consecutive automotive points', () => {
    expect(detectTransition('on_foot', [pt('automotive'), pt('automotive')])).toBe('BACK_IN_VEHICLE');
    expect(detectTransition('on_foot', [pt('walking'), pt('automotive')])).toBe(null);
  });
  it('never transitions on unknowns (stoplight: stationary in car)', () => {
    expect(detectTransition('in_vehicle', [pt('stationary'), pt('stationary')])).toBe(null);
    expect(detectTransition('on_foot', [pt('stationary'), pt('stationary')])).toBe(null);
    expect(detectTransition('in_vehicle', [])).toBe(null);
  });
  it('no-op when already in the detected state', () => {
    expect(detectTransition('on_foot', [pt('walking'), pt('walking')])).toBe(null);
    expect(detectTransition('in_vehicle', [pt('automotive'), pt('automotive')])).toBe(null);
  });
});
