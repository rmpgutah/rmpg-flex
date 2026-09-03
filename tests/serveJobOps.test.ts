import { describe, it, expect } from 'vitest';
import { previewServeOps, parseServeParsedData } from '../src/utils/serveJobOps';

describe('previewServeOps', () => {
  it('fires hospice + dogs + no-sunday from job-form fields', () => {
    const out = previewServeOps({
      addressClass: 'corporate',
      addressClassConfirmed: false,
      recipient_name: 'BRISTOL HOSPICE LLC',
      recipient_address: '2005 East 2700 South Suite 200',
      recipient_city: 'SALT LAKE CITY',
      recipient_state: 'UT',
      recipient_zip: '84109',
      recipient_type: 'business',
      document_type: 'summons',
      jurisdiction: 'FL',
      priority: 'urgent',
      deadline: '2026-08-12',
      service_instructions: '',
      nowIso: '2026-08-12T08:26:06Z',
      ops: {
        documents_to_serve: '20 DAY SUMMONS; VERIFIED COMPLAINT',
        venue_kind: '',
        dogs_on_site: true,
        no_sunday: true,
        gate_code: '#200',
      },
    });
    expect(out.venue).toBe('medical_hospice');
    expect(out.windows.map((w) => w.window)).toEqual(['09:30-11:30', '13:30-16:00']);
    expect(out.tree.firedIds).toContain('venue.medical_hospice');
    expect(out.tree.firedIds).toContain('legal.no_sunday');
    expect(out.tree.firedIds).toContain('access.animal_hazard');
    expect(out.tree.firedIds).toContain('access.gated');
    expect(out.note).toContain('Gate/call-box code on file: #200');
  });

  it('does not apply warehouse overlay to a residence (D-2)', () => {
    const out = previewServeOps({
      addressClass: 'residential',
      recipient_name: 'JANE DOE',
      recipient_address: '1180 E Vine St',
      recipient_state: 'UT',
      ops: { venue_kind: 'warehouse' },
    });
    expect(out.windows.every((w) => w.authority === 'residential default')).toBe(true);
  });
});

describe('parseServeParsedData', () => {
  it('reads _ops and address class from parsed_data', () => {
    const meta = parseServeParsedData(JSON.stringify({
      _intake: { address_class: { klass: 'corporate', confirmed: 1 }, venue: 'hotel' },
      _ops: { gate_code: '99', dogs_on_site: true },
    }));
    expect(meta.addressClass).toBe('corporate');
    expect(meta.addressClassConfirmed).toBe(true);
    expect(meta.venue).toBe('hotel');
    expect(meta.ops.gate_code).toBe('99');
    expect(meta.ops.dogs_on_site).toBe(true);
  });
});
