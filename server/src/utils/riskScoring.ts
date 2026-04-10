import { getDb } from '../models/database';

const INCIDENT_RISK: Record<string, number> = {
  shooting: 30, shots_fired: 30,
  armed_robbery: 28, robbery: 22,
  stabbing: 28, assault_deadly_weapon: 28,
  homicide: 30, attempted_murder: 30,
  officer_assist: 25, officer_down: 30,
  domestic_violence: 22, domestic_disturbance: 18,
  assault: 18, battery: 16,
  burglary_in_progress: 20, burglary: 14,
  vehicle_pursuit: 22, foot_pursuit: 20,
  barricaded_subject: 25, hostage: 30,
  active_shooter: 30,
  mental_health_crisis: 16, suicide_attempt: 20,
  drug_activity: 14, drug_overdose: 18,
  dui: 12, traffic_accident: 10, traffic_accident_injuries: 16,
  disturbance: 10, noise_complaint: 4,
  suspicious_activity: 8, suspicious_person: 8, suspicious_vehicle: 6,
  trespassing: 6, vandalism: 6,
  theft: 8, shoplifting: 6,
  alarm: 6, welfare_check: 8,
  parking_complaint: 2, civil_matter: 2,
  information: 2, assist_citizen: 4,
  patrol: 2, follow_up: 4,
};

export function computeRiskScore(callId: number): number {
  const db = getDb();
  const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(callId) as any;
  if (!call) return 0;

  let score = 0;

  // 1. Incident type base score (0-30)
  const incidentType = (call.incident_type || '').toLowerCase().replace(/[\s-]/g, '_');
  score += INCIDENT_RISK[incidentType] ?? 8;

  // 2. Location history (0-25)
  if (call.location_address) {
    const history = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN weapons_involved = 1 THEN 1 ELSE 0 END) as weapons_calls,
        SUM(CASE WHEN domestic_violence = 1 THEN 1 ELSE 0 END) as dv_calls,
        SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END) as p1_calls
      FROM calls_for_service
      WHERE location_address = ? AND id != ? AND created_at >= datetime('now', 'localtime', '-365 days')
    `).get(call.location_address, callId) as any;

    if (history) {
      score += Math.min(10, Math.floor(history.total / 2));
      score += Math.min(5, (history.weapons_calls || 0) * 3);
      score += Math.min(5, (history.dv_calls || 0) * 2);
      score += Math.min(5, (history.p1_calls || 0) * 2);
    }
  }

  // 3. Time-of-day (0-10)
  const hour = new Date().getHours();
  const nightTypes = ['assault', 'domestic', 'disturbance', 'suspicious', 'dui', 'robbery', 'shooting', 'stabbing'];
  const isNight = hour >= 22 || hour < 5;
  if (isNight && nightTypes.some(t => incidentType.includes(t))) {
    score += 10;
  } else if (hour >= 18 || hour < 6) {
    score += 4;
  } else {
    score += 2;
  }

  // 4. Flags (0-20, capped)
  let flagPoints = 0;
  if (call.weapons_involved) flagPoints += 10;
  if (call.domestic_violence) flagPoints += 5;
  if (call.mental_health_crisis) flagPoints += 5;
  if (call.injuries_reported) flagPoints += 5;
  if (call.felony_in_progress) flagPoints += 10;
  if (call.officer_safety_caution) flagPoints += 5;
  if (call.gang_related) flagPoints += 5;
  if (call.vehicle_pursuit) flagPoints += 8;
  if (call.foot_pursuit) flagPoints += 6;
  score += Math.min(20, flagPoints);

  // 5. Priority (0-15)
  if (call.priority === 'P1') score += 15;
  else if (call.priority === 'P2') score += 10;
  else if (call.priority === 'P3') score += 5;

  return Math.max(1, Math.min(100, score));
}
