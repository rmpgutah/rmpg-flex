import { describe, it, expect } from 'vitest';
import { cloudflarePlateToVehicle } from '../src/utils/footage/footageAlpr';
import type { CloudflarePlateResult } from '../src/utils/cloudflarePlate';

const base: CloudflarePlateResult = {
  plate: 'ABC123', state: 'UT', make: 'Toyota', model: 'Camry', color: 'white', year: 2019,
  plateType: 'passenger', bodyStyle: 'sedan', condition: 'clean', damageSummary: null,
  confidence: 0.91, model_id: 'workers-ai', ms: 12,
};

describe('cloudflarePlateToVehicle', () => {
  it('maps plate/attrs and uses bodyStyle as vehicleType', () => {
    const v = cloudflarePlateToVehicle(base);
    expect(v.plate).toBe('ABC123');
    expect(v.state).toBe('UT');
    expect(v.vehicleType).toBe('sedan');
    expect(v.confidence).toBe(0.91);
    expect(v.confidences.plate).toBe(0.91);
    expect(v.damageObserved).toBeNull();        // no damage summary
    expect(v.damageAreas).toEqual([]);
  });
  it('flags damageObserved when a damage summary is present', () => {
    const v = cloudflarePlateToVehicle({ ...base, damageSummary: 'dented front bumper' });
    expect(v.damageObserved).toBe(true);
    expect(v.damageSummary).toBe('dented front bumper');
  });
});
