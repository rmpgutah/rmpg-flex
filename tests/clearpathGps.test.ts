import { describe, it, expect } from 'vitest';
import { authToken, toDevice, cameraToDevice, type CpgCamera } from '../src/utils/clearpathGps';

describe('clearpathGps pure helpers', () => {
  it('authToken builds base64(account/user:password)', () => {
    const tok = authToken({ account: '12345', user: 'a@b.com', password: 'p@ss' });
    expect(atob(tok)).toBe('12345/a@b.com:p@ss');
  });

  it('toDevice reads canonical field names', () => {
    const d = toDevice({
      deviceId: 'cp160817', displayName: 'S19', serialNumber: 'SN-1',
      lastValidLatitude: 40.76, lastValidLongitude: -111.89,
      vehicleMake: 'Ford', vehicleModel: 'Explorer', licensePlate: 'ABC123',
      vehicleID: '1FToVIN', driverName: 'J. Doe', ignitionState: 'on',
    });
    expect(d.deviceId).toBe('cp160817');
    expect(d.displayName).toBe('S19');
    expect(d.licensePlate).toBe('ABC123');
    expect(d.vehicleID).toBe('1FToVIN');
    expect(d.lastValidLatitude).toBeCloseTo(40.76);
    expect(d.ignitionState).toBe('on');
  });

  it('toDevice reads snake_case / alias field names', () => {
    const d = toDevice({
      device_id: 'x9', name: 'Unit 9', vin: 'VIN9', license_plate: 'XYZ', lat: 41, lon: -112,
    });
    expect(d.deviceId).toBe('x9');
    expect(d.displayName).toBe('Unit 9');
    expect(d.vehicleID).toBe('VIN9');
    expect(d.licensePlate).toBe('XYZ');
    expect(d.lastValidLatitude).toBe(41);
    expect(d.lastValidLongitude).toBe(-112);
  });

  it('toDevice falls back displayName to deviceId when name absent', () => {
    const d = toDevice({ id: 'only-id' });
    expect(d.deviceId).toBe('only-id');
    expect(d.displayName).toBe('only-id');
    expect(Number.isNaN(d.lastValidLatitude)).toBe(true);
  });

  it('cameraToDevice maps a media camera to a device row', () => {
    const cam: CpgCamera = { id: 140702, provider: 'smartwitness', name: 'S19', providerId: 'cp160817', notes: 'front cam', lastCommunication: 0 };
    const d = cameraToDevice(cam);
    expect(d.deviceId).toBe('cp160817');
    expect(d.displayName).toBe('S19');
    expect(d.uniqueId).toBe('140702');
    expect(d.cameraId).toBe(140702);
  });
});
