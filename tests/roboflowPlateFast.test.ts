import { describe, it, expect } from 'vitest';
import { parseFastPlate, fastRunUrl, ROBOFLOW_FAST_WORKFLOW_ID } from '../src/utils/roboflowPlateFast';

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
