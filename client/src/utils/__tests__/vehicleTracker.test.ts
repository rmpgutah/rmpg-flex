import { describe, it, expect } from 'vitest';
import {
  iou, stepTracker, emptyTrackerState, visibleTracks, primaryTrack, type TrackerState,
} from '../vehicleTracker';
import type { Detection } from '../drivingPrediction';

const det = (x: number, y: number, w: number, h: number, score = 0.9, cls = 'car'): Detection => ({ bbox: [x, y, w, h], score, cls });

describe('vehicleTracker — iou', () => {
  it('is 1 for identical boxes, 0 for disjoint', () => {
    expect(iou([0, 0, 10, 10], [0, 0, 10, 10])).toBe(1);
    expect(iou([0, 0, 10, 10], [100, 100, 10, 10])).toBe(0);
  });
  it('is ~0.33 for half-overlapping equal boxes', () => {
    // overlap area 50, union 150
    expect(iou([0, 0, 10, 10], [5, 0, 10, 10])).toBeCloseTo(0.333, 2);
  });
});

describe('vehicleTracker — stepTracker', () => {
  it('creates a track for a new detection and keeps a stable id as it moves', () => {
    let s = emptyTrackerState();
    s = stepTracker(s, [det(100, 100, 40, 30)]);
    expect(s.tracks).toHaveLength(1);
    const id = s.tracks[0].id;
    // move the box a little each frame — IoU stays high → same id
    s = stepTracker(s, [det(104, 101, 40, 30)]);
    s = stepTracker(s, [det(108, 102, 40, 30)]);
    expect(s.tracks).toHaveLength(1);
    expect(s.tracks[0].id).toBe(id);
    expect(s.tracks[0].age).toBe(3);
    expect(s.tracks[0].missed).toBe(0);
    expect(s.tracks[0].trail.length).toBe(3);
  });
  it('smooths the box toward the detection (EMA), not snapping', () => {
    let s = stepTracker(emptyTrackerState(), [det(0, 0, 40, 30)]);
    s = stepTracker(s, [det(20, 0, 40, 30)], { smooth: 0.5 });
    expect(s.tracks[0].bbox[0]).toBeCloseTo(10); // halfway 0→20
  });
  it('coasts through a missed frame, then drops after maxMissed', () => {
    let s = stepTracker(emptyTrackerState(), [det(0, 0, 40, 30)]);
    s = stepTracker(s, [det(10, 0, 40, 30)]);     // velocity ~ +5 (after EMA)
    const id = s.tracks[0].id;
    s = stepTracker(s, [], { maxMissed: 2 });      // miss 1 — coasts
    expect(s.tracks[0].id).toBe(id);
    expect(s.tracks[0].missed).toBe(1);
    expect(s.tracks[0].bbox[0]).toBeGreaterThan(5); // extrapolated forward
    s = stepTracker(s, [], { maxMissed: 2 });      // miss 2
    s = stepTracker(s, [], { maxMissed: 2 });      // miss 3 → exceeds → dropped
    expect(s.tracks).toHaveLength(0);
  });
  it('assigns two ids to two separate vehicles and matches each frame-to-frame', () => {
    let s = stepTracker(emptyTrackerState(), [det(0, 0, 30, 30), det(200, 200, 30, 30)]);
    expect(new Set(s.tracks.map((t) => t.id)).size).toBe(2);
    s = stepTracker(s, [det(205, 202, 30, 30), det(3, 1, 30, 30)]); // swapped order
    expect(s.tracks).toHaveLength(2);
    expect(s.nextId).toBe(3); // no new tracks created
  });
});

describe('vehicleTracker — selection', () => {
  it('visibleTracks shows a fresh detection, keeps a confirmed track, hides a long-coasting ghost', () => {
    let s: TrackerState = stepTracker(emptyTrackerState(), [det(0, 0, 30, 30)]);
    expect(visibleTracks(s)).toHaveLength(1);   // fresh (missed 0) → shown
    s = stepTracker(s, [det(2, 0, 30, 30)]);    // age 2, confirmed
    expect(visibleTracks(s)).toHaveLength(1);
    // coast past the display window → hidden (but not yet dropped from state)
    s = stepTracker(s, []); s = stepTracker(s, []); s = stepTracker(s, []); s = stepTracker(s, []);
    expect(visibleTracks(s, 3)).toHaveLength(0);
  });
  it('primaryTrack favors the large, central, established track', () => {
    let s = emptyTrackerState();
    for (let i = 0; i < 4; i++) s = stepTracker(s, [det(600, 400, 120, 90), det(20, 20, 20, 20)]);
    const p = primaryTrack(s.tracks, 1280, 720);
    expect(p?.bbox[0]).toBe(600);
    expect(primaryTrack([], 1280, 720)).toBeNull();
  });
  it('primaryTrack never tags a pedestrian even if it is the biggest box', () => {
    let s = emptyTrackerState();
    for (let i = 0; i < 4; i++) s = stepTracker(s, [det(500, 400, 200, 300, 0.9, 'person'), det(600, 500, 60, 40, 0.9, 'car')]);
    expect(primaryTrack(s.tracks, 1280, 720)?.cls).toBe('car');
  });
});
