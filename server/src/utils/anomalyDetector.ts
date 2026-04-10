import { getDb } from '../models/database';
import { broadcast } from './websocket';
import { createNotification } from '../routes/notifications';

let anomalyInterval: ReturnType<typeof setInterval> | null = null;

export function startAnomalyDetector(intervalMs = 60000): void {
  if (anomalyInterval) return;
  console.log(`[anomaly] Starting anomaly detector (every ${intervalMs / 1000}s)`);
  anomalyInterval = setInterval(() => runDetectors(), intervalMs);
  // Run once immediately after a short delay to let DB settle
  setTimeout(() => runDetectors(), 5000);
}

export function stopAnomalyDetector(): void {
  if (anomalyInterval) {
    clearInterval(anomalyInterval);
    anomalyInterval = null;
  }
}

function runDetectors(): void {
  try {
    detectCallSpikes();
    detectOfficerStillness();
    detectCrimeSeries();
  } catch (e) {
    console.error('[anomaly] Detector cycle error:', e);
  }
}

function createAlert(alertType: string, severity: string, title: string, details: string, zoneBeat?: string): void {
  const db = getDb();

  // Check for recent duplicate (same type + title within 30 min)
  const recent = db.prepare(`
    SELECT id FROM anomaly_alerts
    WHERE alert_type = ? AND title = ? AND created_at >= datetime('now', 'localtime', '-30 minutes')
  `).get(alertType, title) as any;
  if (recent) return;

  const result = db.prepare(`
    INSERT INTO anomaly_alerts (alert_type, severity, title, details, zone_beat)
    VALUES (?, ?, ?, ?, ?)
  `).run(alertType, severity, title, details, zoneBeat || null);

  const alert = db.prepare('SELECT * FROM anomaly_alerts WHERE id = ?').get(result.lastInsertRowid);

  // Broadcast to all dispatch users
  broadcast('dispatch', 'anomaly_alert', alert);

  // Notify dispatchers and supervisors
  const staff = db.prepare(
    "SELECT id FROM users WHERE role IN ('admin', 'supervisor', 'dispatcher') AND status = 'active'"
  ).all() as any[];
  for (const user of staff) {
    createNotification(
      user.id, 'anomaly_alert', title, details,
      'anomaly_alert', result.lastInsertRowid as number,
      severity === 'critical' ? 'critical' : severity === 'high' ? 'high' : 'normal'
    );
  }
}

// Detector 1: Call Spike — last-hour call count per zone vs 30-day average
function detectCallSpikes(): void {
  const db = getDb();
  const now = new Date();
  const dayOfWeek = now.getDay();
  const hour = now.getHours();

  // Current hour call counts by zone
  const currentCounts = db.prepare(`
    SELECT zone_beat, COUNT(*) as cnt
    FROM calls_for_service
    WHERE created_at >= datetime('now', 'localtime', '-1 hour')
      AND zone_beat IS NOT NULL AND zone_beat != ''
    GROUP BY zone_beat
  `).all() as any[];

  for (const zone of currentCounts) {
    // 30-day average for same day-of-week and hour
    const avg = db.prepare(`
      SELECT COUNT(*) * 1.0 / 4 as avg_count
      FROM calls_for_service
      WHERE zone_beat = ?
        AND CAST(strftime('%w', created_at) AS INTEGER) = ?
        AND CAST(strftime('%H', created_at) AS INTEGER) = ?
        AND created_at >= datetime('now', 'localtime', '-30 days')
        AND created_at < datetime('now', 'localtime', '-1 hour')
    `).get(zone.zone_beat, dayOfWeek, hour) as any;

    const avgCount = avg?.avg_count || 1;
    if (zone.cnt >= avgCount * 2 && zone.cnt >= 3) {
      createAlert(
        'call_spike', zone.cnt >= avgCount * 3 ? 'critical' : 'high',
        `Call Spike: ${zone.zone_beat}`,
        `${zone.cnt} calls in the last hour (avg: ${Math.round(avgCount)}). ${Math.round(zone.cnt / avgCount)}x normal volume.`,
        zone.zone_beat
      );
    }
  }
}

