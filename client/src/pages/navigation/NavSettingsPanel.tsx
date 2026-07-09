import { X } from 'lucide-react';

// ── Self-contained types (lane rule: define everything we need here) ─────────
export type NavUnits = 'imperial' | 'metric';
export type NavClock = '12h' | '24h';
export type NavTheme = 'day' | 'night';
export type NavOrientation = 'north-up' | 'heading-up';

export interface NavLayerPrefs {
  crime: boolean;
  crash: boolean;
  trail: boolean;
  alerts: boolean;
}

export interface NavPrefs {
  units: NavUnits;
  clock: NavClock;
  theme: NavTheme;
  orientation: NavOrientation;
  volume: number;       // 0..1
  brightness: number;   // 0..1
  layers: NavLayerPrefs;
  crimeLookbackDays: number;
  crimeClasses: { person: boolean; property: boolean; society: boolean; cfs: boolean };
  lastSearchQuery: string;
  overSpeedThresholdMph: number; // 0 disables the alert
}

export const NAV_PREFS_STORAGE_KEY = 'rmpg_nav_prefs';

export const DEFAULT_NAV_PREFS: NavPrefs = {
  units: 'imperial',
  clock: '12h',
  theme: 'night',
  orientation: 'heading-up',
  volume: 0.7,
  brightness: 1,
  layers: { crime: false, crash: false, trail: true, alerts: true },
  crimeLookbackDays: 7,
  crimeClasses: { person: true, property: true, society: true, cfs: true },
  lastSearchQuery: '',
  overSpeedThresholdMph: 10,
};

// #93 theme swatch base colors used for the live preview beside the segmented control.
const THEME_SWATCH: Record<NavTheme, { base: string; label: string }> = {
  day: { base: '#f4f1ea', label: 'Day' },
  night: { base: '#0a0a0a', label: 'Night' },
};

export function loadNavPrefs(): NavPrefs {
  try {
    const raw = localStorage.getItem(NAV_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_NAV_PREFS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_NAV_PREFS,
      ...parsed,
      layers: { ...DEFAULT_NAV_PREFS.layers, ...(parsed?.layers ?? {}) },
      crimeClasses: { ...DEFAULT_NAV_PREFS.crimeClasses, ...(parsed?.crimeClasses ?? {}) },
    };
  } catch {
    return { ...DEFAULT_NAV_PREFS };
  }
}

export function saveNavPrefs(prefs: NavPrefs) {
  try {
    localStorage.setItem(NAV_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

// Small local IconButton so this file is fully self-contained (no cross-lane import).
function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close navigation settings"
      onClick={onClick}
      className="flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d4a017]"
      style={{
        width: 36,
        height: 36,
        borderRadius: 2,
        background: 'var(--surface-base)',
        border: '1px solid var(--border-default)',
        color: '#888',
      }}
    >
      <X size={16} />
    </button>
  );
}

function Segmented<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: '#888' }}>{label}</div>
      <div className="flex" style={{ borderRadius: 2, overflow: 'hidden', border: '1px solid var(--border-default)' }}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(opt.value)}
              className="flex-1 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d4a017]"
              style={{
                background: active ? '#d4a017' : '#0a0a0a',
                color: active ? '#000' : '#888',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Slider({
  label, value, onChange, min = 0, max = 100, formatValue,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  /** Raw input[type=range] bounds. Defaults preserve the original 0–100% behavior. */
  min?: number;
  max?: number;
  /** Formats the raw slider value for display. Defaults to the original "NN%" percent format. */
  formatValue?: (raw: number) => string;
}) {
  const raw = formatValue ? value : Math.round(value * 100);
  const display = formatValue ? formatValue(value) : `${raw}%`;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: '#888' }}>{label}</span>
        <span className="text-[10px] font-mono tabular-nums" style={{ color: '#d4a017' }}>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={raw}
        onChange={(e) => onChange(formatValue ? Number(e.target.value) : Number(e.target.value) / 100)}
        className="w-full"
        style={{ accentColor: '#d4a017' }}
        aria-label={label}
      />
    </div>
  );
}

