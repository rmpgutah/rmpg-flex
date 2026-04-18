import { describe, it, expect } from 'vitest';
import { renderCallNarrative, type CallSlots } from '../narrativeRenderer';

const CALL: CallSlots = {
  call_number: 'CN-26-0457',
  priority: 1,
  incident_type: 'domestic disturbance',
  location_address: '123 Main Street',
  apartment: '4B',
  zone_code: 'Delta-2',
  beat_code: '14',
  suspect_description: 'white male, 30s, black hoodie',
  assigned_units: ['3-Adam'],
};

describe('renderCallNarrative', () => {
  it('narrative mode includes full slot values in natural prose', () => {
    const t = renderCallNarrative(CALL, 'narrative');
    expect(t).toContain('priority one');
    expect(t).toContain('domestic disturbance');
    expect(t).toContain('123 Main Street');
    expect(t).toContain('apartment 4B');
    expect(t).toContain('Delta-2');
    expect(t).toContain('beat 14');
    expect(t).toContain('Suspect is');
    expect(t).toContain('3-Adam');
  });

  it('standard mode uses CAD shorthand and combines zone-beat', () => {
    const t = renderCallNarrative(CALL, 'standard');
    expect(t).toContain('P1 domestic');
    expect(t).toContain('123 Main');
    expect(t).toContain('Delta-2-14');
    expect(t).toContain('3-Adam');
    expect(t).not.toContain('Suspect is'); // suspect dropped in standard
    expect(t).not.toContain('apartment'); // apartment dropped in standard
  });

  it('terse mode is brief and includes P# incident + address + units', () => {
    const t = renderCallNarrative(CALL, 'terse');
    expect(t).toContain('P1 domestic');
    expect(t).toContain('123 Main');
    expect(t).toContain('3-Adam');
    expect(t.length).toBeLessThan(60);
  });

  it('skips empty slots silently in all modes', () => {
    const empty: CallSlots = { priority: 2, incident_type: 'traffic' };
    expect(renderCallNarrative(empty, 'terse')).toBe('P2 traffic');
    expect(renderCallNarrative(empty, 'standard')).toBe('P2 traffic');
    const nar = renderCallNarrative(empty, 'narrative');
    expect(nar).toContain('priority two');
    expect(nar).toContain('traffic');
    expect(nar).not.toContain('at ');
    expect(nar).not.toContain('zone');
  });

  it('narrative mode still includes assigned unit phrasing when present', () => {
    const t = renderCallNarrative({ priority: 3, assigned_units: ['5-Charlie', '5-Delta'] }, 'narrative');
    expect(t).toContain('Unit 5-Charlie, 5-Delta assigned');
  });

  it('handles zone without beat', () => {
    const t = renderCallNarrative({ priority: 1, incident_type: 'fire', zone_code: 'Alpha-1' }, 'standard');
    expect(t).toContain('Alpha-1');
    expect(t).not.toContain('Alpha-1-');
  });
});
