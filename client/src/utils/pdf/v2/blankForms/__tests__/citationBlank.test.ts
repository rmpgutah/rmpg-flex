import { describe, it } from 'vitest';
import { citationBlankSchema } from '../citationBlank';
import { assertPdfSnapshot } from '../../__tests__/snapshotHelpers';

describe('citation_blank', () => {
  it('renders to stable bytes (baseline)', async () => {
    await assertPdfSnapshot(citationBlankSchema, {}, 'citation_blank.empty');
  });
});
