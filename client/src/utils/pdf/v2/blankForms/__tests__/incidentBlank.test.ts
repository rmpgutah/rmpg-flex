import { describe, it } from 'vitest';
import { incidentBlankSchema } from '../incidentBlank';
import { assertPdfSnapshot } from '../../__tests__/snapshotHelpers';

describe('incident_blank', () => {
  it('renders to stable bytes (baseline)', async () => {
    await assertPdfSnapshot(incidentBlankSchema, {}, 'incident_blank.empty');
  });
});
