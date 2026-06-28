import { describe, it } from 'vitest';
import { fieldInterviewBlankSchema } from '../fieldInterviewBlank';
import { assertPdfSnapshot } from '../../__tests__/snapshotHelpers';

describe('field_interview_blank', () => {
  it('renders to stable bytes (baseline)', async () => {
    await assertPdfSnapshot(fieldInterviewBlankSchema, {}, 'field_interview_blank.empty');
  });
});
