// src/utils/bodycamAiAnalysis.ts
// Pure aggregation logic for POST /personnel/bodycam-videos/:id/analyze —
// combines per-frame Workers AI vision responses into one row-level result.
// Kept as a standalone pure function (no D1/AI dependencies) so it's testable
// with the Node vitest suite, unlike the route itself (Miniflare has no `ai`
// binding — see the design spec's Testing section).
//
// IMPORTANT: every finding this produces is a "potential, review required"
// signal, never a determination. Nothing downstream may treat these fields
// as fact — see the design spec's scope boundary before extending this file.

export interface FrameAnalysis {
  timestamp: number;
  weapon_present: boolean;
  weapon_confidence: number;
  weapon_type: string | null;
  vehicle_present: boolean;
  vehicle_description: string | null;
  scene_type: string | null;
  force_indicators: boolean;
  force_confidence: number;
  officer_safety_flags: string[];
}

export interface AnalysisResult {
  analyzed_at: string;
  frame_count: number;
  weapon: { detected: boolean; max_confidence: number; timestamps: number[] } | null;
  vehicles: { description: string; timestamps: number[] }[];
  scene_types: { type: string; timestamps: number[] }[];
  force_indicators: { timestamps: number[]; max_confidence: number } | null;
  officer_safety_flags: { flag: string; timestamp: number }[];
}

/** Aggregates per-frame analysis into one result. Pure — no clock/random use
 *  except the caller-supplied `analyzedAt` (defaults to '' here; the route
 *  stamps it, since Date.now() must not be called inside this pure function
 *  for testability — see CLAUDE.md conventions on avoiding non-deterministic
 *  calls in shared logic). */
export function aggregateAnalysis(frames: FrameAnalysis[], analyzedAt = ''): AnalysisResult {
  const weaponFrames = frames.filter(f => f.weapon_present);
  const weapon = weaponFrames.length === 0 ? null : {
    detected: true,
    max_confidence: weaponFrames.reduce((m, f) => Math.max(m, f.weapon_confidence), 0),
    timestamps: weaponFrames.map(f => f.timestamp),
  };

  const forceFrames = frames.filter(f => f.force_indicators);
  const force_indicators = forceFrames.length === 0 ? null : {
    timestamps: forceFrames.map(f => f.timestamp),
    max_confidence: forceFrames.reduce((m, f) => Math.max(m, f.force_confidence), 0),
  };

  const vehiclesByDescription = new Map<string, number[]>();
  for (const f of frames) {
    if (!f.vehicle_present || !f.vehicle_description) continue;
    const list = vehiclesByDescription.get(f.vehicle_description) ?? [];
    list.push(f.timestamp);
    vehiclesByDescription.set(f.vehicle_description, list);
  }
  const vehicles = Array.from(vehiclesByDescription, ([description, timestamps]) => ({ description, timestamps }));

  const sceneTypesByType = new Map<string, number[]>();
  for (const f of frames) {
    if (!f.scene_type) continue;
    const list = sceneTypesByType.get(f.scene_type) ?? [];
    list.push(f.timestamp);
    sceneTypesByType.set(f.scene_type, list);
  }
  const scene_types = Array.from(sceneTypesByType, ([type, timestamps]) => ({ type, timestamps }));

  const officer_safety_flags: { flag: string; timestamp: number }[] = [];
  for (const f of frames) {
    for (const flag of f.officer_safety_flags) officer_safety_flags.push({ flag, timestamp: f.timestamp });
  }

  return { analyzed_at: analyzedAt, frame_count: frames.length, weapon, vehicles, scene_types, force_indicators, officer_safety_flags };
}
