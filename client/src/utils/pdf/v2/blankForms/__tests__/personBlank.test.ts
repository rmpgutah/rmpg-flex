import { describe, it } from 'vitest';
import { personBlankSchema } from '../personBlank';
import { assertPdfSnapshot } from '../../__tests__/snapshotHelpers';

describe('person_blank', () => {
  it('renders to stable bytes (baseline)', async () => {
    await assertPdfSnapshot(personBlankSchema, {}, 'person_blank.empty');
  });
});
