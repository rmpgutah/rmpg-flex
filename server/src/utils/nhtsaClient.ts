// ============================================================
// NHTSA (National Highway Traffic Safety Administration) Client
// ============================================================
// Free, open federal APIs — NO credentials, NO registration required.
// Provides: VIN decoding, safety recalls, complaints, safety ratings.
// Docs: https://vpic.nhtsa.dot.gov/api/ | https://api.nhtsa.gov

// ── API Base URLs ────────────────────────────────────────────

const VPIC_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles';
const NHTSA_BASE = 'https://api.nhtsa.gov';

// ── Interfaces ───────────────────────────────────────────────

export interface VinDecodeResult {
  vin: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  bodyClass: string;
  vehicleType: string;
  driveType: string;
  fuelType: string;
  engineCylinders: string;
  engineDisplacement: string;
  engineHP: string;
  transmissionStyle: string;
  doors: string;
  gvwr: string;
  plantCountry: string;
  plantCity: string;
  plantState: string;
  manufacturerName: string;
  errorCode: string;
  errorText: string;
  // Additional NCSA/safety fields from extended decode
  ncsa_make: string;
  ncsa_model: string;
  ncsa_bodyType: string;
  abs: string;
  esc: string;
  tractionControl: string;
  airbagLocFront: string;
  airbagLocSide: string;
  airbagLocCurtain: string;
  seatBelts: string;
}

export interface RecallRecord {
  nhtsaCampaignNumber: string;
  reportReceivedDate: string;
  component: string;
  summary: string;
  consequence: string;
  remedy: string;
  manufacturer: string;
  parkIt: boolean;          // NHTSA "Park It" recall — do not drive
  parkOutside: boolean;     // fire risk — park outside
}

export interface ComplaintRecord {
  odiNumber: string;
  dateComplaintFiled: string;
  dateOfIncident: string;
  numberOfInjuries: number;
  numberOfDeaths: number;
  crash: boolean;
  fire: boolean;
  components: string;
  summary: string;
}

export interface NhtsaResponse<T> {
  success: boolean;
  data: T;
  count: number;
  error?: string;
}

// ── HTTP helper ──────────────────────────────────────────────
// Simple fetch with timeout and error handling.
// No auth needed — these are open federal APIs.

async function nhtsaFetch<T>(url: string, timeoutMs = 10000): Promise<NhtsaResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      return {
        success: false,
        data: [] as unknown as T,
        count: 0,
        error: `NHTSA API returned ${res.status}: ${res.statusText}`,
      };
    }

    const json = await res.json();
    return { success: true, data: json, count: 0 };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { success: false, data: [] as unknown as T, count: 0, error: 'NHTSA API request timed out' };
    }
    return { success: false, data: [] as unknown as T, count: 0, error: err.message || 'Unknown error' };
  } finally {
    clearTimeout(timer);
  }
}

// ── VIN Decoder ──────────────────────────────────────────────
// Uses the extended decode for maximum vehicle detail.

export async function decodeVin(vin: string): Promise<NhtsaResponse<VinDecodeResult>> {
  const url = `${VPIC_BASE}/DecodeVinValuesExtended/${encodeURIComponent(vin)}?format=json`;
  const raw = await nhtsaFetch<any>(url);

  if (!raw.success || !raw.data?.Results?.[0]) {
    return { success: false, data: {} as VinDecodeResult, count: 0, error: raw.error || 'No results from VIN decode' };
  }

  const r = raw.data.Results[0];

  // Map the 100+ NHTSA fields to our clean interface
  const decoded: VinDecodeResult = {
    vin:                  vin.toUpperCase(),
    year:                 r.ModelYear || '',
    make:                 r.Make || '',
    model:                r.Model || '',
    trim:                 r.Trim || '',
    bodyClass:            r.BodyClass || '',
    vehicleType:          r.VehicleType || '',
    driveType:            r.DriveType || '',
    fuelType:             r.FuelTypePrimary || '',
    engineCylinders:      r.EngineCylinders || '',
    engineDisplacement:   r.DisplacementL ? `${r.DisplacementL}L` : '',
    engineHP:             r.EngineHP || '',
    transmissionStyle:    r.TransmissionStyle || '',
    doors:                r.Doors || '',
    gvwr:                 r.GVWR || '',
    plantCountry:         r.PlantCountry || '',
    plantCity:            r.PlantCity || '',
    plantState:           r.PlantState || '',
    manufacturerName:     r.Manufacturer || '',
    errorCode:            r.ErrorCode || '0',
    errorText:            r.ErrorText || '',
    // Safety equipment (from extended decode)
    ncsa_make:            r.NCSAMake || '',
    ncsa_model:           r.NCSAModel || '',
    ncsa_bodyType:        r.NCSABodyType || '',
    abs:                  r.ABS || '',
    esc:                  r.ESC || '',
    tractionControl:      r.TractionControl || '',
    airbagLocFront:       r.AirBagLocFront || '',
    airbagLocSide:        r.AirBagLocSide || '',
    airbagLocCurtain:     r.AirBagLocCurtain || '',
    seatBelts:            r.SeatBeltsAll || '',
  };

  // NHTSA error codes: 0 = success, 1 = VIN decoded with some issues
  // 5 and higher = significant errors
  const hasError = parseInt(decoded.errorCode) >= 5;

  return {
    success: !hasError,
    data: decoded,
    count: 1,
    error: hasError ? decoded.errorText : undefined,
  };
}

