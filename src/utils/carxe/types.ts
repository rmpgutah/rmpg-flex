// src/utils/carxe/types.ts
// ============================================================
// RMPG Flex — CarsXE integration: response types
// ============================================================
// Shapes confirmed against carsxe.com/docs (2026-07-30). Fields not used
// by this integration are typed loosely (Record<string, unknown>) rather
// than exhaustively modeled — CarsXE's response shape varies by country
// for plate-decoder and by data availability for the others.
// ============================================================

export interface CarxePlateResult {
  success: boolean;
  input: { plate: string; country?: string; state?: string };
  description?: string;
  make?: string;
  model?: string;
  trim?: string;
  vin?: string;
  style?: string;
  year?: string;
  color?: string;
  body_style?: string;
  [key: string]: unknown;
}

export interface CarxeSpecsResult {
  success: boolean;
  input: { vin: string };
  attributes?: Record<string, unknown>;
  colors?: Array<Record<string, unknown>>;
  equipment?: Record<string, unknown>;
  warranties?: Array<Record<string, unknown>>;
  timestamp?: string;
  [key: string]: unknown;
}

export interface CarxeLienTheftEvent {
  event: string;
  location?: string;
  lienholder?: string;
  date?: string;
  details_list?: string[];
}

export interface CarxeLienTheftResult {
  success: boolean;
  input: { vin: string };
  year?: number;
  make?: string;
  model?: string;
  type?: string;
  events: CarxeLienTheftEvent[];
  [key: string]: unknown;
}

export interface CarxeHistoryResult {
  vin: string;
  success: boolean;
  junkAndSalvageInformation?: unknown[];
  insuranceInformation?: unknown[];
  brandsRecordCount?: number;
  brandsInformation?: unknown[];
  vinChanged?: boolean;
  currentTitleInformation?: unknown[];
  historyInformation?: unknown[];
  status?: string;
  error?: unknown;
  [key: string]: unknown;
}
