// ============================================================
// RMPG Flex — Tactical intel / AI (pure)
// ============================================================
// Wave 4 cores: a pursuit/aggression risk score, driving anomaly detection,
// and a closing-proximity classifier — all derived from the 1Hz telemetry +
// tracker geometry the player already has. Pure + deterministic → unit-tested.
// ============================================================

import { bearingDeg, type GpsPoint, type TrackStats } from './dashcamForensics';
import { angleDelta } from './drivingPrediction';

// ── Aggression / pursuit risk score ──────────────────────────

export type RiskLevel = 'low' | 'elevated' | 'high' | 'severe';
export interface RiskScore { score: number; level: RiskLevel; factors: string[] }

export function riskLevel(score: number): RiskLevel {
  return score >= 75 ? 'severe' : score >= 50 ? 'high' : score >= 25 ? 'elevated' : 'low';
}

/** 0–100 driving-risk/aggression score from telemetry + event type. */
export function aggressionScore(stats: TrackStats, eventType?: string | null, postedLimit?: number | null): RiskScore {
  let score = 0;
  const factors: string[] = [];

  const ref = postedLimit ?? 65;
  const over = stats.maxSpeed - ref;
  if (over > 0) { score += Math.min(42, over * 1.2); if (over > 8) factors.push(`peak ${Math.round(stats.maxSpeed)} mph`); }

  if (stats.maxBrakeG > 0.3) { score += Math.min(25, (stats.maxBrakeG - 0.3) * 120); factors.push(`hard braking ${stats.maxBrakeG.toFixed(2)}g`); }
  if (stats.maxAccelG > 0.3) { score += Math.min(15, (stats.maxAccelG - 0.3) * 80); factors.push(`hard accel ${stats.maxAccelG.toFixed(2)}g`); }

  const range = stats.maxSpeed - stats.minSpeed;
  if (range > 25) { score += Math.min(15, (range - 25) * 0.6); factors.push('erratic speed'); }

  const t = (eventType || '').toLowerCase();
  if (t.includes('collision') || t.includes('fcw')) { score += 12; factors.push('collision warning'); }
  else if (t.includes('lane')) { score += 6; factors.push('lane departure'); }
  else if (t.includes('close follow') || t.includes('tailgat')) { score += 8; factors.push('tailgating'); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, level: riskLevel(score), factors };
}

// ── Anomaly detection ────────────────────────────────────────

export interface Anomaly { key: string; label: string; tSec: number }

/** Driving anomalies over the GPS track: sudden stop, speed spike, swerving. */
export function detectAnomalies(gps: GpsPoint[]): Anomaly[] {
  const out: Anomaly[] = [];
  if (gps.length < 3) return out;
  const t0 = gps[0].timestamp;
  for (let i = 1; i < gps.length; i++) {
    const dt = Math.max(0.1, (gps[i].timestamp - gps[i - 1].timestamp) / 1000);
    const accel = ((gps[i].speed || 0) - (gps[i - 1].speed || 0)) / dt; // mph/s
    const tSec = (gps[i].timestamp - t0) / 1000;
    if (accel <= -18) out.push({ key: 'stop', label: 'Sudden stop', tSec });
    if (accel >= 16) out.push({ key: 'spike', label: 'Speed surge', tSec });
  }
  // Swerving: repeated heading-direction reversals.
  const headings: number[] = [];
  for (let i = 1; i < gps.length; i++) headings.push(bearingDeg(gps[i - 1], gps[i]));
  let reversals = 0;
  for (let i = 2; i < headings.length; i++) {
    const d1 = angleDelta(headings[i - 1], headings[i - 2]);
    const d2 = angleDelta(headings[i], headings[i - 1]);
    if (Math.sign(d1) !== Math.sign(d2) && Math.abs(d1) > 8 && Math.abs(d2) > 8) reversals++;
  }
  if (reversals >= 2) out.push({ key: 'swerve', label: 'Erratic / swerving', tSec: 0 });

  // Dedupe by key (first occurrence wins).
  const seen = new Set<string>();
  return out.filter((a) => (seen.has(a.key) ? false : (seen.add(a.key), true)));
}

// ── Closing-proximity (officer safety) ───────────────────────

export type ProximityLevel = 'none' | 'caution' | 'alert';
export interface Proximity { near: boolean; closing: boolean; level: ProximityLevel; fillPct: number }

/** Classify how near/closing a tracked box is from its frame-area fraction and
 *  growth vs. the previous frame. */
export function proximity(area: number, prevArea: number, frameArea: number): Proximity {
  const fillPct = frameArea > 0 ? area / frameArea : 0;
  const closing = prevArea > 0 && area > prevArea * 1.06;
  const near = fillPct > 0.16;
  const veryNear = fillPct > 0.30;
  const level: ProximityLevel = (veryNear && closing) || fillPct > 0.42 ? 'alert' : (near || closing) ? 'caution' : 'none';
  return { near, closing, level, fillPct };
}
