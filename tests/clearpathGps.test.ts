import { describe, it, expect } from 'vitest';
import {
  toDevice, vehicleToCamera, normalizeMediaObject, normalizeMediaEvent, type CpgDevice,
} from '../src/utils/clearpathGps';

describe('clearpathGps pure helpers', () => {
  it('toDevice reads canonical v1.0 field names', () => {
    const d = toDevice({
      deviceId: 'cp160817', assetId: '136022', displayName: 'S19', serialNumber: 'SN-1',
      lastValidLatitude: 40.76, lastValidLongitude: -111.89,
      vehicleMake: 'Ford', vehicleModel: 'Explorer', licensePlate: 'ABC123',
      vehicleID: '1FToVIN', driverDescription: 'J. Doe', ignitionState: 'on', mediaEnabled: true,
    });
    expect(d.deviceId).toBe('cp160817');
    expect(d.assetId).toBe('136022');
    expect(d.displayName).toBe('S19');
    expect(d.licensePlate).toBe('ABC123');
    expect(d.vehicleID).toBe('1FToVIN');
    expect(d.lastValidLatitude).toBeCloseTo(40.76);
    expect(d.driverName).toBe('J. Doe');
    expect(d.ignitionState).toBe('on');
    expect(d.mediaEnabled).toBe(true);
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

  it('toDevice falls back deviceId to assetId and displayName to id', () => {
    const onlyAsset = toDevice({ assetId: '999' });
    expect(onlyAsset.deviceId).toBe('999');
    const onlyId = toDevice({ id: 'only-id' });
    expect(onlyId.deviceId).toBe('only-id');
    expect(onlyId.displayName).toBe('only-id');
    expect(Number.isNaN(onlyId.lastValidLatitude)).toBe(true);
  });

  it('vehicleToCamera maps a media-enabled vehicle to an assetId-keyed camera', () => {
    const d: CpgDevice = toDevice({ deviceId: 'cp160817', assetId: '140702', displayName: 'S19', mediaEnabled: true });
    const cam = vehicleToCamera(d);
    expect(cam?.id).toBe(140702);
    expect(cam?.name).toBe('S19');
    expect(cam?.providerId).toBe('cp160817');
  });

  it('vehicleToCamera returns null when assetId is non-numeric', () => {
    expect(vehicleToCamera(toDevice({ deviceId: 'x', displayName: 'x' }))).toBeNull();
  });

  it('normalizeMediaObject maps cameraType→channel and lat/lng→latitude/longitude', () => {
    const mo = normalizeMediaObject({
      type: 'video', cameraType: 'OUTSIDE', status: 'available', accessUrl: 'https://s3/a.mp4',
      thumbnailUrl: 'https://s3/a.jpg', expiringSoon: true,
      gps: [{ lat: 40.7, lng: -111.8, speed: 33, timestamp: 1000 }],
    }, 'Harsh Braking');
    expect(mo.channel).toBe('outside');
    expect(mo.type).toBe('VIDEO');
    expect(mo.status).toBe('AVAILABLE');
    expect(mo.eventType).toBe('Harsh Braking');
    expect(mo.expiringSoon).toBe(true);
    expect(mo.location).toEqual({ lat: 40.7, lng: -111.8 });
    expect(mo.gps?.[0]).toMatchObject({ latitude: 40.7, longitude: -111.8, speed: 33 });
  });

  it('normalizeMediaEvent maps timestamp→eventTimestamp and mediaObjects[]→mediaObject[]', () => {
    const ev = normalizeMediaEvent({
      timestamp: 1781442000000, address: '100 Main St', eventTypes: ['Automatic', 'Speeding'],
      mediaObjects: [
        { type: 'VIDEO', cameraType: 'outside', status: 'AVAILABLE', accessUrl: 'https://s3/v.mp4' },
        { type: 'IMAGE', cameraType: 'inside', status: 'AVAILABLE', accessUrl: 'https://s3/i.jpg' },
      ],
    });
    expect(ev.eventTimestamp).toBe(1781442000000);
    expect(ev.address).toBe('100 Main St');
    expect(ev.mediaObject).toHaveLength(2);
    expect(ev.mediaObject[0].eventType).toBe('Automatic, Speeding');
    expect(ev.mediaObject[1].channel).toBe('inside');
  });

  it('normalizeMediaEvent tolerates an empty/sparse payload', () => {
    const ev = normalizeMediaEvent({});
    expect(ev.eventTimestamp).toBe(0);
    expect(ev.mediaObject).toEqual([]);
    expect(ev.status).toBe('AVAILABLE');
  });
});
