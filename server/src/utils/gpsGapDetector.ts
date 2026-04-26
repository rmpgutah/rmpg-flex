// ============================================================
// RMPG Flex — GPS Gap Detector
// ============================================================
// Watches `units.gps_updated_at` and alerts when an active unit
// hasn't reported a position for longer than configured thresholds.
// Runs every 60s. Fires two tiers of alert:
//
//   WARN     gap >=  5 min   → visible-but-not-audible dispatch alert
//   CRITICAL gap >= 15 min   → audible, higher-severity banner
//
// Only active (non-OFD, non-off-duty) units are checked. Each
// unit has its own per-tier cooldown so we don't spam the
// WebSocket with the same alert every minute.
//
// Why a detector and not client-side staleness badges?
//   • Clients may be closed or on another page — dispatch needs
//     a push alert. This is the "supervisor noticed" moment.
//   • The detector is authoritative (server clock, server DB) so
//     two dispatch consoles can't disagree about whether a unit
//     is stale.
// ============================================================

import { getDb } from '../models/database';
import { broadcastAlert } from './websocket';
import { logger } from './logger';

// Gap tier thresholds (seconds). Tuned for law-enforcement ops:
//   5 min = "officer may be out of car" — check but don't panic
//  15 min = "something's wrong" — elevate
const WARN_GAP_SEC = 5 * 60;
const CRIT_GAP_SEC = 15 * 60;
const CHECK_INTERVAL_MS = 60 * 1000;

// Per-unit per-tier cooldown — avoid republishing the same alert
// every minute while a unit sits stale. Keyed by `${unitId}:${tier}`.
// Reset when the unit either recovers (gap drops below WARN) OR
// escalates to a higher tier.
const COOLDOWN_MS = 5 * 60 * 1000; // 5 min between repeats per tier
const lastAlertAt = new Map<string, number>();
const currentTier = new Map<number, 'warn' | 'crit' | null>();

// Statuses that mean "this unit is on duty and should be reporting".
// OFD / off_duty / out_of_service / retired are excluded: they're
// legitimately silent and don't need staleness alerts.
const ACTIVE_STATUSES = new Set([
  'available', 'enroute', 'on_scene', 'dispatched',
  'transporting', 'arrived', 'in_service', 'busy',
]);

