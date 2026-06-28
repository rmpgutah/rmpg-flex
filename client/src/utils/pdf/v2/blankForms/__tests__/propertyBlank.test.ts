import { describe, it } from 'vitest';
import { propertyBlankSchema } from '../propertyBlank';
import { assertPdfSnapshot } from '../../__tests__/snapshotHelpers';

describe('property_blank', () => {
  it('renders to stable bytes (baseline)', async () => {
    await assertPdfSnapshot(propertyBlankSchema, {}, 'property_blank.empty');
  });
});
