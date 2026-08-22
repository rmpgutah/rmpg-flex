// src/utils/vehicleEnrichment/types.ts

/** Fields that can be written to vehicles_records via upsertVehicleFromCarxe.
 *  Matches the VehicleFields interface in src/utils/carxe/vehicleRecords.ts. */
export interface VehicleEnrichData {
  vin?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  color?: string | null;
  trim?: string | null;
  body_style?: string | null;
  vehicle_type?: string | null;
  /** Plate identity fields for passing through to upsertVehicleFromCarxe. */
  plate_number?: string | null;
  state?: string | null;
}

export interface EnrichmentResult {
  vehicleId: number;
  fromCache: boolean;
  data: VehicleEnrichData;
  stepsRun: ('plateToVin' | 'decodeVin' | 'decodePlate')[];
  stepErrors: Record<string, string>;
  /** VIN resolved during enrichment, if any. */
  vin?: string;
}

export class VehicleEnrichConfigError extends Error {
  readonly name = 'VehicleEnrichConfigError';
  constructor(public readonly apiKey: string) {
    super(`API key not configured: ${apiKey}`);
  }
}

export class VehicleEnrichTimeoutError extends Error {
  readonly name = 'VehicleEnrichTimeoutError';
  constructor(
    public readonly step: string,
    public readonly timeoutMs: number,
  ) {
    super(`${step} timed out after ${timeoutMs}ms`);
  }
}

export class VehicleEnrichHttpError extends Error {
  readonly name = 'VehicleEnrichHttpError';
  constructor(
    public readonly step: string,
    public readonly status: number,
    message: string,
  ) {
    super(`${step} HTTP ${status}: ${message}`);
  }
}

export class VehicleEnrichRateLimitError extends Error {
  readonly name = 'VehicleEnrichRateLimitError';
  constructor(public readonly api: string) {
    super(`Rate limit reached for API: ${api}`);
  }
}
