// ──────────────────────────────────────────────────────────────────
// RadioPage — static reference data + theme palettes
// Pure data; no React, no side effects.
// ──────────────────────────────────────────────────────────────────

export const TEN_CODES: { code: string; meaning: string }[] = [
  { code: '10-1', meaning: 'Receiving poorly' }, { code: '10-2', meaning: 'Receiving well' },
  { code: '10-4', meaning: 'Acknowledged' },     { code: '10-6', meaning: 'Busy' },
  { code: '10-7', meaning: 'Out of service' },   { code: '10-8', meaning: 'In service' },
  { code: '10-9', meaning: 'Repeat' },           { code: '10-10', meaning: 'Off duty' },
  { code: '10-13', meaning: 'Weather/road' },    { code: '10-15', meaning: 'Prisoner in custody' },
  { code: '10-19', meaning: 'Return to station' }, { code: '10-20', meaning: 'Location' },
  { code: '10-22', meaning: 'Disregard' },       { code: '10-23', meaning: 'Stand by' },
  { code: '10-25', meaning: 'Meet' },            { code: '10-27', meaning: 'License check' },
  { code: '10-28', meaning: 'Registration' },    { code: '10-29', meaning: 'Wanted check' },
  { code: '10-32', meaning: 'Person w/ weapon' },{ code: '10-33', meaning: 'EMERGENCY' },
  { code: '10-50', meaning: 'Accident' },        { code: '10-76', meaning: 'En route' },
  { code: '10-97', meaning: 'On scene' },        { code: '10-98', meaning: 'Available' },
];

export const PHONETIC_NATO: Record<string, string> = {
  A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot',
  G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliet', K: 'Kilo', L: 'Lima',
  M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
  S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray',
  Y: 'Yankee', Z: 'Zulu',
};

export const PHONETIC_LAPD: Record<string, string> = {
  A: 'Adam', B: 'Boy', C: 'Charles', D: 'David', E: 'Edward', F: 'Frank',
  G: 'George', H: 'Henry', I: 'Ida', J: 'John', K: 'King', L: 'Lincoln',
  M: 'Mary', N: 'Nora', O: 'Ocean', P: 'Paul', Q: 'Queen', R: 'Robert',
  S: 'Sam', T: 'Tom', U: 'Union', V: 'Victor', W: 'William', X: 'X-ray',
  Y: 'Young', Z: 'Zebra',
};

export const STATUS_QUICKSET = [
  { code: '10-8',  label: 'IN SVC',    color: '#22c55e' },
  { code: '10-7',  label: 'OUT SVC',   color: '#ef4444' },
  { code: '10-19', label: 'STATION',   color: '#888888' },
  { code: '10-23', label: 'STAND BY',  color: '#d4a017' },
  { code: '10-76', label: 'EN ROUTE',  color: '#3b82f6' },
  { code: '10-97', label: 'ON SCENE',  color: '#a855f7' },
];

export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export const NOTIF_SOUNDS: Record<string, { freq: number; type: OscillatorType; dur: number }> = {
  chime: { freq: 880,  type: 'sine',     dur: 0.15 },
  buzz:  { freq: 220,  type: 'sawtooth', dur: 0.10 },
  click: { freq: 1200, type: 'square',   dur: 0.04 },
  blip:  { freq: 1800, type: 'triangle', dur: 0.08 },
};

export const THEMES = ['onyx', 'amber', 'nvg', 'contrast', 'cyan', 'magenta'] as const;
export type Theme = typeof THEMES[number];

export const FONT_SCALES = { sm: 0.9, md: 1.0, lg: 1.1 } as const;
export type FontScale = keyof typeof FONT_SCALES;

export const DATE_RANGES = [
  { id: 'all',       label: 'ALL' },
  { id: 'today',     label: 'TODAY' },
  { id: 'h24',       label: '24H' },
  { id: 'week',      label: 'WEEK' },
  { id: 'month',     label: 'MONTH' },
];

export const DURATION_FILTERS = [
  { id: '0',  label: 'ANY' },
  { id: '5',  label: '>5s' },
  { id: '10', label: '>10s' },
  { id: '30', label: '>30s' },
];

export const DEFAULT_PAGE_TEMPLATES = ['STAND BY', 'CODE 4', 'GO AHEAD', 'COPY', 'NEED BACKUP', 'CLEAR'];

