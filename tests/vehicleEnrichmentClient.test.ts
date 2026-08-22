import { describe, it, expect } from 'vitest';
import {
  VehicleEnrichConfigError,
  VehicleEnrichTimeoutError,
  VehicleEnrichHttpError,
} from '../src/utils/vehicleEnrichment/types';

describe('VehicleEnrich error types', () => {
  it('VehicleEnrichConfigError is an Error with correct name', () => {
    const err = new VehicleEnrichConfigError('PLATE_TO_VIN_API_KEY');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('VehicleEnrichConfigError');
    expect(err.apiKey).toBe('PLATE_TO_VIN_API_KEY');
  });

  it('VehicleEnrichTimeoutError is an Error with correct name', () => {
    const err = new VehicleEnrichTimeoutError('plateToVin', 10000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('VehicleEnrichTimeoutError');
    expect(err.step).toBe('plateToVin');
    expect(err.timeoutMs).toBe(10000);
  });

  it('VehicleEnrichHttpError carries status and step', () => {
    const err = new VehicleEnrichHttpError('decodeVin', 429, 'Too Many Requests');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('VehicleEnrichHttpError');
    expect(err.step).toBe('decodeVin');
    expect(err.status).toBe(429);
  });
});
