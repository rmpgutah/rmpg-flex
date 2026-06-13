import { describe, it, expect } from 'vitest';
import { writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runAlprVehicleCapture,
  buildAlprRequest,
  unwrapOutputs,
  asImageOutput,
  asDetections,
  normalizeCapture,
  parseVehicles,
  parseAlprResponse,
  alprRunUrl,
  stripDataUri,
  RoboflowConfigError,
  RoboflowHttpError,
  RoboflowTimeoutError,
  ROBOFLOW_WORKSPACE,
  ROBOFLOW_WORKFLOW_ID,
} from '../src/utils/roboflowAlpr';

// A valid 1x1 transparent PNG (starts with the PNG base64 magic prefix).
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// ─────────────────────────────────────────────────────────────
// Fixture modeled on the REAL workflow response, grounded 2026-06-13 via
// `workflows_get` for alpr-vehicle-details-capture-1781360579827. Output
// names + the `vehicle_details` / `enhanced_alpr_record` shapes are taken
// from the workflow's declared `outputs[]` and OpenAI-block `output_structure`.
// (The live `workflows_run` response — 73 outputs incl. base64 images —
// overflows the MCP serializer, so the declared structure is authoritative.)
// ─────────────────────────────────────────────────────────────
function fixtureResponse() {
  return {
    outputs: [
      {
        license_plate_text: '8XYZ123',
        vehicle_count: 1,
        vehicle_details: {
          license_plate_text: '8XYZ123',
          license_plate_state_or_region: 'Utah',
          plate_type: 'passenger',
          vehicle_type: 'sedan',
          make: 'Toyota',
          model: 'Camry',
          trim_or_badging: null,
          year_range: '2018-2020',
          color_primary: 'silver',
          color_secondary: null,
          orientation: 'rear',
        },
        enhanced_alpr_record: {
          vehicles: [
            { detection_index: 0, license_plate_text: '8XYZ123', field_confidence: { plate: 0.93, make: 0.8 } },
          ],
          summary: 'Silver Toyota Camry, plate 8XYZ123.',
        },
        risk_score: 12,
        risk_level: 'low',
        review_required: false,
        review_lane: 'auto_cleared',
        watchlist_hit: false,
        alert_required: false,
        data_quality_score: 88,
        car_predictions: {
          predictions: [{ x: 200, y: 150, width: 300, height: 200, confidence: 0.97, class: 'car', class_id: 0, detection_id: 'car-1' }],
        },
        license_predictions: {
          predictions: [{ x: 320, y: 210, width: 140, height: 48, confidence: 0.93, class: 'license_plate', class_id: 0, detection_id: 'lp-1', points: [{ x: 1, y: 2 }] }],
        },
        output_image: PNG_1x1,
        enhanced_image: PNG_1x1,
        claude_investigation_report: 'Executive summary: '.padEnd(900, 'x'), // long → excluded from rawScalars
      },
    ],
  };
}

