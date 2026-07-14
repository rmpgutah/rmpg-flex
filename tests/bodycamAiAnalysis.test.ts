import { describe, it, expect } from 'vitest';
import { aggregateAnalysis, type FrameAnalysis } from '../src/utils/bodycamAiAnalysis';

describe('aggregateAnalysis', () => {
  it('aggregates weapon detections across frames with max confidence and all timestamps', () => {
    const frames: FrameAnalysis[] = [
      { timestamp: 5, weapon_present: false, weapon_confidence: 0.1, weapon_type: null, vehicle_present: false, vehicle_description: null, scene_type: null, force_indicators: false, force_confidence: 0, officer_safety_flags: [] },
      { timestamp: 13, weapon_present: true, weapon_confidence: 0.62, weapon_type: 'firearm', vehicle_present: false, vehicle_description: null, scene_type: null, force_indicators: false, force_confidence: 0, officer_safety_flags: [] },
      { timestamp: 21, weapon_present: true, weapon_confidence: 0.81, weapon_type: 'firearm', vehicle_present: false, vehicle_description: null, scene_type: null, force_indicators: false, force_confidence: 0, officer_safety_flags: [] },
    ];
    const result = aggregateAnalysis(frames);
    expect(result.frame_count).toBe(3);
    expect(result.weapon).toEqual({ detected: true, max_confidence: 0.81, timestamps: [13, 21] });
  });

  it('returns null weapon/force blocks when nothing crosses the detected threshold', () => {
    const frames: FrameAnalysis[] = [
      { timestamp: 5, weapon_present: false, weapon_confidence: 0, weapon_type: null, vehicle_present: false, vehicle_description: null, scene_type: null, force_indicators: false, force_confidence: 0, officer_safety_flags: [] },
    ];
    const result = aggregateAnalysis(frames);
    expect(result.weapon).toBeNull();
    expect(result.force_indicators).toBeNull();
    expect(result.vehicles).toEqual([]);
    expect(result.scene_types).toEqual([]);
    expect(result.officer_safety_flags).toEqual([]);
  });

  it('groups vehicle descriptions and scene types, collecting timestamps per distinct value', () => {
    const frames: FrameAnalysis[] = [
      { timestamp: 2, weapon_present: false, weapon_confidence: 0, weapon_type: null, vehicle_present: true, vehicle_description: 'dark sedan', scene_type: 'traffic stop', force_indicators: false, force_confidence: 0, officer_safety_flags: [] },
      { timestamp: 9, weapon_present: false, weapon_confidence: 0, weapon_type: null, vehicle_present: true, vehicle_description: 'dark sedan', scene_type: 'traffic stop', force_indicators: false, force_confidence: 0, officer_safety_flags: [] },
      { timestamp: 16, weapon_present: false, weapon_confidence: 0, weapon_type: null, vehicle_present: true, vehicle_description: 'white pickup truck', scene_type: null, force_indicators: false, force_confidence: 0, officer_safety_flags: [] },
    ];
    const result = aggregateAnalysis(frames);
    expect(result.vehicles).toEqual([
      { description: 'dark sedan', timestamps: [2, 9] },
      { description: 'white pickup truck', timestamps: [16] },
    ]);
    expect(result.scene_types).toEqual([{ type: 'traffic stop', timestamps: [2, 9] }]);
  });

  it('collects officer_safety_flags with their originating timestamp, one entry per flag occurrence', () => {
    const frames: FrameAnalysis[] = [
      { timestamp: 4, weapon_present: false, weapon_confidence: 0, weapon_type: null, vehicle_present: false, vehicle_description: null, scene_type: null, force_indicators: false, force_confidence: 0, officer_safety_flags: ['running'] },
      { timestamp: 12, weapon_present: false, weapon_confidence: 0, weapon_type: null, vehicle_present: false, vehicle_description: null, scene_type: null, force_indicators: false, force_confidence: 0, officer_safety_flags: ['struggle', 'weapon_draw'] },
    ];
    const result = aggregateAnalysis(frames);
    expect(result.officer_safety_flags).toEqual([
      { flag: 'running', timestamp: 4 },
      { flag: 'struggle', timestamp: 12 },
      { flag: 'weapon_draw', timestamp: 12 },
    ]);
  });
});
