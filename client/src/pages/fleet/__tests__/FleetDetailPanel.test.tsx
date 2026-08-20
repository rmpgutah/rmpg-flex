import { describe, it, expect } from 'vitest';
import { mapMaintenanceLogsForPdf } from '../FleetDetailPanel';
import type { FleetMaintenance } from '../../../types';

describe('mapMaintenanceLogsForPdf', () => {
  it('reads the real fleet_maintenance columns (type/performed_at/mileage_at_service), not the legacy service_type/service_date/odometer_reading names', () => {
    const record = {
      id: '1',
      vehicle_id: '1',
      type: 'routine',
      description: 'Oil change',
      mileage_at_service: 47000,
      cost: 89.99,
      vendor: 'Jiffy Lube',
      performed_by: 'John Doe',
      performed_at: '2026-06-15',
      created_at: '2026-06-15',
    } as unknown as FleetMaintenance;

    const [log] = mapMaintenanceLogsForPdf([record]);

    expect(log.service_date).toBe('2026-06-15');
    expect(log.service_type).toBe('routine');
    expect(log.odometer_reading).toBe(47000);
    expect(log.cost).toBe(89.99);
    expect(log.vendor).toBe('Jiffy Lube');
  });

  it('does not read the legacy service_date/service_type/odometer_reading fields even if present on the row', () => {
    const record = {
      id: '2',
      type: 'repair',
      performed_at: '2026-05-10',
      mileage_at_service: 51000,
      // Stale/never-written legacy columns that still exist on the live table (schema drift) —
      // must be ignored in favor of the real type/performed_at/mileage_at_service values above.
      service_type: 'STALE',
      service_date: '1999-01-01',
      odometer_reading: 0,
    } as unknown as FleetMaintenance;

    const [log] = mapMaintenanceLogsForPdf([record]);
    expect(log.service_date).toBe('2026-05-10');
    expect(log.service_type).toBe('repair');
    expect(log.odometer_reading).toBe(51000);
  });
});
