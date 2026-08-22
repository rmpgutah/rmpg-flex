// src/utils/vehicleEnrichment/client.ts
import {
  VehicleEnrichConfigError,
  VehicleEnrichTimeoutError,
  VehicleEnrichHttpError,
} from './types';

const TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new VehicleEnrichTimeoutError(String(init.headers ?? ''), TIMEOUT_MS);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Step 1: Plate + state → VIN via RapidAPI US License Plate to VIN */
export async function plateToVin(
  plate: string,
  state: string,
  apiKey: string,
): Promise<{ vin: string | null }> {
  if (!apiKey) throw new VehicleEnrichConfigError('PLATE_TO_VIN_API_KEY');
  const url = `https://us-license-plate-to-vin.p.rapidapi.com/licenseplate/${encodeURIComponent(plate)}?state=${encodeURIComponent(state)}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'us-license-plate-to-vin.p.rapidapi.com',
    },
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => String(res.status));
    throw new VehicleEnrichHttpError('plateToVin', res.status, msg);
  }
  const json = await res.json() as Record<string, unknown>;
  const vin = typeof json.vin === 'string' && json.vin ? json.vin : null;
  return { vin };
}

/** Step 2: VIN → make/model/year/trim/color/vehicle_type via RapidAPI VIN Decoder */
export async function decodeVin(
  vin: string,
  apiKey: string,
): Promise<{
  make: string | null;
  model: string | null;
  year: number | null;
  trim: string | null;
  color: string | null;
  vehicle_type: string | null;
}> {
  if (!apiKey) throw new VehicleEnrichConfigError('VIN_DECODER_API_KEY');
  const url = `https://vin-decoder7.p.rapidapi.com/vin?vin=${encodeURIComponent(vin)}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'vin-decoder7.p.rapidapi.com',
    },
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => String(res.status));
    throw new VehicleEnrichHttpError('decodeVin', res.status, msg);
  }
  const json = await res.json() as Record<string, unknown>;
  const yearRaw = json.year;
  let year: number | null = null;
  if (typeof yearRaw === 'number' && yearRaw >= 1900 && yearRaw <= 2100) year = yearRaw;
  else if (typeof yearRaw === 'string') {
    const n = parseInt(yearRaw, 10);
    if (!isNaN(n) && n >= 1900 && n <= 2100) year = n;
  }
  return {
    make: typeof json.make === 'string' ? json.make : null,
    model: typeof json.model === 'string' ? json.model : null,
    year,
    trim: typeof json.trim === 'string' ? json.trim : null,
    color: typeof json.color === 'string' ? json.color : null,
    vehicle_type: typeof json.vehicle_type === 'string' ? json.vehicle_type : null,
  };
}

/** Step 3 (fallback): Plate → format/state/metadata via RapidAPI License Plate Decoder */
export async function decodePlate(
  plate: string,
  state: string,
  apiKey: string,
): Promise<{
  make: string | null;
  model: string | null;
  year: number | null;
  vehicle_type: string | null;
}> {
  if (!apiKey) throw new VehicleEnrichConfigError('PLATE_DECODER_API_KEY');
  const url = `https://license-plate-decoder.p.rapidapi.com/v1/plates?plate=${encodeURIComponent(plate)}&state=${encodeURIComponent(state)}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'license-plate-decoder.p.rapidapi.com',
    },
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => String(res.status));
    throw new VehicleEnrichHttpError('decodePlate', res.status, msg);
  }
  const json = await res.json() as Record<string, unknown>;
  const yearRaw = json.year;
  let year: number | null = null;
  if (typeof yearRaw === 'number' && yearRaw >= 1900 && yearRaw <= 2100) year = yearRaw;
  return {
    make: typeof json.make === 'string' ? json.make : null,
    model: typeof json.model === 'string' ? json.model : null,
    year,
    vehicle_type: typeof json.vehicle_type === 'string' ? json.vehicle_type : null,
  };
}
