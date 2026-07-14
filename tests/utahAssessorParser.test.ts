import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseParcelDetail } from '../src/utils/utah-assessor/parser';

const detailHtml = readFileSync(
  join(__dirname, 'fixtures/utah-assessor/detail-single.html'), 'utf-8',
);

describe('utah-assessor parser', () => {
  it('parses the detail page into a Parcel', () => {
    const parcel = parseParcelDetail(detailHtml);
    expect(parcel.parcel_number).toBe('12:345:0067');
    expect(parcel.source).toBe('utah_county_assessor');
    expect(parcel.owner_of_record).toBe('SMITH JOHN A');
    expect(parcel.owner_type).toBe('individual');
    expect(parcel.situs_address).toBe('100 E CENTER ST');
    expect(parcel.situs_city).toBe('AMERICAN FORK');
    expect(parcel.situs_zip).toBe('84003');
    expect(parcel.tax_district).toBe('AF01');
    expect(parcel.land_acres).toBe(0.25);
    expect(parcel.market_value_total).toBe(412300);
    expect(parcel.market_value_land).toBe(120000);
    expect(parcel.year_built).toBe(1998);
    expect(parcel.legal_description).toBe('LOT 4 PLAT B AMERICAN FORK');
    expect(parcel.sales).toHaveLength(1);
    expect(parcel.sales[0].sale_date).toBe('2021-03-14');
    expect(parcel.sales[0].sale_price).toBe(389000);
  });

  it('infers entity owner type from LLC/INC/TRUST suffixes', () => {
    const html = detailHtml.replace('SMITH JOHN A', 'MOUNTAIN VIEW HOLDINGS LLC');
    const parcel = parseParcelDetail(html);
    expect(parcel.owner_type).toBe('entity');
  });

  it('captures every label/value pair into raw_data_json', () => {
    const parcel = parseParcelDetail(detailHtml);
    expect(parcel.raw_data_json['Serial Number']).toBe('12:345:0067');
    expect(parcel.raw_data_json['Tax District']).toBe('AF01');
  });
});