describe('roboflowAlpr — smoke test (runs the function on one sample image)', () => {
  it('runs the workflow and surfaces the real output keys', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const fakeFetch: typeof fetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify(fixtureResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const result = await runAlprVehicleCapture({
      apiKey: 'test-key',
      image: { type: 'url', value: 'https://example.com/car.jpg' },
      parameters: { case_id: 'CASE-1', plate_confidence_threshold: '0.75', disable_alerts: 'true' },
      fetchImpl: fakeFetch,
      sleep: async () => {},
    });

    // The request went to the correct serverless workflow endpoint with key + image.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `https://serverless.roboflow.com/${ROBOFLOW_WORKSPACE}/workflows/${ROBOFLOW_WORKFLOW_ID}`,
    );
    expect(calls[0].body.api_key).toBe('test-key');
    expect(calls[0].body.inputs.image).toEqual({ type: 'url', value: 'https://example.com/car.jpg' });
    expect(calls[0].body.inputs.case_id).toBe('CASE-1');

    // Expected (real) output keys exist — the core smoke assertion.
    expect(result.imageEntries).toBe(1);
    expect(result.outputKeys).toEqual(
      expect.arrayContaining(['license_plate_text', 'vehicle_details', 'enhanced_alpr_record', 'car_predictions', 'output_image']),
    );

    // Capture normalized from the real shapes.
    expect(result.capture.plate).toBe('8XYZ123');              // license_plate_text
    expect(result.capture.state).toBe('Utah');                 // vehicle_details.license_plate_state_or_region
    expect(result.capture.make).toBe('Toyota');                // vehicle_details.make
    expect(result.capture.model).toBe('Camry');
    expect(result.capture.color).toBe('silver');               // color_primary
    expect(result.capture.year).toBe(2018);                    // parsed from year_range "2018-2020"
    expect(result.capture.vehicleType).toBe('sedan');
    expect(result.capture.confidence).toBeCloseTo(0.93);       // enhanced_alpr_record.vehicles[0].field_confidence.plate
    expect(result.capture.riskScore).toBe(12);
    expect(result.capture.reviewStatus).toBe('auto_cleared');  // review_lane
    expect(result.capture.alerted).toBe(false);

    // rawScalars keeps small scalars, excludes the long LLM report.
    expect(result.capture.rawScalars.risk_level).toBe('low');
    expect(result.capture.rawScalars.vehicle_count).toBe(1);
    expect(result.capture.rawScalars).not.toHaveProperty('claude_investigation_report');

    // Structured records preserved.
    expect((result.records.vehicle_details as any).make).toBe('Toyota');

    // All vehicles parsed (one here, from enhanced_alpr_record.vehicles[]).
    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0].plate).toBe('8XYZ123');
    expect(result.vehicles[0].confidence).toBeCloseTo(0.93);

    // Detections from both detection outputs; polygon points stripped.
    expect(result.detections).toHaveLength(2);
    const lp = result.detections.find((d) => d.class === 'license_plate');
    expect(lp?.bbox).toEqual({ x: 320, y: 210, width: 140, height: 48 });
    expect(lp).not.toHaveProperty('points');

    // Both visualization images surfaced as base64.
    expect(result.images.map((i) => i.outputName).sort()).toEqual(['enhanced_image', 'output_image']);
  });

  it('decodes an image output to disk without logging it', async () => {
    const result = parseAlprResponse(fixtureResponse());
    expect(result.images.length).toBeGreaterThan(0);
    const img = result.images[0];
    expect(img.mimeType).toBe('image/png');
    expect(img.bytes).toBeGreaterThan(0);

    // Decode + write to disk (Worker route does the R2 equivalent).
    const out = join(tmpdir(), `alpr-smoke-${img.bytes}.${img.ext}`);
    try {
      writeFileSync(out, Buffer.from(img.base64, 'base64'));
      expect(existsSync(out)).toBe(true);
      expect(statSync(out).size).toBeGreaterThan(0);
    } finally {
      rmSync(out, { force: true });
    }
  });
});

describe('buildAlprRequest', () => {
  it('builds the correct serverless url + body', () => {
    const { url, body } = buildAlprRequest({
      apiKey: 'k', image: { type: 'url', value: 'https://x/y.jpg' }, parameters: { case_id: 'C1' },
    });
    expect(url).toBe(alprRunUrl());
    expect(body).toEqual({ api_key: 'k', inputs: { image: { type: 'url', value: 'https://x/y.jpg' }, case_id: 'C1' } });
  });
  it('throws RoboflowConfigError on missing key', () => {
    expect(() => buildAlprRequest({ apiKey: '', image: { type: 'url', value: 'https://x/y.jpg' } }))
      .toThrow(RoboflowConfigError);
  });
  it('throws RoboflowConfigError on http (non-https) url', () => {
    expect(() => buildAlprRequest({ apiKey: 'k', image: { type: 'url', value: 'http://x/y.jpg' } }))
      .toThrow(/https/);
  });
  it('strips a data: prefix from base64 images', () => {
    const { body } = buildAlprRequest({ apiKey: 'k', image: { type: 'base64', value: 'data:image/png;base64,AAAB' } });
    expect((body.inputs.image as any).value).toBe('AAAB');
  });
  it('drops null/undefined parameters but keeps string flags', () => {
    const { body } = buildAlprRequest({
      apiKey: 'k', image: { type: 'url', value: 'https://x/y.jpg' },
      parameters: { case_id: 'C1', subject_id: undefined, jurisdiction: null, disable_alerts: 'false' },
    });
    expect(body.inputs).toHaveProperty('case_id');
    expect(body.inputs).not.toHaveProperty('subject_id');
    expect(body.inputs).not.toHaveProperty('jurisdiction');
    expect(body.inputs.disable_alerts).toBe('false'); // string flag kept
  });
});

