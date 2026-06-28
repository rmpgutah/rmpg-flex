// src/utils/sl-assessor/types.ts
// Salt Lake County Assessor types. Mirrors the columns in parcel_records;
// raw_data_json captures anything we parsed but don't have a typed slot for.

export type OwnerType = 'individual' | 'entity' | 'mixed' | 'unknown';

export interface ParcelSummary {
  parcel_number: string;
  owner_of_record: string | null;
  situs_address: string | null;
  land_sqft: number | null;
  total_market_value: number | null;
  detail_url: string;
}

export interface ParcelSale {
  sale_date: string | null;
  sale_price: number | null;
  doc_number: string | null;
  buyer: string | null;
  seller: string | null;
  sale_type: string | null;
}

export interface Parcel {
  parcel_number: string;
  source: 'sl_county_assessor';
  source_url: string;
  account_number: string | null;
  serial_number: string | null;
  tax_district: string | null;
  owner_of_record: string | null;
  owner_type: OwnerType;
  owner_mailing_address: string | null;
  situs_address: string | null;
  situs_city: string | null;
  situs_zip: string | null;
  subdivision: string | null;
  land_acres: number | null;
  land_sqft: number | null;
  land_value: number | null;
  zoning: string | null;
  year_built: number | null;
  effective_year_built: number | null;
  total_bldg_sqft: number | null;
  finished_sqft: number | null;
  basement_sqft: number | null;
  garage_sqft: number | null;
  stories: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  construction_type: string | null;
  improvement_class: string | null;
  improvement_value: number | null;
  market_value_total: number | null;
  market_value_land: number | null;
  market_value_improvement: number | null;
  taxable_value: number | null;
  assessed_value: number | null;
  tax_year: number | null;
  legal_description: string | null;
  plat: string | null;
  lot: string | null;
  block: string | null;
  sales: ParcelSale[];
  raw_data_json: Record<string, string>;
}

export class AssessorError extends Error {}
export class AssessorConfigError extends AssessorError {
  constructor(msg = 'FIRECRAWL_API_KEY not set — assessor lookups unavailable') {
    super(msg); this.name = 'AssessorConfigError';
  }
}
export class AssessorTimeoutError extends AssessorError { name = 'AssessorTimeoutError'; }
export class AssessorHttpError extends AssessorError {
  constructor(public status: number, msg: string) { super(msg); this.name = 'AssessorHttpError'; }
}
export class AssessorParseError extends AssessorError {
  constructor(msg: string, public excerpt?: string) { super(msg); this.name = 'AssessorParseError'; }
}
