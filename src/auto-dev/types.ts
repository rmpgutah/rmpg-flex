export const US_STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
] as const;

export type UsStateCode = (typeof US_STATE_CODES)[number];

export type AutoDevErrorCode =
  | 'INVALID_PLATE_FORMAT'
  | 'INVALID_STATE_CODE'
  | 'PLATE_NOT_FOUND'
  | 'NO_DATA_FOUND';

export interface PlateToVinParams {
  state: string;
  plate: string;
}

export interface PlateToVinResponse {
  vin: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  drivetrain: string;
  engine: string;
  transmission: string;
  isDefault: boolean;
}

export interface AutoDevApiErrorBody {
  status: number;
  error: string;
  code: AutoDevErrorCode;
  path: string;
  requestId: string;
}

export interface PlateToVinClientConfig {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  initialBackoffMs?: number;
  cacheTtlMs?: number;
  maxRequestsPerSecond?: number;
}
