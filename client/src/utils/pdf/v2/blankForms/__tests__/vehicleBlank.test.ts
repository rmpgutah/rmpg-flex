import { describe, it } from 'vitest';
import { vehicleBlankSchema } from '../vehicleBlank';
import { assertPdfSnapshot } from '../../__tests__/snapshotHelpers';

describe('vehicle_blank', () => {
  it('renders to stable bytes (baseline)', async () => {
    await assertPdfSnapshot(vehicleBlankSchema, {}, 'vehicle_blank.empty');
  });
});
