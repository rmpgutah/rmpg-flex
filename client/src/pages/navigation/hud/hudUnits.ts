// ============================================================
// RMPG Flex — Drive-Mode HUD · unit + formatting helpers
// ============================================================
// Self-contained (drive-lane only) unit/format helpers for the instrument
// footer. Deliberately NOT imported from any other lane — everything the HUD
// needs to format speed, distance, heading, time, ETA, and labels lives here so
// the drive lane builds in isolation. All localStorage access is try/catch'd.
// ============================================================

export type SpeedUnit = 'mph' | 'kmh';

const UNIT_KEY = 'rmpg_nav_hud_speed_unit';

/** Read the persisted speed-unit preference (defaults to mph). */
export function loadSpeedUnit(): SpeedUnit {
  try {
    const v = localStorage.getItem(UNIT_KEY);
    if (v === 'kmh' || v === 'mph') return v;
  } catch { /* storage blocked — fall through to default */ }
  return 'mph';
}

/** Persist the speed-unit preference (best-effort). */
export function saveSpeedUnit(u: SpeedUnit): void {
  try { localStorage.setItem(UNIT_KEY, u); } catch { /* ignore */ }
}

const MPH_PER_KMH = 0.621371;

/** Convert an mph value into the active unit's numeric value. */
export function speedInUnit(mph: number, unit: SpeedUnit): number {
  return unit === 'kmh' ? mph / MPH_PER_KMH : mph;
}

/** Short unit suffix for a speed readout. */
export function speedSuffix(unit: SpeedUnit): string {
  return unit === 'kmh' ? 'km/h' : 'mph';
}

/** Format a speed (given in mph) into "62 mph" / "100 km/h", unit-aware. */
export function formatSpeed(mph: number | null, unit: SpeedUnit): string {
  if (mph == null || !Number.isFinite(mph)) return `-- ${speedSuffix(unit)}`;
  return `${Math.round(speedInUnit(mph, unit))} ${speedSuffix(unit)}`;
}

/** Green/amber/red band color for a speed (mph), unit-agnostic thresholds. */
export function speedColor(mph: number | null): string {
  if (mph == null) return '#22c55e';
  return mph > 80 ? '#ef4444' : mph > 55 ? '#f59e0b' : '#22c55e';
}

/** Band threshold labels (in the active unit) for the gauge legend chip. */
export function speedBands(unit: SpeedUnit): { ok: number; warn: number } {
  return {
    ok: Math.round(speedInUnit(55, unit)),
    warn: Math.round(speedInUnit(80, unit)),
  };
}

/** Format a distance given in METERS, unit-aware, long form ("3.4 mi" / "5.5 km"). */
export function formatDistanceLong(meters: number, unit: SpeedUnit): string {
  if (!Number.isFinite(meters)) return '--';
  if (unit === 'kmh') {
    const km = meters / 1000;
    return km < 1 ? `${Math.round(meters)} m` : `${km.toFixed(2)} km`;
  }
  const mi = meters / 1609.34;
  if (mi < 0.1) return `${Math.round(meters * 3.28084)} ft`;
  return `${mi.toFixed(2)} mi`;
}

/** Format a distance given in MILES, unit-aware, compact ("3.4 mi" / "5.5 km"). */
export function formatDistanceMi(mi: number, unit: SpeedUnit): string {
  if (!Number.isFinite(mi)) return '--';
  if (unit === 'kmh') return `${(mi * 1.60934).toFixed(1)} km`;
  return `${mi.toFixed(1)} mi`;
}

// ── Heading helpers (navHeading) ────────────────────────────
const CARD8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** 8-point cardinal for a degrees-heading. */
export function cardinal8(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  return CARD8[Math.round(d / 45) % 8];
}

/** "058 NE" — zero-padded degrees + cardinal. */
export function formatHeading(deg: number | null): string {
  if (deg == null || !Number.isFinite(deg)) return '---';
  const d = ((deg % 360) + 360) % 360;
  return `${String(Math.round(d)).padStart(3, '0')} ${cardinal8(d)}`;
}

/** Relative bearing of a target heading vs the vehicle's heading (deg, 0=ahead). */
export function relativeBearing(target: number, heading: number | null): number {
  if (heading == null) return ((target % 360) + 360) % 360;
  return (((target - heading) % 360) + 360) % 360;
}

// ── Time / ETA helpers (navTime + navEta) ───────────────────

/** Clock-agnostic duration: HH:MM:SS (or M:SS under an hour). */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Parse an ETA string ("1h 5m" / "12 min" / "3:20") to minutes (best-effort). */
export function etaToMinutes(etaStr: string | null | undefined): number {
  if (!etaStr) return 0;
  let mins = 0;
  const hM = etaStr.match(/(\d+)\s*h/);
  const mM = etaStr.match(/(\d+)\s*m(?:in)?/);
  if (hM) mins += parseInt(hM[1], 10) * 60;
  if (mM) mins += parseInt(mM[1], 10);
  if (!hM && !mM) {
    const cM = etaStr.match(/^(\d+):(\d{2})$/);
    if (cM) mins = parseInt(cM[1], 10) + (parseInt(cM[2], 10) >= 30 ? 1 : 0);
  }
  return mins;
}

/** Wall-clock arrival ("3:42 PM") given remaining minutes, or null if unknown. */
export function arrivalClockFrom(mins: number): string | null {
  if (!(mins > 0)) return null;
  return new Date(Date.now() + mins * 60000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Compact countdown for an ETA in minutes ("1h 05m" / "12m"). */
export function formatCountdown(mins: number): string {
  if (!(mins > 0)) return '--';
  if (mins >= 60) { const h = Math.floor(mins / 60); const m = mins % 60; return `${h}h ${String(m).padStart(2, '0')}m`; }
  return `${mins}m`;
}

// ── Label helper (navLabel) ─────────────────────────────────

/** Truncate a label cleanly to a max length, keeping the leading portion. */
export function truncateLabel(s: string | null | undefined, max = 28): string {
  const t = (s || '').trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
