import { describe, it, expect } from 'vitest';
import { mergeFormDraft } from '../useFormDraft';
import { EMPTY_SERVE_JOB_OPS } from '../../utils/serveJobIntake';

describe('mergeFormDraft', () => {
  const defaults = {
    recipient_name: '',
    ops: { ...EMPTY_SERVE_JOB_OPS },
  };

  it('fills nested ops when a pre-ops draft is restored', () => {
    const merged = mergeFormDraft(defaults, {
      recipient_name: 'JANE DOE',
      _savedAt: 1,
    });
    expect(merged.recipient_name).toBe('JANE DOE');
    expect(merged.ops.venue_kind).toBe('');
    expect(merged.ops.gate_code).toBe('');
  });

  it('keeps saved ops fields and fills missing nested keys', () => {
    const merged = mergeFormDraft(defaults, {
      recipient_name: 'JANE DOE',
      ops: { gate_code: '200' },
    });
    expect(merged.ops.gate_code).toBe('200');
    expect(merged.ops.venue_kind).toBe('');
    expect(merged.ops.dogs_on_site).toBe(false);
  });

  it('replaces a null nested object with the default', () => {
    const merged = mergeFormDraft(defaults, { ops: null });
    expect(merged.ops.venue_kind).toBe('');
  });
});
