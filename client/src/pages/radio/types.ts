// Shared types for the RadioPage tab system. Mirrors the Worker
// shapes in src/routes/radio.ts so the same names cross the wire.

export interface RadioChannel {
  id: number;
  name: string;
  description: string | null;
  frequency: string | null;
  talkgroup: string | null;
  color: string | null;
  is_default: number;
  sort_order: number;
  archived_at: string | null;
  created_at: string;
  tx_count: number;
  last_tx_at: string | null;
}

export interface RadioTransmission {
  id: number;
  channel_id: number | null;
  channel_name: string | null;
  user_id: number | null;
  user_name: string | null;
  unit_label: string | null;
  transmitted_at: string;
  duration_seconds: number;
  transcript: string | null;
  audio_url: string | null;
  priority: number;
  tags: string | null;
  call_id: number | null;
}

export interface RadioRecording {
  id: number;
  transmission_id: number;
  user_id: number;
  label: string | null;
  notes: string | null;
  color: string | null;
  bookmark_seconds: number | null;
  loop_start_seconds: number | null;
  loop_end_seconds: number | null;
  created_at: string;
  // joined columns from /recordings endpoint
  transcript: string | null;
  transmitted_at: string;
  duration_seconds: number;
  channel_id: number | null;
  channel_name: string | null;
}

export interface RadioStats {
  sparkline: number[];       // length 24, index 0 = current hour, 23 = oldest
  heatmap: number[][];       // 7 rows (Mon..Sun) x 24 cols (00..23)
  totals: { today: number; week: number; all: number };
}

export type TabKey = 'live' | 'channels' | 'recordings' | 'references' | 'stats' | 'settings';

export const TAB_KEYS: TabKey[] = ['live', 'channels', 'recordings', 'references', 'stats', 'settings'];

export const TAB_LABELS: Record<TabKey, string> = {
  live: 'LIVE',
  channels: 'CHANNELS',
  recordings: 'RECORDINGS',
  references: 'REFERENCES',
  stats: 'STATS',
  settings: 'SETTINGS',
};
