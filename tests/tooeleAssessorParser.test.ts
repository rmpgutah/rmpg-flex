import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseParcelDetail } from '../src/utils/tooele-assessor/parser';

const detailHtml = readFileSync(
  join(__dirname, 'fixtures/tooele-assessor/detail-single.html'), 'utf-8',
);

describe('tooele-assessor (recorder-only) parser', () => {
  it('parses the narrow field set from the document index page', () => {
    const parcel = parseParcelDetail(detailHtml);
    expect(parcel.parcel_number).toBe('05-123-0-0045');
    expect(parcel.source).toBe('tooele_county_recorder');
    expect(parcel.owner_of_record).toBe('DOE JANE');
    expect(parcel.owner_mailing_address).toBe('47 S MAIN ST TOOELE UT 84074');
    expect(parcel.legal_description).toBe('LOT 3 BLOCK 2 TOOELE TOWNSITE');
    expect(parcel.recorded_document_type).toBe('WARRANTY DEED');
    expect(parcel.recorded_document_url).toBe(
      'https://erecording.tooeleco.gov/eaglesoftware/web/document/2021-004521',
    );
  });

  it('leaves assessed-value fields null — no such data source exists', () => {
    const parcel = parseParcelDetail(detailHtml);
    expect(parcel.market_value_total).toBeNull();
    expect(parcel.year_built).toBeNull();
    expect(parcel.land_sqft).toBeNull();
  });
});