// Detector 2: Officer Stillness — unit onscene with no GPS movement
function detectOfficerStillness(): void {
  const db = getDb();

  // Find units currently onscene
  const onsceneUnits = db.prepare(`
    SELECT u.id, u.call_sign, u.officer_id, u.current_call_id, u.latitude, u.longitude,
      c.priority, c.incident_type, usr.full_name
    FROM units u
    JOIN calls_for_service c ON u.current_call_id = c.id
    LEFT JOIN users usr ON u.officer_id = usr.id
    WHERE u.status = 'onscene'
      AND u.latitude IS NOT NULL
  `).all() as any[];

  for (const unit of onsceneUnits) {
    // Threshold: 15 min for P1/P2, 30 min for P3/P4
    const thresholdMin = (unit.priority === 'P1' || unit.priority === 'P2') ? 15 : 30;

    // Check GPS breadcrumbs — has the officer moved in the last N minutes?
    const recentBreadcrumbs = db.prepare(`
      SELECT latitude, longitude FROM gps_breadcrumbs
      WHERE user_id = ?
        AND recorded_at >= datetime('now', 'localtime', '-' || ? || ' minutes')
      ORDER BY recorded_at DESC
      LIMIT 5
    `).all(unit.officer_id, thresholdMin) as any[];

    if (recentBreadcrumbs.length < 2) continue;

    // Calculate max displacement from first point
    const ref = recentBreadcrumbs[0];
    let maxDisplacement = 0;
    for (const pt of recentBreadcrumbs) {
      const dLat = (pt.latitude - ref.latitude) * 111000; // ~111km per degree
      const dLng = (pt.longitude - ref.longitude) * 111000 * Math.cos(ref.latitude * Math.PI / 180);
      const dist = Math.sqrt(dLat * dLat + dLng * dLng);
      maxDisplacement = Math.max(maxDisplacement, dist);
    }

    // If less than 5 meters movement
    if (maxDisplacement < 5) {
      createAlert(
        'officer_stillness', unit.priority === 'P1' ? 'critical' : 'high',
        `Officer Welfare: ${unit.call_sign}`,
        `${unit.full_name || unit.call_sign} has been stationary for ${thresholdMin}+ minutes on ${unit.incident_type} call (${unit.priority}). Recommend welfare check.`,
        undefined
      );
    }
  }
}

// Detector 3: Crime Series — 3+ same-type calls in adjacent beats within 4 hours
function detectCrimeSeries(): void {
  const db = getDb();

  const seriesTypes = [
    'burglary', 'burglary_in_progress', 'robbery', 'armed_robbery',
    'theft', 'vehicle_theft', 'assault', 'shooting', 'vandalism',
  ];

  const recentClusters = db.prepare(`
    SELECT incident_type, zone_beat, COUNT(*) as cnt,
      GROUP_CONCAT(call_number, ', ') as call_numbers
    FROM calls_for_service
    WHERE created_at >= datetime('now', 'localtime', '-4 hours')
      AND zone_beat IS NOT NULL AND zone_beat != ''
      AND incident_type IN (${seriesTypes.map(() => '?').join(',')})
    GROUP BY incident_type, SUBSTR(zone_beat, 1, LENGTH(zone_beat) - 1)
    HAVING cnt >= 3
  `).all(...seriesTypes) as any[];

  for (const cluster of recentClusters) {
    createAlert(
      'crime_series', 'high',
      `Possible Crime Series: ${cluster.incident_type}`,
      `${cluster.cnt} ${cluster.incident_type} calls in area ${cluster.zone_beat} within 4 hours. Calls: ${cluster.call_numbers}`,
      cluster.zone_beat
    );
  }
}
