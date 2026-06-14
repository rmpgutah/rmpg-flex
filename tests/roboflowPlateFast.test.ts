import { describe, it, expect } from 'vitest';
import { parseFastPlate, fastRunUrl, ROBOFLOW_FAST_WORKFLOW_ID, runPlateFast } from '../src/utils/roboflowPlateFast';
import { isQuotaResponse, RoboflowQuotaError } from '../src/utils/roboflowAlpr';

describe('roboflow credit-cap (quota) handling', () => {
  it('isQuotaResponse flags 402 and credit-cap bodies', () => {
    expect(isQuotaResponse(402, '')).toBe(true);
    expect(isQuotaResponse(500, "reason: 'credit_cap_exceeded'")).toBe(true);
    expect(isQuotaResponse(502, 'workspace ran out of credits')).toBe(true);
    expect(isQuotaResponse(500, 'some other error')).toBe(false);
    expect(isQuotaResponse(200, '')).toBe(false);
  });

  it('runPlateFast throws a typed RoboflowQuotaError on a 402 (no retry)', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response('{"message":"credit_cap_exceeded"}', { status: 402 });
    }) as unknown as typeof fetch;
    await expect(runPlateFast({
      image: { type: 'url', value: 'https://x/y.jpg' }, apiKey: 'k', retries: 2, fetchImpl,
    })).rejects.toBeInstanceOf(RoboflowQuotaError);
    expect(calls).toBe(1); // failed fast, did not burn retries on a quota error
  });
});

describe('parseFastPlate', () => {
  it('extracts a plate from a nested OCR output and cleans it', () => {
    const json = { outputs: [{ license_plate_text: [['8A T 6511']], plate_predictions: { predictions: [
      { x: 1, y: 2, width: 3, height: 4, confidence: 0.9, class: 'plate' },
    ] } }] };
    const r = parseFastPlate(json);
    expect(r.plate).toBe('8AT6511');
    expect(r.predictions.length).toBe(1);
    expect(r.predictions[0].confidence).toBe(0.9);
  });

  it('returns null plate when OCR is empty', () => {
    expect(parseFastPlate({ outputs: [{ license_plate_text: '', plate_predictions: {} }] }).plate).toBeNull();
  });

  it('tolerates a bare-array (SDK-unwrapped) envelope', () => {
    expect(parseFastPlate([{ license_plate_text: 'ABC123' }]).plate).toBe('ABC123');
  });

  it('builds the run url for the fast workflow', () => {
    expect(fastRunUrl()).toContain(`/rmpg-utah/workflows/${ROBOFLOW_FAST_WORKFLOW_ID}`);
  });
});