function LayerToggle({
  label, checked, onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${label} layer`}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between px-2 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d4a017]"
      style={{
        borderRadius: 2,
        border: `1px solid ${checked ? '#d4a017' : 'var(--border-default)'}`,
        background: checked ? 'rgba(212,160,23,0.10)' : 'var(--surface-overlay)',
        color: checked ? '#d4a017' : '#888',
      }}
    >
      <span className="text-[10px] font-mono uppercase tracking-wider">{label}</span>
      <span
        aria-hidden
        style={{
          width: 8, height: 8, borderRadius: 2,
          background: checked ? '#d4a017' : '#333',
        }}
      />
    </button>
  );
}

export default function NavSettingsPanel({
  prefs, setPref, onClose,
}: {
  prefs: NavPrefs;
  setPref: <K extends keyof NavPrefs>(key: K, value: NavPrefs[K]) => void;
  onClose: () => void;
}) {
  const swatch = THEME_SWATCH[prefs.theme];

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[1200] panel-beveled"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation settings"
      style={{
        background: 'rgba(5,5,5,0.95)',
        borderTop: '1px solid var(--border-default)',
        borderTopLeftRadius: 2,
        borderTopRightRadius: 2,
        boxShadow: '0 -8px 24px rgba(0,0,0,0.6)',
        maxHeight: '80vh',
        overflowY: 'auto',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--surface-raised)' }}>
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#d4a017' }}>
          Navigation Settings
        </span>
        <CloseButton onClick={onClose} />
      </div>

      <div className="p-3 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Segmented<NavUnits>
            label="Units"
            value={prefs.units}
            options={[{ value: 'imperial', label: 'mi/mph' }, { value: 'metric', label: 'km/kmh' }]}
            onChange={(v) => setPref('units', v)}
          />
          <Segmented<NavClock>
            label="Clock"
            value={prefs.clock}
            options={[{ value: '12h', label: '12 hr' }, { value: '24h', label: '24 hr' }]}
            onChange={(v) => setPref('clock', v)}
          />
        </div>

        {/* #93 Theme with live swatch preview */}
        <div className="space-y-1">
          <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: '#888' }}>Theme</div>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Segmented<NavTheme>
                label=""
                value={prefs.theme}
                options={[{ value: 'day', label: 'Day' }, { value: 'night', label: 'Night' }]}
                onChange={(v) => setPref('theme', v)}
              />
            </div>
            <div className="flex flex-col items-center" aria-hidden>
              <span
                style={{
                  width: 40, height: 28, borderRadius: 2,
                  background: swatch.base, border: '1px solid var(--border-default)',
                  display: 'block',
                }}
              />
              <span className="text-[8px] font-mono mt-0.5" style={{ color: '#888' }}>{swatch.label}</span>
            </div>
          </div>
        </div>

        <Segmented<NavOrientation>
          label="Map orientation"
          value={prefs.orientation}
          options={[{ value: 'north-up', label: 'North up' }, { value: 'heading-up', label: 'Heading up' }]}
          onChange={(v) => setPref('orientation', v)}
        />

        <Slider label="Voice volume" value={prefs.volume} onChange={(v) => setPref('volume', v)} />
        <Slider label="Brightness" value={prefs.brightness} onChange={(v) => setPref('brightness', v)} />
        <Slider
          label="Over-speed alert (mph over limit)"
          value={prefs.overSpeedThresholdMph}
          onChange={(v) => setPref('overSpeedThresholdMph', v)}
          min={0}
          max={30}
          formatValue={(v) => (v === 0 ? 'Off' : `+${v} mph`)}
        />

        <div className="space-y-1">
          <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: '#888' }}>Map layers</div>
          <div className="grid grid-cols-2 gap-2">
            <LayerToggle label="Crime" checked={prefs.layers.crime} onChange={(v) => setPref('layers', { ...prefs.layers, crime: v })} />
            <LayerToggle label="Crash" checked={prefs.layers.crash} onChange={(v) => setPref('layers', { ...prefs.layers, crash: v })} />
            <LayerToggle label="Trail" checked={prefs.layers.trail} onChange={(v) => setPref('layers', { ...prefs.layers, trail: v })} />
            <LayerToggle label="Alerts" checked={prefs.layers.alerts} onChange={(v) => setPref('layers', { ...prefs.layers, alerts: v })} />
          </div>
        </div>
      </div>
    </div>
  );
}
