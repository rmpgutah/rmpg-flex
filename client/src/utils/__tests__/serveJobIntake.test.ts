import { describe, it, expect } from 'vitest';
import { parseServeJobMeta } from '../serveJobIntake';

describe('parseServeJobMeta', () => {
  it('extracts venue, windows, and ops for the job card', () => {
    const meta = parseServeJobMeta(JSON.stringify({
      _intake: {
        address_class: { klass: 'corporate', confirmed: true },
        venue: 'medical_hospice',
        output_tree: {
          venue_label: 'Medical / Hospice',
          fired_ids: ['venue.medical_hospice', 'legal.no_sunday'],
          windows: [{ window: '09:30-11:30', authority: 'venue default' }],
        },
      },
      _ops: { no_sunday: true, gate_code: '200' },
    }));
    expect(meta.addressClass).toBe('corporate');
    expect(meta.venueLabel).toBe('Medical / Hospice');
    expect(meta.windows[0].window).toBe('09:30-11:30');
    expect(meta.ops.no_sunday).toBe(true);
    expect(meta.ops.gate_code).toBe('200');
  });
});