interface UnitRow {
  id: number;
  call_sign: string;
  status: string;
  gps_source: string | null;
  gps_updated_at: string | null;
  // Per-source authoritative freshness — populated only by OwnTracks,
  // Traccar, ClearPathGPS writes. Browser fallbacks deliberately do not
  // touch this column, so it answers the right question: "when did the
  // dominant tracker last report?", not "when did anyone last report?".
  last_authoritative_gps_at: string | null;
  last_authoritative_gps_source: string | null;
  officer_name: string | null;
  badge_number: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Classify a unit's gap age into a tier. */
function tierFor(ageSec: number): 'warn' | 'crit' | null {
  if (ageSec >= CRIT_GAP_SEC) return 'crit';
  if (ageSec >= WARN_GAP_SEC) return 'warn';
  return null;
}

function runCheck(): void {
  const db = getDb();
  const rows = db.prepare(`
    SELECT u.id, u.call_sign, u.status, u.gps_source,
           u.gps_updated_at, u.last_authoritative_gps_at,
           u.last_authoritative_gps_source,
           u.latitude, u.longitude,
           usr.full_name AS officer_name, usr.badge_number
    FROM units u
    LEFT JOIN users usr ON u.officer_id = usr.id
    WHERE u.status IS NOT NULL
  `).all() as UnitRow[];

  const now = Date.now();
  let warnCount = 0;
  let critCount = 0;

  for (const u of rows) {
    // Skip non-active statuses.
    if (!ACTIVE_STATUSES.has(u.status)) {
      // Clear cooldown so if the unit comes back on duty and goes
      // stale again, we re-alert rather than silently sit cold.
      currentTier.set(u.id, null);
      lastAlertAt.delete(`${u.id}:warn`);
      lastAlertAt.delete(`${u.id}:crit`);
      continue;
    }

    // Prefer last_authoritative_gps_at — that's the heartbeat of the
    // dominant tracker (OwnTracks/Traccar). Falls back to gps_updated_at
    // for units that have never had an authoritative source connected.
    // Without this, a browser_desktop fallback writing every minute
    // would mask a multi-hour OwnTracks outage.
    const heartbeat = u.last_authoritative_gps_at ?? u.gps_updated_at;
    if (!heartbeat) continue;

    const updatedMs = new Date(heartbeat).getTime();
    if (isNaN(updatedMs)) continue;
    const ageSec = Math.floor((now - updatedMs) / 1000);
    const tier = tierFor(ageSec);

    // Recovery: was stale, now fresh. Clear tier + cooldowns.
    if (tier === null) {
      if (currentTier.get(u.id)) {
        currentTier.set(u.id, null);
        lastAlertAt.delete(`${u.id}:warn`);
        lastAlertAt.delete(`${u.id}:crit`);
        // Emit a "recovered" event so client banners can clear.
        try {
          broadcastAlert({
            type: 'gps:recovered',
            severity: 'info',
            label: 'GPS RESTORED',
            unit: u.call_sign,
            unit_id: u.id,
            officer_name: u.officer_name,
          });
        } catch { /* non-fatal */ }
      }
      continue;
    }

    // Alert or re-alert with cooldown.
    const cooldownKey = `${u.id}:${tier}`;
    const prevTier = currentTier.get(u.id);
    const last = lastAlertAt.get(cooldownKey) ?? 0;

    // Fire if: tier changed (escalation or new stall), OR cooldown elapsed.
    const shouldFire = tier !== prevTier || (now - last) >= COOLDOWN_MS;
    if (!shouldFire) continue;

    const severity = tier === 'crit' ? 'critical' : 'warning';
    const label = tier === 'crit' ? 'GPS LOST' : 'GPS STALE';
    try {
      broadcastAlert({
        type: 'gps:gap',
        severity,
        label,
        unit: u.call_sign,
        unit_id: u.id,
        officer_name: u.officer_name,
        badge_number: u.badge_number,
        gap_seconds: ageSec,
        gap_minutes: Math.round(ageSec / 60),
        last_latitude: u.latitude,
        last_longitude: u.longitude,
        // `last_source` reports the CURRENT live source (which may be a
        // browser fallback). `authoritative_source` and `_at` describe
        // the dominant tracker that actually went silent — what
        // dispatchers need to know about. Both are sent so the UI can
        // render either.
        last_source: u.gps_source,
        last_seen_at: u.gps_updated_at,
        authoritative_source: u.last_authoritative_gps_source,
        authoritative_seen_at: u.last_authoritative_gps_at,
      });
      lastAlertAt.set(cooldownKey, now);
      currentTier.set(u.id, tier);
      if (tier === 'crit') critCount += 1; else warnCount += 1;
    } catch (err) {
      logger.warn({ err, unit: u.call_sign }, 'gps gap broadcast failed');
    }
  }

  if (warnCount > 0 || critCount > 0) {
    logger.info({ warn: warnCount, crit: critCount }, 'gps gap detector — alerts fired');
  }
}

let detectorHandle: ReturnType<typeof setInterval> | null = null;

export function startGpsGapDetector(): void {
  if (detectorHandle) return;
  // Delay first run by 30s so the service doesn't alert on startup
  // for units whose last update was pre-restart (they'll re-report
  // shortly as soon as clients reconnect).
  setTimeout(() => { try { runCheck(); } catch (err) { logger.error({ err }, 'gps gap check failed'); } }, 30_000);
  detectorHandle = setInterval(() => {
    try { runCheck(); } catch (err) { logger.error({ err }, 'gps gap check failed'); }
  }, CHECK_INTERVAL_MS);
  logger.info({ warnSec: WARN_GAP_SEC, critSec: CRIT_GAP_SEC, intervalMs: CHECK_INTERVAL_MS }, 'gps gap detector started');
}

export function stopGpsGapDetector(): void {
  if (detectorHandle) {
    clearInterval(detectorHandle);
    detectorHandle = null;
  }
}