// ── Recalls Lookup ───────────────────────────────────────────
// Queries by make/model/year (derived from VIN decode or provided directly).

export async function getRecalls(make: string, model: string, modelYear: string): Promise<NhtsaResponse<RecallRecord[]>> {
  const url = `${NHTSA_BASE}/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(modelYear)}`;
  const raw = await nhtsaFetch<any>(url);

  if (!raw.success) {
    return { success: false, data: [], count: 0, error: raw.error };
  }

  const results = raw.data?.results || [];
  const recalls: RecallRecord[] = results.map((r: any) => ({
    nhtsaCampaignNumber:  r.NHTSACampaignNumber || '',
    reportReceivedDate:   r.ReportReceivedDate || '',
    component:            r.Component || '',
    summary:              r.Summary || '',
    consequence:          r.Consequence || '',
    remedy:               r.Remedy || '',
    manufacturer:         r.Manufacturer || '',
    parkIt:               r.ParkIt === true || r.ParkIt === 'true',
    parkOutside:          r.ParkOutside === true || r.ParkOutside === 'true',
  }));

  return { success: true, data: recalls, count: recalls.length };
}

// ── Complaints Lookup ────────────────────────────────────────

export async function getComplaints(make: string, model: string, modelYear: string): Promise<NhtsaResponse<ComplaintRecord[]>> {
  const url = `${NHTSA_BASE}/complaints/complaintsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(modelYear)}`;
  const raw = await nhtsaFetch<any>(url);

  if (!raw.success) {
    return { success: false, data: [], count: 0, error: raw.error };
  }

  const results = raw.data?.results || [];
  const complaints: ComplaintRecord[] = results.map((r: any) => ({
    odiNumber:           r.odiNumber || '',
    dateComplaintFiled:  r.dateComplaintFiled || '',
    dateOfIncident:      r.dateOfIncident || '',
    numberOfInjuries:    parseInt(r.numberOfInjuries) || 0,
    numberOfDeaths:      parseInt(r.numberOfDeaths) || 0,
    crash:               r.crash === true || r.crash === 'true' || r.crash === 'Yes',
    fire:                r.fire === true || r.fire === 'true' || r.fire === 'Yes',
    components:          r.components || '',
    summary:             r.summary || '',
  }));

  return { success: true, data: complaints, count: complaints.length };
}

// ── Full VIN Report (decode + recalls + complaints) ──────────
// Single call that decodes a VIN then fetches recalls and complaints.

export interface FullVinReport {
  vehicle: VinDecodeResult;
  recalls: RecallRecord[];
  complaints: ComplaintRecord[];
  recallCount: number;
  complaintCount: number;
  hasParkItRecall: boolean;     // Critical safety flag
  hasFireRisk: boolean;         // Fire-related recall or complaint
}

export async function getFullVinReport(vin: string): Promise<NhtsaResponse<FullVinReport>> {
  // Step 1: Decode the VIN
  const vinResult = await decodeVin(vin);
  if (!vinResult.success || !vinResult.data.make) {
    return {
      success: false,
      data: {} as FullVinReport,
      count: 0,
      error: vinResult.error || 'Could not decode VIN',
    };
  }

  const { make, model, year } = vinResult.data;

  // Step 2: Fetch recalls and complaints in parallel
  const [recallResult, complaintResult] = await Promise.all([
    getRecalls(make, model, year),
    getComplaints(make, model, year),
  ]);

  const recalls = recallResult.success ? recallResult.data : [];
  const complaints = complaintResult.success ? complaintResult.data : [];

  const report: FullVinReport = {
    vehicle: vinResult.data,
    recalls,
    complaints,
    recallCount: recalls.length,
    complaintCount: complaints.length,
    hasParkItRecall: recalls.some(r => r.parkIt),
    hasFireRisk: recalls.some(r => r.parkOutside) || complaints.some(c => c.fire),
  };

  return { success: true, data: report, count: 1 };
}