export const COLOR_LABELS: { id: string; color: string; label: string }[] = [
  { id: 'red',    color: '#ef4444', label: 'PRIORITY' },
  { id: 'amber',  color: '#d4a017', label: 'REVIEW' },
  { id: 'green',  color: '#22c55e', label: 'RESOLVED' },
  { id: 'blue',   color: '#3b82f6', label: 'INFO' },
];

export const THEME_VARS: Record<Theme, Record<string, string>> = {
  onyx:     { '--rt-bg': '#0a0a0a', '--rt-panel': '#0d0d0d', '--rt-border': '#1f1f1f', '--rt-accent': '#d4a017', '--rt-text': '#fff',    '--rt-muted': '#888', '--rt-led-on': '#22c55e', '--rt-tx': '#ef4444', '--rt-crt': '#33ff33' },
  amber:    { '--rt-bg': '#0c0700', '--rt-panel': '#100a02', '--rt-border': '#3a2400', '--rt-accent': '#ffae33', '--rt-text': '#ffd9a3', '--rt-muted': '#a06a00', '--rt-led-on': '#ffae33', '--rt-tx': '#ff5050', '--rt-crt': '#ffae33' },
  nvg:      { '--rt-bg': '#000800', '--rt-panel': '#001a00', '--rt-border': '#0a3a0a', '--rt-accent': '#33ff33', '--rt-text': '#bbffbb', '--rt-muted': '#3a8a3a', '--rt-led-on': '#33ff33', '--rt-tx': '#ff3333', '--rt-crt': '#33ff33' },
  contrast: { '--rt-bg': '#000000', '--rt-panel': '#000000', '--rt-border': '#ffffff', '--rt-accent': '#ffff00', '--rt-text': '#ffffff', '--rt-muted': '#cccccc', '--rt-led-on': '#00ff00', '--rt-tx': '#ff0000', '--rt-crt': '#00ff00' },
  cyan:     { '--rt-bg': '#00080d', '--rt-panel': '#001824', '--rt-border': '#0a3a4a', '--rt-accent': '#22d3ee', '--rt-text': '#bae6fd', '--rt-muted': '#3a7a8a', '--rt-led-on': '#22d3ee', '--rt-tx': '#ff5050', '--rt-crt': '#33ffee' },
  magenta:  { '--rt-bg': '#0a0010', '--rt-panel': '#1a0024', '--rt-border': '#3a0a4a', '--rt-accent': '#ff44dd', '--rt-text': '#ffd4f5', '--rt-muted': '#a04488', '--rt-led-on': '#ff44dd', '--rt-tx': '#ff5050', '--rt-crt': '#ff66ee' },
};

export const SETTINGS_KEYS = [
  'radio_favorites','radio_muted_channels','radio_channel_volumes','radio_channel_notes',
  'radio_monitor_only','radio_recent_channels','radio_notif_enabled','radio_sound_enabled',
  'radio_notif_sound','radio_notif_volume','radio_page_sound','radio_flash_tx',
  'radio_keyword_alerts','radio_quiet_start','radio_quiet_end','radio_user_notif',
  'radio_marked_tx','radio_pinned_tx','radio_saved_searches','radio_compact','radio_time_24h',
  'radio_time_relative','radio_silence_alert','radio_current_status','radio_theme',
  'radio_font_scale','radio_reduce_motion','radio_dim_mode','radio_hide_live','radio_hide_stats',
  'radio_hide_refs','radio_hide_top','radio_hide_muted','radio_favs_only','radio_phonetic',
  'radio_ptt_lock','radio_roger_beep','radio_countdown','radio_hang_time','radio_autoplay_next',
  'radio_loop_rec','radio_page_templates','radio_last_page','radio_tx_annotations','radio_tx_colors',
  'radio_scratchpad','radio_active_call','radio_pinned_rec','radio_show_scratch','radio_show_codes',
  'radio_show_phonetic','radio_col_width','radio_snooze_until','radio_tts','radio_focus_mute',
  'radio_filter_presets','radio_rec_bookmarks','radio_ab_loops','radio_channel_labels',
  'radio_channel_descriptions','radio_pinned_channel','radio_auto_leave','radio_confirm_leave',
  'radio_density','radio_auto_theme','radio_bg_anim','radio_mic_gain','radio_rec_notes',
  'radio_rec_sort','radio_auto_rewind','radio_group_notifs','radio_show_heatmap',
];