describe('unwrapOutputs (tolerant envelope handling)', () => {
  it('handles { outputs: [...] }', () => {
    expect(unwrapOutputs({ outputs: [{ a: 1 }] })).toEqual([{ a: 1 }]);
  });
  it('handles a bare top-level array (SDK-unwrapped)', () => {
    expect(unwrapOutputs([{ a: 1 }])).toEqual([{ a: 1 }]);
  });
  it('handles { result: [...] } defensively', () => {
    expect(unwrapOutputs({ result: [{ a: 1 }] })).toEqual([{ a: 1 }]);
  });
  it('returns [] for junk', () => {
    expect(unwrapOutputs(null)).toEqual([]);
    expect(unwrapOutputs('nope')).toEqual([]);
  });
});

describe('asImageOutput', () => {
  it('recognizes a bare base64 PNG', () => {
    const img = asImageOutput('output_image', PNG_1x1);
    expect(img?.mimeType).toBe('image/png');
  });
  it('recognizes a { type:"base64", value } wrapper', () => {
    const img = asImageOutput('output_image', { type: 'base64', value: PNG_1x1 });
    expect(img?.ext).toBe('png');
  });
  it('returns null for plain text', () => {
    expect(asImageOutput('license_plate_text', 'ABC123')).toBeNull();
  });
});

describe('asDetections', () => {
  it('parses predictions and strips points', () => {
    const dets = asDetections('license_predictions', {
      predictions: [{ x: 1, y: 2, width: 3, height: 4, confidence: 0.5, class: 'car', points: [{ x: 0, y: 0 }] }],
    });
    expect(dets).toHaveLength(1);
    expect(dets[0]).not.toHaveProperty('points');
    expect(dets[0].bbox).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });
  it('ignores non-detection objects', () => {
    expect(asDetections('vehicle_details', { make: 'Toyota' })).toEqual([]);
  });
});

describe('normalizeCapture (grounded to real output shapes)', () => {
  it('reads license_plate_text + the vehicle_details dict', () => {
    const cap = normalizeCapture({
      license_plate_text: '7abc 123',
      vehicle_details: { make: 'Ford', model: 'F-150', color_primary: 'white', year_range: '2021', license_plate_state_or_region: 'UT', vehicle_type: 'pickup' },
      misc_scalar: 'keep',
    });
    expect(cap.plate).toBe('7ABC123'); // uppercased, spaces stripped
    expect(cap.make).toBe('Ford');
    expect(cap.model).toBe('F-150');
    expect(cap.color).toBe('white');
    expect(cap.year).toBe(2021);
    expect(cap.state).toBe('UT');
    expect(cap.vehicleType).toBe('pickup');
    expect(cap.rawScalars.misc_scalar).toBe('keep');
  });
  it('handles vehicle_details delivered as a JSON string', () => {
    const cap = normalizeCapture({ vehicle_details: JSON.stringify({ make: 'Honda', color_primary: 'blue' }) });
    expect(cap.make).toBe('Honda');
    expect(cap.color).toBe('blue');
  });
  it('flags alerts on watchlist_hit / alert_required', () => {
    expect(normalizeCapture({ watchlist_hit: true }).alerted).toBe(true);
    expect(normalizeCapture({ alert_required: 'true' }).alerted).toBe(true);
    expect(normalizeCapture({ watchlist_hit: false, alert_required: false }).alerted).toBe(false);
  });
  it('falls back to key heuristics when named outputs are absent', () => {
    const cap = normalizeCapture({ some_plate_field: 'ZZ9 999', a_state: 'NV' });
    expect(cap.plate).toBe('ZZ9999');
    expect(cap.state).toBe('NV');
  });
});

