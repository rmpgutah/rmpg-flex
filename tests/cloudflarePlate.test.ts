import { describe, it, expect } from 'vitest';
import { plateResultFromExtraction } from '../src/utils/cloudflarePlate';
import type { ExtractionResult } from '../src/utils/serveIntakeExtract';

const mk = (fields: Record<string, { value: string; confidence: number }>, over: Partial<ExtractionResult> = {}): ExtractionResult => ({
  success: true, documentType: 'license_plate', confidence: 0.8,
  fields, rawText: '', allDates: [], model: 'workers-ai:llama-3.2-11b-vision', ms: 1200, ...over,
});

describe('plateResultFromExtraction', () => {
  it('maps plate + attributes and cleans the plate', () => {
    const r = plateResultFromExtraction(mk({
      plate_number: { value: '8a t 6511', confidence: 0.88 },
      plate_state: { value: 'UT', confidence: 0.7 },
      vehicle_make: { value: 'Ford', confidence: 0.6 },
      vehicle_model: { value: 'Explorer', confidence: 0.6 },
      vehicle_color: { value: 'White', confidence: 0.6 },
      vehicle_year: { value: '2019', confidence: 0.5 },
      plate_type: { value: 'passenger', confidence: 0.5 },
      vehicle_body: { value: 'suv', confidence: 0.5 },
    }));
    expect(r).not.toBeNull();
    expect(r!.plate).toBe('8AT6511');
    expect(r!.state).toBe('UT');
    expect(r!.make).toBe('Ford');
    expect(r!.year).toBe(2019);
    expect(r!.confidence).toBeCloseTo(0.88); // plate-field confidence, not overall
  });

  it('returns null when no plate text is read', () => {
    expect(plateResultFromExtraction(mk({ plate_number: { value: '', confidence: 0 } }))).toBeNull();
    expect(plateResultFromExtraction(null)).toBeNull();
  });

  it('falls back to overall confidence when the plate field has none', () => {
    const r = plateResultFromExtraction(mk(
      { plate_number: { value: 'ABC123', confidence: undefined as unknown as number } },
      { confidence: 0.42 },
    ));
    expect(r!.confidence).toBeCloseTo(0.42);
  });

  it('drops a non-4-digit year', () => {
    const r = plateResultFromExtraction(mk({
      plate_number: { value: 'XYZ789', confidence: 0.9 },
      vehicle_year: { value: 'unknown', confidence: 0.1 },
    }));
    expect(r!.year).toBeNull();
  });
});
