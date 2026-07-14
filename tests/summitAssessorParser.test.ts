import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseParcelDetail } from '../src/utils/summit-assessor/parser';

const detailHtml = readFileSync(
  join(__dirname, 'fixtures/summit-assessor/detail-single.html'), 'utf-8',
);

describe('summit-assessor parser', () => {
  it('parses the detail page into a Parcel', () => {
    const parcel = parseParcelDetail(detailHtml);
    expect(parcel.parcel_number).toBe('SC-00417-A');
    expect(parcel.source).toBe('summit_county_assessor');
    expect(parcel.owner_of_record).toBe('PARK CITY MOUNTAIN TRUST');
    expect(parcel.owner_type).toBe('entity');
    expect(parcel.situs_address).toBe('50 MAIN ST');
    expect(parcel.situs_city).toBe('PARK CITY');
    expect(parcel.situs_zip).toBe('84060');
    expect(parcel.tax_district).toBe('PC-01');
    expect(parcel.market_value_total).toBe(1250000);
    expect(parcel.market_value_land).toBe(600000);
    expect(parcel.year_built).toBe(2005);
    expect(parcel.legal_description).toBe('LOT 12 PARK CITY MEADOWS');
    expect(parcel.sales).toHaveLength(1);
    expect(parcel.sales[0].sale_date).toBe('2019-07-02');
    expect(parcel.sales[0].sale_price).toBe(1100000);
    expect(parcel.photo_url).toBe('https://property.summitcounty.org/eaglesoftware/taxweb/photos/SC-00417-A.jpg');
    expect(parcel.layout_url).toBeNull();
  });

  it('infers individual owner type when no entity marker is present', () => {
    const html = detailHtml.replace('PARK CITY MOUNTAIN TRUST', 'JONES MARY B');
    const parcel = parseParcelDetail(html);
    expect(parcel.owner_type).toBe('individual');
  });
});