describe('parseVehicles (every vehicle in the frame)', () => {
  it('extracts all vehicles from enhanced_alpr_record.vehicles[]', () => {
    const vehicles = parseVehicles({
      enhanced_alpr_record: {
        vehicles: [
          { license_plate_text: 'ABC123', make: 'Toyota', color_primary: 'red', field_confidence: { plate: 0.9 } },
          { license_plate_text: 'XYZ789', make: 'Ford', color_primary: 'blue', year_range: '2015', field_confidence: { plate: 0.7 } },
        ],
      },
    });
    expect(vehicles).toHaveLength(2);
    expect(vehicles.map((v) => v.plate).sort()).toEqual(['ABC123', 'XYZ789']);
    expect(vehicles.find((v) => v.plate === 'XYZ789')?.year).toBe(2015);
  });
  it('dedupes the same plate, keeping the highest-confidence read', () => {
    const vehicles = parseVehicles({
      enhanced_alpr_record: {
        vehicles: [
          { license_plate_text: 'DUP 111', make: 'Honda', field_confidence: { plate: 0.4 } },
          { license_plate_text: 'DUP111', make: 'Honda', color_primary: 'gray', field_confidence: { plate: 0.95 } },
        ],
      },
    });
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].plate).toBe('DUP111');
    expect(vehicles[0].confidence).toBeCloseTo(0.95);
    expect(vehicles[0].color).toBe('gray');
  });
  it('falls back to vehicle_details when there is no vehicles[] list', () => {
    const vehicles = parseVehicles({ vehicle_details: { license_plate_text: 'SOLO1', make: 'Tesla' } });
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].plate).toBe('SOLO1');
    expect(vehicles[0].make).toBe('Tesla');
  });
  it('falls back to a bare license_plate_text', () => {
    expect(parseVehicles({ license_plate_text: 'BARE 9' })[0].plate).toBe('BARE9');
  });
  it('returns [] when no vehicle data is present', () => {
    expect(parseVehicles({ risk_score: 0 })).toEqual([]);
  });
});

describe('runAlprVehicleCapture — error & retry handling', () => {
  const img = { type: 'url', value: 'https://x/y.jpg' } as const;

  it('retries a 500 then succeeds', async () => {
    let n = 0;
    const fetchImpl: typeof fetch = (async () => {
      n++;
      return n === 1
        ? new Response('boom', { status: 500 })
        : new Response(JSON.stringify({ outputs: [{ license_plate_text: 'AAA111' }] }), { status: 200 });
    }) as any;
    const r = await runAlprVehicleCapture({ apiKey: 'k', image: img, fetchImpl, sleep: async () => {} });
    expect(n).toBe(2);
    expect(r.capture.plate).toBe('AAA111');
  });

  it('does not retry a 400 and throws RoboflowHttpError', async () => {
    let n = 0;
    const fetchImpl: typeof fetch = (async () => { n++; return new Response('bad', { status: 400 }); }) as any;
    await expect(runAlprVehicleCapture({ apiKey: 'k', image: img, fetchImpl, sleep: async () => {} }))
      .rejects.toBeInstanceOf(RoboflowHttpError);
    expect(n).toBe(1);
  });

  it('maps an aborted request to RoboflowTimeoutError', async () => {
    const fetchImpl: typeof fetch = (async () => {
      const e = new Error('aborted'); (e as any).name = 'AbortError'; throw e;
    }) as any;
    await expect(runAlprVehicleCapture({ apiKey: 'k', image: img, retries: 0, fetchImpl, sleep: async () => {} }))
      .rejects.toBeInstanceOf(RoboflowTimeoutError);
  });
});

// Live integration test — skipped unless a real key is present, so CI stays
// hermetic. Run locally with ROBOFLOW_API_KEY=… to exercise the real endpoint.
describe.skipIf(!process.env.ROBOFLOW_API_KEY)('roboflowAlpr — live', () => {
  it('runs the real workflow and returns a non-empty outputs array', async () => {
    const result = await runAlprVehicleCapture({
      apiKey: process.env.ROBOFLOW_API_KEY!,
      image: { type: 'url', value: 'https://media.roboflow.com/inference/license_plate_1.jpg' },
      parameters: { case_id: 'SMOKE', disable_rmpgutah_api: 'true', disable_alerts: 'true', enable_plate_research: 'false' },
    });
    expect(result.imageEntries).toBeGreaterThan(0);
    expect(result.outputKeys.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log('[live] real output keys:', result.outputKeys.join(', '));
  });
});

describe('helpers', () => {
  it('stripDataUri passes through bare base64', () => {
    expect(stripDataUri('AAAB')).toBe('AAAB');
  });
});
