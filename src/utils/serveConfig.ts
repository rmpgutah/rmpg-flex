import { getDb, queryFirst } from './db';

type Db = ReturnType<typeof getDb>;

export interface ServeConfig {
  mileage_rate: number;
  business_hours_start: string;
  business_hours_end: string;
  business_hours_days: number[];
  auto_geocode_on_intake: boolean;
  geocode_confidence_min: number;
  approaching_hours: number;
  diligence_gap_days: number;
  unassigned_window_hours: number;
  renotify_hours: number;
  notify_supervisor_email: boolean;
}

const DEFAULTS: ServeConfig = {
  mileage_rate: 0.67,
  business_hours_start: '08:00',
  business_hours_end: '20:00',
  business_hours_days: [1, 2, 3, 4, 5],
  auto_geocode_on_intake: true,
  geocode_confidence_min: 0.6,
  approaching_hours: 48,
  diligence_gap_days: 3,
  unassigned_window_hours: 72,
  renotify_hours: 24,
  notify_supervisor_email: true,
};

export async function getServeConfig(db: Db): Promise<ServeConfig> {
  const row = await queryFirst<any>(db, 'SELECT * FROM serve_nudge_settings WHERE id = ?', 1).catch(() => null);
  if (!row) return { ...DEFAULTS };
  return {
    mileage_rate: row.mileage_rate ?? DEFAULTS.mileage_rate,
    business_hours_start: row.business_hours_start ?? DEFAULTS.business_hours_start,
    business_hours_end: row.business_hours_end ?? DEFAULTS.business_hours_end,
    business_hours_days: typeof row.business_hours_days === 'string'
      ? JSON.parse(row.business_hours_days)
      : (row.business_hours_days ?? DEFAULTS.business_hours_days),
    auto_geocode_on_intake: row.auto_geocode_on_intake !== 0,
    geocode_confidence_min: row.geocode_confidence_min ?? DEFAULTS.geocode_confidence_min,
    approaching_hours: row.approaching_hours ?? DEFAULTS.approaching_hours,
    diligence_gap_days: row.diligence_gap_days ?? DEFAULTS.diligence_gap_days,
    unassigned_window_hours: row.unassigned_window_hours ?? DEFAULTS.unassigned_window_hours,
    renotify_hours: row.renotify_hours ?? DEFAULTS.renotify_hours,
    notify_supervisor_email: row.notify_supervisor_email !== 0,
  };
}
