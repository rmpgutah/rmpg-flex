/**
 * SettingsPanel — Windows 11-style Settings for the FlexOS desktop shell.
 *
 * 13 system tabs (Display · Sound · Network · Bluetooth · Notifications ·
 * Power & Sleep · Storage · Apps · Clipboard · Event Log · Account & PIN ·
 * Kiosk Mode · About) backed by useWindowsBridge, plus any `extraTabs` the
 * host window injects (System Preferences passes its Desktop / Theme /
 * Window Rules panels through so there is one Settings surface).
 *
 * Runs in three modes without code changes:
 *   • Electron desktop build with the extended bridge — everything live.
 *   • Older Electron build — legacy bridge only; extended rows show a
 *     "requires desktop update" note.
 *   • Plain browser — read-only, every control disabled with a note.
 *
 * Styling lives in ./settings.css (scoped under .settings-root, theme
 * variables only).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Monitor, Volume2, VolumeX, Wifi, Bluetooth, Bell, BatteryCharging, HardDrive, AppWindow,
  ClipboardList, ScrollText, UserCircle, Lock, Info, RefreshCw, Camera, Search, Play,
  FolderOpen, Trash2, Power, RotateCcw, Radio, Send, ShieldAlert, Check, X,
} from 'lucide-react';
import './settings.css';
import { useWindowsBridge } from '../../../hooks/useWindowsBridge';
import type {
  WindowsBridge, DisplayMode, CurrentDisplayMode, DisplayInfo, AudioDevice, NetAdapter, BluetoothDevice,
  PingResult, ProcessInfo, InstalledApp, LaunchableApp, DriveInfo, RecentFile, EventLogEntry,
  ScheduledTask, SystemPerformance, WifiNetwork, WifiDetail, BatteryStatus, SystemInfo, KioskShellState,
} from '../../../hooks/useWindowsBridge';
import { useOptionalDesktopSystem } from '../../../context/DesktopSystemContext';
import type { FocusAssistLevel } from '../../../context/DesktopSystemContext';
import { useAuth } from '../../../context/AuthContext';
import { apiFetch } from '../../../hooks/useApi';
import { formatEnumValue } from '../../../utils/formatters';

// ─── Tab model ───────────────────────────────────────────────

export type SettingsTabId =
  | 'display' | 'sound' | 'network' | 'bluetooth' | 'notifications' | 'power'
  | 'storage' | 'apps' | 'clipboard' | 'eventlog' | 'account' | 'kiosk' | 'about';

export interface ExtraSettingsTab {
  id: string;
  label: string;
  icon: React.ElementType;
  group?: string;
  render: () => React.ReactNode;
}

interface TabDef { id: string; label: string; icon: React.ElementType; group: string }

export const SETTINGS_TABS: ReadonlyArray<TabDef & { id: SettingsTabId }> = [
  { id: 'display',       label: 'Display',        icon: Monitor,         group: 'System' },
  { id: 'sound',         label: 'Sound',          icon: Volume2,         group: 'System' },
  { id: 'notifications', label: 'Notifications',  icon: Bell,            group: 'System' },
  { id: 'power',         label: 'Power & Sleep',  icon: BatteryCharging, group: 'System' },
  { id: 'storage',       label: 'Storage',        icon: HardDrive,       group: 'System' },
  { id: 'network',       label: 'Network',        icon: Wifi,            group: 'Connectivity' },
  { id: 'bluetooth',     label: 'Bluetooth',      icon: Bluetooth,       group: 'Connectivity' },
  { id: 'apps',          label: 'Apps',           icon: AppWindow,       group: 'Tools' },
  { id: 'clipboard',     label: 'Clipboard',      icon: ClipboardList,   group: 'Tools' },
  { id: 'eventlog',      label: 'Event Log',      icon: ScrollText,      group: 'Tools' },
  { id: 'account',       label: 'Account & PIN',  icon: UserCircle,      group: 'Security' },
  { id: 'kiosk',         label: 'Kiosk Mode',     icon: Lock,            group: 'Security' },
  { id: 'about',         label: 'About',          icon: Info,            group: 'Security' },
];

export interface SettingsPanelProps {
  initialTab?: string;
  extraTabs?: ExtraSettingsTab[];
  /** Optional: host window supplies its own kiosk-exit flow (credential prompt). */
  onRequestExitKiosk?: () => void;
  /** Injected for tests; defaults to the real hook. */
  bridgeOverride?: WindowsBridge;
}

// ─── Small primitives ────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">{title}</h3>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function Row({ label, desc, children }: { label: string; desc?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <span className="row-label">{label}</span>
        {desc ? <span className="row-desc">{desc}</span> : null}
      </div>
      {children ? <div className="settings-row-control">{children}</div> : null}
    </div>
  );
}

function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`toggle-switch ${on ? 'on' : 'off'}`}
      onClick={() => onChange(!on)}
    >
      <span className="toggle-thumb" />
    </button>
  );
}

function Slider({ value, onChange, onCommit, min = 0, max = 100, disabled, label, suffix = '%' }: {
  value: number; onChange: (v: number) => void; onCommit?: (v: number) => void; min?: number; max?: number; disabled?: boolean; label: string; suffix?: string;
}) {
  return (
    <div className="slider-row">
      <input
        type="range"
        className="settings-slider"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      />
      <span className="slider-value">{value}{suffix}</span>
    </div>
  );
}

function Msg({ kind, children }: { kind: 'ok' | 'err'; children: React.ReactNode }) {
  return <div className={`settings-msg ${kind}`} role="status">{children}</div>;
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="settings-empty">{children}</div>;
}

function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onCancel }: {
  title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="settings-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-confirm-title">
      <div className="settings-confirm-dialog">
        <h3 id="settings-confirm-title">{title}</h3>
        <p>{body}</p>
        <div className="confirm-btns">
          <button type="button" className="settings-btn-sm" onClick={onCancel}>Cancel</button>
          <button type="button" className={`settings-btn-sm ${danger ? 'danger' : ''}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/** Debounces a value for slider→bridge writes so rapid drags don't spawn a PowerShell per pixel. */
function useDebouncedCallback<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback((...a: A) => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => latest.current(...a), ms);
  }, [ms]);
}

/** Runs an async loader on mount (and on demand); tracks loading + error. */
function useLoader<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await load());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void run(); }, [run]);
  return { data, loading, error, reload: run, setData };
}

function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i >= 3 ? 1 : 0)} ${units[i]}`;
}

function fmtUptime(sec: number | undefined): string {
  if (!sec || !Number.isFinite(sec)) return '—';
  const d = Math.floor(sec / 86400); const h = Math.floor((sec % 86400) / 3600); const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  // Bridge timestamps are full ISO-8601 with a Z suffix (Date#toISOString /
  // PowerShell ToString('o')), never naive server strings.
  const d = new Date(iso); // new-date-ok
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const NOT_ELECTRON_NOTE = 'Available in the RMPG Flex desktop app only.';
const NEEDS_UPDATE_NOTE = 'Requires the latest desktop app build.';

function errText(r: { ok: boolean; error?: string; detail?: string } | null | undefined, fallback = 'Failed'): string {
  if (!r) return fallback;
  if (r.ok) return '';
  if (r.error === 'not_electron') return NOT_ELECTRON_NOTE;
  if (r.error === 'not_supported') return r.detail ? `Not supported: ${r.detail}` : 'Not supported on this device.';
  if (r.error === 'rate_limited') return 'Too many requests — wait a moment and try again.';
  return r.error || fallback;
}

// ─── Tabs ────────────────────────────────────────────────────

function DisplayTab({ b }: { b: WindowsBridge }) {
  const sys = useOptionalDesktopSystem();
  const [brightness, setBrightness] = useState<number>(sys?.brightness ?? 80);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const modes = useLoader(() => b.getDisplayModes(), [b]);
  const displays = useLoader(() => b.getDisplays(), [b]);
  const night = useLoader(() => b.getNightLightState(), [b]);

  useEffect(() => { void b.getBrightness().then((v) => { if (typeof v === 'number') setBrightness(Math.round(v)); }); }, [b]);
  const commitBrightness = useDebouncedCallback((v: number) => { void b.setBrightness(v); sys?.setBrightness(v); }, 150);

  const current: CurrentDisplayMode | null = modes.data?.ok ? modes.data.current : null;
  const list: DisplayMode[] = modes.data?.ok ? modes.data.modes : [];

  const applyResolution = async (val: string) => {
    const [w, h] = val.split('x').map(Number);
    const r = await b.setResolution(w, h);
    setMsg(r.ok ? { kind: 'ok', text: `Resolution set to ${w}×${h}` } : { kind: 'err', text: errText(r, 'Could not change resolution') });
    if (r.ok) void modes.reload();
  };
  const rotate = async (deg: number) => {
    const r = await b.rotateDisplay(deg);
    setMsg(r.ok ? { kind: 'ok', text: `Rotated to ${deg}°` } : { kind: 'err', text: errText(r, 'Could not rotate display') });
    if (r.ok) void modes.reload();
  };
  const screenshot = async () => {
    const r = await b.takeScreenshot();
    setMsg(r.ok ? { kind: 'ok', text: `Saved to ${r.path}` } : { kind: 'err', text: errText(r, 'Screenshot failed') });
  };

  return (
    <div className="settings-sections">
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Section title="Brightness & color">
        <Row label="Brightness" desc="Adjusts the built-in display backlight">
          <Slider label="Brightness" value={brightness} disabled={!b.available} onChange={setBrightness} onCommit={commitBrightness} />
        </Row>
        <Row label="Night light" desc={night.data?.ok && night.data.state !== 'unknown' ? `Windows night light is ${night.data.state}` : 'Warm tint to reduce eye strain on night shift'}>
          <Toggle label="Night light" on={Boolean(sys?.nightLightOn)} disabled={!sys} onChange={(v) => sys?.setNightLight(v)} />
        </Row>
        {sys?.nightLightOn && (
          <Row label="Night light strength">
            <Slider label="Night light strength" value={sys.nightLightIntensity} onChange={(v) => sys.setNightLight(true, v)} />
          </Row>
        )}
      </Section>

      <Section title="Scale & layout">
        <Row label="Display resolution" desc={current ? `Current: ${current.width}×${current.height} @ ${current.refreshHz} Hz` : b.extendedAvailable ? 'Reading supported modes…' : NEEDS_UPDATE_NOTE}>
          <select
            className="settings-select"
            aria-label="Display resolution"
            disabled={!list.length}
            value={current ? `${current.width}x${current.height}` : ''}
            onChange={(e) => void applyResolution(e.target.value)}
          >
            {!list.length && <option value="">—</option>}
            {list.map((m) => <option key={`${m.width}x${m.height}`} value={`${m.width}x${m.height}`}>{m.width} × {m.height}</option>)}
          </select>
        </Row>
        <Row label="Display orientation" desc="Rotation persists across sign-out">
          <div className="rotation-options">
            {[0, 90, 180, 270].map((deg) => (
              <button
                key={deg}
                type="button"
                className={`rotation-btn ${current?.rotation === deg ? 'active' : ''}`}
                disabled={!b.extendedAvailable}
                onClick={() => void rotate(deg)}
              >
                <RotateCcw size={12} style={{ transform: `rotate(${deg}deg)` }} /> {deg === 0 ? 'Landscape' : deg === 180 ? 'Landscape (flipped)' : deg === 90 ? 'Portrait' : 'Portrait (flipped)'}
              </button>
            ))}
          </div>
        </Row>
      </Section>

      <Section title="Displays">
        {displays.loading ? <div className="settings-loading">Detecting displays…</div>
          : !displays.data?.length ? <Note>{b.available ? 'No displays reported.' : NOT_ELECTRON_NOTE}</Note>
          : displays.data.map((d: DisplayInfo, i: number) => (
            <Row key={d.id} label={`Display ${i + 1}`} desc={`${d.bounds.width} × ${d.bounds.height} at (${d.bounds.x}, ${d.bounds.y})`}>
              <span className={`display-badge ${d.primary ? 'primary' : ''}`}>{d.primary ? 'Primary' : 'Secondary'}</span>
            </Row>
          ))}
        <Row label="Screenshot" desc="Saves a full-screen PNG to Pictures › RMPG Flex Screenshots">
          <button type="button" className="settings-btn-sm" disabled={!b.available} onClick={() => void screenshot()}><Camera size={13} /> Capture</button>
        </Row>
      </Section>
    </div>
  );
}

const SOUND_TESTS = [
  { name: 'Asterisk', label: 'Asterisk' }, { name: 'Beep', label: 'Beep' }, { name: 'Exclamation', label: 'Exclamation' },
  { name: 'Hand', label: 'Critical stop' }, { name: 'Question', label: 'Question' },
];

function SoundTab({ b }: { b: WindowsBridge }) {
  const sys = useOptionalDesktopSystem();
  const [volume, setVolume] = useState<number>(sys?.volume ?? 50);
  const [muted, setMuted] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const devices = useLoader(() => b.getAudioDevices(), [b]);

  useEffect(() => {
    void b.getVolume().then((v) => { if (typeof v === 'number') setVolume(Math.round(v)); });
    void b.getMute().then((r) => { if (r.ok) setMuted(r.muted); });
  }, [b]);
  const commitVolume = useDebouncedCallback((v: number) => { void b.setVolume(v); sys?.setVolume(v); }, 150);

  const toggleMute = async () => {
    const r = await b.setMute(!muted);
    if (r.ok) setMuted(r.muted); else setMsg(errText(r, 'Could not change mute'));
  };
  const setDefault = async (id: string) => {
    const r = await b.setDefaultAudioDevice(id);
    setMsg(r.ok ? 'Default output changed' : errText(r, 'Could not set default device'));
    if (r.ok) void devices.reload();
  };

  const list: AudioDevice[] = devices.data?.ok ? devices.data.devices : [];

  return (
    <div className="settings-sections">
      {msg && <Msg kind="err">{msg}</Msg>}
      <Section title="Output">
        <Row label="Master volume">
          <button type="button" className={`mute-btn ${muted ? 'muted' : ''}`} aria-label={muted ? 'Unmute' : 'Mute'} disabled={!b.extendedAvailable} onClick={() => void toggleMute()}>
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <Slider label="Master volume" value={volume} disabled={!b.available} onChange={setVolume} onCommit={commitVolume} />
        </Row>
      </Section>
      <Section title="Test sounds">
        <div className="sound-test-grid">
          {SOUND_TESTS.map((s) => (
            <button key={s.name} type="button" className="sound-test-btn" disabled={!b.extendedAvailable} onClick={() => void b.playSystemSound(s.name)}>
              <Play size={18} className="sound-icon" />
              <span>{s.label}</span>
              <span className="play-hint">Windows {s.name}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Audio devices">
        {devices.loading ? <div className="settings-loading">Enumerating endpoints…</div>
          : !list.length ? <Note>{b.extendedAvailable ? errText(devices.data, 'No audio endpoints found.') || 'No audio endpoints found.' : NEEDS_UPDATE_NOTE}</Note>
          : list.map((d) => (
            <Row key={d.id || d.name} label={d.name} desc={d.status}>
              <button type="button" className="settings-btn-sm" onClick={() => void setDefault(d.id)}>Set default</button>
            </Row>
          ))}
      </Section>
    </div>
  );
}

function SignalBars({ pct }: { pct: number }) {
  const lit = pct >= 80 ? 4 : pct >= 55 ? 3 : pct >= 30 ? 2 : pct > 0 ? 1 : 0;
  return (
    <span className="signal-bar-group" aria-label={`Signal ${pct}%`}>
      {[6, 10, 14, 18].map((h, i) => <span key={h} className={`signal-bar-item ${i < lit ? 'active' : ''}`} style={{ height: h }} />)}
    </span>
  );
}

function wifiSignal(n: WifiNetwork): number {
  const v = n.signalPercent ?? n.signal ?? 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}
function wifiSecured(n: WifiNetwork): boolean {
  if (typeof n.secured === 'boolean') return n.secured;
  const a = (n.auth ?? n.authentication ?? '').toLowerCase();
  return a !== '' && a !== 'open';
}

function NetworkTab({ b }: { b: WindowsBridge }) {
  const detail = useLoader<WifiDetail | null>(() => b.wifiGetDetail(), [b]);
  const adapters = useLoader(() => b.getNetAdapters(), [b]);
  const [networks, setNetworks] = useState<WifiNetwork[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [host, setHost] = useState('api.rmpgutah.us');
  const [ping, setPing] = useState<PingResult | null>(null);
  const [pinging, setPinging] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const scan = async () => {
    setScanning(true);
    try {
      const list = await b.wifiScanNetworks();
      setNetworks(Array.isArray(list) ? [...list].sort((x, y) => wifiSignal(y) - wifiSignal(x)) : []);
    } finally { setScanning(false); }
  };
  const connect = async (ssid: string) => {
    const r = await b.wifiConnect(ssid);
    setMsg(r?.ok ? `Connecting to ${ssid}…` : r?.error || 'No saved profile for that network — add it in Windows first.');
    setTimeout(() => void detail.reload(), 3000);
  };
  const doPing = async () => {
    setPinging(true);
    try { setPing(await b.ping(host.trim())); } finally { setPinging(false); }
  };
  const wifiUp = adapters.data?.ok ? adapters.data.adapters.some((a) => a.isWifi && a.up) : Boolean(detail.data?.ssid);
  const toggleWifi = async (on: boolean) => {
    const r = await b.toggleWifi(on);
    setMsg(r.ok ? `Wi-Fi ${on ? 'enabled' : 'disabled'}` : errText(r, 'Could not toggle Wi-Fi (may need administrator rights)'));
    setTimeout(() => { void adapters.reload(); void detail.reload(); }, 2500);
  };

  const d = detail.data;
  const adapterList: NetAdapter[] = adapters.data?.ok ? adapters.data.adapters : [];

  return (
    <div className="settings-sections">
      {msg && <Msg kind="ok">{msg}</Msg>}
      <Section title="Status">
        <div className="net-status-grid">
          <div className="net-info-item"><span className="net-info-label">Network</span><span className="net-info-value">{d?.ssid || (b.available ? 'Not connected' : '—')}</span></div>
          <div className="net-info-item"><span className="net-info-label">Signal</span><span className="net-info-value">{typeof d?.signal === 'number' ? `${d.signal}%` : '—'}</span></div>
          <div className="net-info-item"><span className="net-info-label">IPv4</span><span className="net-info-value">{(d?.ip as string) || '—'}</span></div>
        </div>
        <Row label="Wi-Fi" desc={wifiUp ? 'Adapter is up' : 'Adapter is down or absent'}>
          <Toggle label="Wi-Fi" on={wifiUp} disabled={!b.extendedAvailable} onChange={(v) => void toggleWifi(v)} />
        </Row>
      </Section>

      <Section title="Adapters">
        {adapters.loading ? <div className="settings-loading">Reading adapters…</div>
          : !adapterList.length ? <Note>{b.extendedAvailable ? 'No physical adapters reported.' : NEEDS_UPDATE_NOTE}</Note>
          : adapterList.map((a) => (
            <div key={a.name} className="adapter-card">
              <div className="adapter-header">
                {a.isWifi ? <Wifi size={20} className="adapter-icon" /> : <Radio size={20} className="adapter-icon" />}
                <div><div className="adapter-name">{a.name}</div><div className="adapter-type">{a.description}</div></div>
                <span className={`adapter-status ${a.up ? 'up' : 'down'}`}>{a.status}</span>
              </div>
              <div className="adapter-details">
                <div className="net-info-item"><span className="net-info-label">MAC</span><span className="net-info-value">{a.mac || '—'}</span></div>
                <div className="net-info-item"><span className="net-info-label">Link</span><span className="net-info-value">{a.linkSpeed || '—'}</span></div>
                <div className="net-info-item"><span className="net-info-label">Media</span><span className="net-info-value">{a.mediaType || '—'}</span></div>
              </div>
            </div>
          ))}
      </Section>

      <Section title="Available networks">
        <Row label="Scan for networks" desc="Connects using a profile already saved on this device">
          <button type="button" className="settings-btn-sm" disabled={!b.available || scanning} onClick={() => void scan()}><RefreshCw size={13} /> {scanning ? 'Scanning…' : 'Scan'}</button>
        </Row>
        {networks && (
          <div className="wifi-networks-list">
            {!networks.length && <Note>No networks found.</Note>}
            {networks.map((n) => (
              <div key={`${n.ssid}-${n.bssid ?? ''}`} className="wifi-network-item">
                <div className="wifi-left">
                  <SignalBars pct={wifiSignal(n)} />
                  <div style={{ minWidth: 0 }}>
                    <div className="wifi-ssid">{n.ssid || '(hidden)'}</div>
                    <div className="wifi-signal">{wifiSignal(n)}% · {wifiSecured(n) ? 'Secured' : 'Open'}{n.channel ? ` · ch ${n.channel}` : ''}</div>
                  </div>
                </div>
                {wifiSecured(n) && <Lock size={13} className="wifi-lock" />}
                <button type="button" className="settings-btn-sm" disabled={!n.ssid || d?.ssid === n.ssid} onClick={() => void connect(n.ssid)}>{d?.ssid === n.ssid ? 'Connected' : 'Connect'}</button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Diagnostics">
        <Row label="Ping" desc="Four ICMP echo requests">
          <div className="settings-input-row">
            <input className="settings-input" aria-label="Ping host" value={host} onChange={(e) => setHost(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void doPing(); }} />
            <button type="button" className="settings-btn-sm" disabled={!b.extendedAvailable || pinging || !host.trim()} onClick={() => void doPing()}><Send size={13} /> {pinging ? 'Pinging…' : 'Ping'}</button>
          </div>
        </Row>
        {ping && (
          <div className={`ping-result ${ping.ok ? 'success' : 'fail'}`}>
            <span>{ping.host}</span>
            <span>{ping.ok ? `${ping.received}/${ping.sent} replies · avg ${ping.avgMs} ms · max ${ping.maxMs} ms` : ping.error && ping.error !== 'not_electron' ? errText(ping) : ping.sent ? `${ping.lost}/${ping.sent} lost — unreachable` : errText(ping, 'Ping unavailable')}</span>
          </div>
        )}
      </Section>
    </div>
  );
}

function BluetoothTab({ b }: { b: WindowsBridge }) {
  const bt = useLoader(() => b.getBluetoothDevices(), [b]);
  const [msg, setMsg] = useState<string | null>(null);
  const data = bt.data?.ok ? bt.data : null;
  const toggle = async (on: boolean) => {
    const r = await b.toggleBluetooth(on);
    setMsg(r.ok ? `Bluetooth radio ${on ? 'enabled' : 'disabled'}` : errText(r, 'Could not toggle Bluetooth (may need administrator rights)'));
    setTimeout(() => void bt.reload(), 2500);
  };
  const devices: BluetoothDevice[] = data?.devices.filter((d) => !d.isRadio) ?? [];
  return (
    <div className="settings-sections">
      {msg && <Msg kind="ok">{msg}</Msg>}
      <Section title="Radio">
        <Row label="Bluetooth" desc={data ? (data.radioPresent ? (data.radioEnabled ? 'Radio is on' : 'Radio is off') : 'No Bluetooth radio detected') : b.extendedAvailable ? 'Reading…' : NEEDS_UPDATE_NOTE}>
          <Toggle label="Bluetooth" on={Boolean(data?.radioEnabled)} disabled={!data?.radioPresent} onChange={(v) => void toggle(v)} />
        </Row>
        <Row label="Refresh device list">
          <button type="button" className="settings-btn-sm" disabled={!b.extendedAvailable} onClick={() => void bt.reload()}><RefreshCw size={13} /> Refresh</button>
        </Row>
      </Section>
      <Section title="Paired devices">
        {bt.loading ? <div className="settings-loading">Enumerating Bluetooth devices…</div>
          : !devices.length ? <Note>{data ? 'No paired devices.' : errText(bt.data, 'Bluetooth unavailable.')}</Note>
          : devices.map((d) => (
            <Row key={d.instanceId || d.name} label={d.name} desc={d.instanceId}>
              <span className={`adapter-status ${d.ok ? 'up' : 'down'}`}>{d.status}</span>
            </Row>
          ))}
      </Section>
    </div>
  );
}

function NotificationsTab({ b }: { b: WindowsBridge }) {
  const sys = useOptionalDesktopSystem();
  const [msg, setMsg] = useState<string | null>(null);
  const [title, setTitle] = useState('RMPG Flex');
  const [body, setBody] = useState('Test notification from Settings');
  const sendToast = async () => {
    const r = await b.sendNativeToast(title, body);
    if (r.ok) { setMsg('Native toast sent'); return; }
    await b.showNotification(title, body);
    setMsg(b.available ? 'Notification sent' : NOT_ELECTRON_NOTE);
  };
  return (
    <div className="settings-sections">
      {msg && <Msg kind="ok">{msg}</Msg>}
      <Section title="Focus">
        <Row label="Do not disturb" desc="Suppresses non-critical pop-ups. Priority 1 alerts always break through.">
          <Toggle label="Do not disturb" on={Boolean(sys?.dndOn)} disabled={!sys} onChange={(v) => sys?.setDnd(v)} />
        </Row>
        <Row label="Focus assist" desc="Which notifications are shown while on a call">
          <select className="settings-select" aria-label="Focus assist" disabled={!sys} value={sys?.focusAssist ?? 'off'} onChange={(e) => sys?.setFocusAssist(e.target.value as FocusAssistLevel)}>
            <option value="off">Off</option>
            <option value="priority">Priority only</option>
            <option value="alarms-only">Alarms only</option>
          </select>
        </Row>
      </Section>
      <Section title="Test">
        <Row label="Title"><input className="settings-input" aria-label="Notification title" value={title} onChange={(e) => setTitle(e.target.value)} /></Row>
        <Row label="Body"><input className="settings-input" aria-label="Notification body" value={body} onChange={(e) => setBody(e.target.value)} /></Row>
        <Row label="Send test notification" desc="Uses the Windows Action Center when available">
          <button type="button" className="settings-btn-primary" disabled={!b.available} onClick={() => void sendToast()}><Bell size={13} /> Send</button>
        </Row>
      </Section>
    </div>
  );
}

function batteryPercent(bat: BatteryStatus | null): number | null {
  if (!bat) return null;
  const v = (bat.percent ?? (bat as { level?: number }).level ?? (bat as { charge?: number }).charge) as number | undefined;
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

function PowerTab({ b }: { b: WindowsBridge }) {
  const bat = useLoader(() => b.getBattery(), [b]);
  const idle = useLoader(() => b.getIdleTime(), [b]);
  const [awake, setAwake] = useState(false);
  const [confirm, setConfirm] = useState<'shutdown' | 'restart' | 'restartApp' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const pct = batteryPercent(bat.data);
  const charging = Boolean(bat.data?.charging) || /charg/i.test(String(bat.data?.status ?? ''));
  const fill = pct === null ? 'var(--s-text-tertiary)' : pct <= 20 ? 'var(--s-danger)' : pct <= 45 ? 'var(--s-warning)' : 'var(--s-success)';

  const run = async () => {
    const which = confirm; setConfirm(null);
    if (!which) return;
    const r = which === 'shutdown' ? await b.shutdownOs() : which === 'restart' ? await b.restartOs() : (await b.restartApp(), { ok: true });
    if (r && !r.ok && r.error !== 'cancelled') setMsg(errText(r, 'Power action failed'));
  };
  const toggleAwake = async (on: boolean) => { setAwake(on); if (on) await b.keepAwake(); else await b.allowSleep(); };

  return (
    <div className="settings-sections">
      {msg && <Msg kind="err">{msg}</Msg>}
      {confirm && (
        <ConfirmDialog
          title={confirm === 'shutdown' ? 'Shut down this computer?' : confirm === 'restart' ? 'Restart this computer?' : 'Restart RMPG Flex?'}
          body={confirm === 'restartApp' ? 'Unsaved report text in open windows will be lost.' : 'Any unsynced offline queue items are kept and resume on next start. Active call context is preserved on the server.'}
          confirmLabel={confirm === 'shutdown' ? 'Shut down' : 'Restart'}
          danger={confirm !== 'restartApp'}
          onConfirm={() => void run()}
          onCancel={() => setConfirm(null)}
        />
      )}
      <Section title="Battery">
        <div className="power-status-card">
          <BatteryCharging size={34} className="power-status-icon" />
          <div className="power-status-info">
            <div className="power-status-label">{pct === null ? (b.available ? 'No battery reported (AC power)' : NOT_ELECTRON_NOTE) : charging ? 'Charging' : 'On battery'}</div>
            <div className="battery-bar-wrap">
              <div className="battery-bar"><div className="battery-fill" style={{ width: `${pct ?? 0}%`, background: fill }} /></div>
              <span className="battery-pct">{pct === null ? '—' : `${pct}%`}</span>
            </div>
          </div>
        </div>
      </Section>
      <Section title="Sleep">
        <Row label="Keep display awake" desc="Blocks display sleep during patrol. Released automatically on trip end.">
          <Toggle label="Keep display awake" on={awake} disabled={!b.available} onChange={(v) => void toggleAwake(v)} />
        </Row>
        <Row label="Idle time" desc="Seconds since last input">
          <span className="slider-value">{typeof idle.data === 'number' ? `${Math.round(idle.data)} s` : '—'}</span>
          <button type="button" className="settings-btn-xs" aria-label="Refresh idle time" onClick={() => void idle.reload()}><RefreshCw size={12} /></button>
        </Row>
      </Section>
      <Section title="Power actions">
        <Row label="Restart RMPG Flex" desc="Relaunches the desktop app only">
          <button type="button" className="settings-power-btn" disabled={!b.available} onClick={() => setConfirm('restartApp')}><RefreshCw size={13} /> Restart app</button>
        </Row>
        <Row label="Restart computer">
          <button type="button" className="settings-power-btn" disabled={!b.available} onClick={() => setConfirm('restart')}><RotateCcw size={13} /> Restart</button>
        </Row>
        <Row label="Shut down">
          <button type="button" className="settings-power-btn danger" disabled={!b.available} onClick={() => setConfirm('shutdown')}><Power size={13} /> Shut down</button>
        </Row>
      </Section>
    </div>
  );
}

function StorageTab({ b }: { b: WindowsBridge }) {
  const drives = useLoader(() => b.getDrives(), [b]);
  const disk = useLoader(() => b.checkDiskSpace(), [b]);
  const recent = useLoader(() => b.getRecentFiles(25), [b]);
  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const list: DriveInfo[] = drives.data?.ok ? drives.data.drives : [];
  const files: RecentFile[] = recent.data?.ok ? recent.data.files : [];

  const recycle = async () => {
    const p = confirmPath; setConfirmPath(null);
    if (!p) return;
    const r = await b.recycleItem(p);
    setMsg(r.ok ? 'Moved to Recycle Bin' : errText(r, 'Could not recycle'));
    if (r.ok) void recent.reload();
  };

  return (
    <div className="settings-sections">
      {msg && <Msg kind="ok">{msg}</Msg>}
      {confirmPath && <ConfirmDialog title="Move to Recycle Bin?" body={confirmPath} confirmLabel="Recycle" danger onConfirm={() => void recycle()} onCancel={() => setConfirmPath(null)} />}
      <Section title="Drives">
        {drives.loading ? <div className="settings-loading">Reading volumes…</div>
          : !list.length ? (
            <Row label="App data volume" desc={disk.data?.warn ? 'Low disk space' : 'Free space on the RMPG Flex data volume'}>
              <span className="slider-value">{disk.data ? `${fmtBytes(disk.data.freeBytes)} free` : b.extendedAvailable ? '—' : NEEDS_UPDATE_NOTE}</span>
            </Row>
          )
          : list.map((d) => (
            <div key={d.letter} className="drive-settings-card">
              <div className="drive-settings-header">
                <span className="drive-settings-letter">{d.letter}:</span>
                <span className="drive-settings-label">{d.label || d.root}</span>
                <button type="button" className="settings-btn-xs" aria-label={`Open ${d.letter}: drive`} onClick={() => void b.openFolder(d.root)}><FolderOpen size={13} /></button>
              </div>
              <div className="drive-settings-bar-wrap">
                <div className="drive-settings-bar"><div className="drive-settings-fill" style={{ width: `${d.usedPercent}%`, background: d.usedPercent >= 90 ? 'var(--s-danger)' : d.usedPercent >= 75 ? 'var(--s-warning)' : 'var(--s-accent)' }} /></div>
                <span className="drive-settings-pct">{d.usedPercent}%</span>
              </div>
              <div className="drive-settings-detail"><span>{fmtBytes(d.usedBytes)} used</span><span>{fmtBytes(d.freeBytes)} free</span><span>{fmtBytes(d.totalBytes)} total</span></div>
            </div>
          ))}
      </Section>
      <Section title="Recent files">
        {recent.loading ? <div className="settings-loading">Reading recent items…</div>
          : !files.length ? <Note>{b.extendedAvailable ? 'No recent files.' : NEEDS_UPDATE_NOTE}</Note>
          : files.map((f) => (
            <div key={f.path} className="recent-file-item">
              <ScrollText size={16} className="recent-file-icon" />
              <div className="recent-file-info"><span className="recent-file-name">{f.name}</span><span className="recent-file-path">{fmtTime(f.modifiedAt)}</span></div>
              <button type="button" className="settings-btn-xs" aria-label={`Recycle shortcut ${f.name}`} onClick={() => setConfirmPath(f.path)}><Trash2 size={13} /></button>
            </div>
          ))}
      </Section>
    </div>
  );
}

function AppsTab({ b }: { b: WindowsBridge }) {
  const apps = useLoader(() => b.getInstalledApps(), [b]);
  const launchable = useLoader(() => b.getLaunchableApps(), [b]);
  const procs = useLoader(() => b.getProcesses(), [b]);
  const [q, setQ] = useState('');
  const [killPid, setKillPid] = useState<ProcessInfo | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const installed: InstalledApp[] = apps.data?.ok ? apps.data.apps : [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? installed.filter((a) => a.name.toLowerCase().includes(needle) || a.publisher.toLowerCase().includes(needle)) : installed;
  }, [installed, q]);
  const quick: LaunchableApp[] = launchable.data?.ok ? launchable.data.apps : [];
  const processes: ProcessInfo[] = procs.data?.ok ? procs.data.processes.slice(0, 40) : [];

  const kill = async () => {
    const p = killPid; setKillPid(null);
    if (!p) return;
    const r = await b.killProcess(p.pid);
    setMsg(r.ok ? `Ended ${p.name} (${p.pid})` : errText(r, 'Could not end process'));
    if (r.ok) void procs.reload();
  };

  return (
    <div className="settings-sections">
      {msg && <Msg kind="ok">{msg}</Msg>}
      {killPid && <ConfirmDialog title={`End ${killPid.name}?`} body={`PID ${killPid.pid}. Unsaved work in that program will be lost.`} confirmLabel="End process" danger onConfirm={() => void kill()} onCancel={() => setKillPid(null)} />}
      <Section title="Quick launch">
        <div className="rotation-options" style={{ padding: 12 }}>
          {quick.length ? quick.map((a) => (
            <button key={a.id} type="button" className="rotation-btn" onClick={() => void b.launchApp(a.id).then((r) => { if (!r.ok) setMsg(errText(r, 'Launch failed')); })}><AppWindow size={12} /> {a.label}</button>
          )) : <Note>{b.extendedAvailable ? 'No launchable apps.' : NEEDS_UPDATE_NOTE}</Note>}
        </div>
      </Section>
      <Section title="Installed apps">
        <div className="apps-search">
          <Search size={14} />
          <input className="settings-input" aria-label="Search installed apps" placeholder="Search by name or publisher" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="apps-count">{filtered.length} of {installed.length}</span>
        </div>
        <div className="apps-list">
          {apps.loading ? <div className="settings-loading">Reading registry…</div>
            : !filtered.length ? <Note>{installed.length ? 'No matches.' : b.extendedAvailable ? 'Nothing reported.' : NEEDS_UPDATE_NOTE}</Note>
            : filtered.map((a) => (
              <div key={`${a.name}|${a.version}`} className="app-list-item">
                <AppWindow size={16} className="app-list-icon" />
                <div className="app-list-info"><span className="app-list-name">{a.name}</span><span className="app-list-meta">{[a.version, a.publisher].filter(Boolean).join(' · ')}</span></div>
              </div>
            ))}
        </div>
      </Section>
      <Section title="Running processes">
        <Row label="Top 40 by CPU time" desc="Ending a process is immediate and cannot be undone">
          <button type="button" className="settings-btn-sm" disabled={!b.extendedAvailable} onClick={() => void procs.reload()}><RefreshCw size={13} /> Refresh</button>
        </Row>
        <div className="apps-list">
          {processes.map((p) => (
            <div key={p.pid} className="app-list-item">
              <div className="app-list-info"><span className="app-list-name">{p.name}{p.windowTitle ? ` — ${p.windowTitle}` : ''}</span><span className="app-list-meta">PID {p.pid} · {fmtBytes(p.memoryBytes)} · {p.cpuSeconds.toFixed(1)} s CPU</span></div>
              <button type="button" className="settings-btn-sm danger" onClick={() => setKillPid(p)}>End</button>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function ClipboardTab({ b }: { b: WindowsBridge }) {
  const sys = useOptionalDesktopSystem();
  const [current, setCurrent] = useState<string>('');
  const [history, setHistory] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const lastRef = useRef<string>('');

  useEffect(() => {
    if (!b.available) return;
    let alive = true;
    const tick = async () => {
      const t = await b.getClipboardText();
      if (!alive || typeof t !== 'string') return;
      setCurrent(t);
      if (t && t !== lastRef.current) {
        lastRef.current = t;
        setHistory((h) => [t, ...h.filter((x) => x !== t)].slice(0, 20));
      }
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [b]);

  const write = async (text: string) => {
    await b.setClipboardText(text);
    sys?.addClipboardEntry(text);
    setCurrent(text);
    setMsg('Copied to clipboard');
  };

  return (
    <div className="settings-sections">
      {msg && <Msg kind="ok">{msg}</Msg>}
      <Section title="Current clipboard">
        <div className="clipboard-current">
          <pre className="clipboard-preview">{current || (b.available ? '(empty)' : NOT_ELECTRON_NOTE)}</pre>
          <div className="clipboard-actions">
            <span className="clipboard-length">{current.length} characters · refreshes every 2 s</span>
            <button type="button" className="settings-btn-sm" disabled={!b.available} onClick={() => void write('')}>Clear</button>
          </div>
        </div>
      </Section>
      <Section title="Write to clipboard">
        <div className="clipboard-write">
          <textarea className="settings-textarea" aria-label="Clipboard text" placeholder="Text to place on the clipboard" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="settings-btn-primary" disabled={!b.available || !draft} onClick={() => void write(draft)}><ClipboardList size={13} /> Copy</button>
          </div>
        </div>
      </Section>
      <Section title="History (this session)">
        <div className="clipboard-history">
          {!history.length ? <Note>Nothing captured yet.</Note> : history.map((h, i) => (
            <div key={`${i}-${h.slice(0, 16)}`} className="clipboard-history-item">
              <span className="clipboard-history-text">{h}</span>
              <button type="button" className="settings-btn-xs" aria-label="Copy history entry" onClick={() => void write(h)}><ClipboardList size={12} /></button>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function EventLogTab({ b }: { b: WindowsBridge }) {
  const [logName, setLogName] = useState<'System' | 'Application'>('System');
  const [level, setLevel] = useState<'all' | 'critical' | 'error' | 'warning' | 'information'>('all');
  const events = useLoader(() => b.getEventLog({ logName, level, maxEvents: 100 }), [b, logName, level]);
  const list: EventLogEntry[] = events.data?.ok ? events.data.events : [];
  const levelColor = (l: string) => l === 'critical' || l === 'error' ? 'var(--s-danger)' : l === 'warning' ? 'var(--s-warning)' : 'var(--s-text-secondary)';
  return (
    <div className="settings-sections">
      <Section title="Windows event log">
        <div className="eventlog-filters">
          <div className="filter-group">
            <label htmlFor="settings-eventlog-log">Log</label>
            <select id="settings-eventlog-log" className="settings-select" value={logName} onChange={(e) => setLogName(e.target.value as 'System' | 'Application')}>
              <option value="System">System</option>
              <option value="Application">Application</option>
            </select>
          </div>
          <div className="filter-group">
            <label htmlFor="settings-eventlog-level">Level</label>
            <select id="settings-eventlog-level" className="settings-select" value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
              <option value="all">All</option><option value="critical">Critical</option><option value="error">Error</option><option value="warning">Warning</option><option value="information">Information</option>
            </select>
          </div>
          <button type="button" className="settings-btn-sm" style={{ alignSelf: 'flex-end' }} disabled={!b.extendedAvailable} onClick={() => void events.reload()}><RefreshCw size={13} /> Refresh</button>
        </div>
        <div className="eventlog-list">
          {events.loading ? <div className="settings-loading">Querying {logName} log…</div>
            : !list.length ? <Note>{b.extendedAvailable ? errText(events.data, 'No events match.') || 'No events match.' : NEEDS_UPDATE_NOTE}</Note>
            : list.map((e, i) => (
              <div key={`${e.id}-${e.time}-${i}`} className="eventlog-item">
                <div className="eventlog-item-header">
                  <span className="eventlog-level" style={{ color: levelColor(e.level) }}><ShieldAlert size={12} /> {e.level.toUpperCase()}</span>
                  <span className="eventlog-source">{e.source} · ID {e.id}</span>
                  <span className="eventlog-time">{fmtTime(e.time)}</span>
                </div>
                <p className="eventlog-message">{e.message || '(no message)'}</p>
              </div>
            ))}
        </div>
      </Section>
    </div>
  );
}

function AccountTab() {
  const { user } = useAuth();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const pinValid = /^\d{4,6}$/.test(pin);
  const mismatch = confirm.length > 0 && confirm !== pin;

  const save = async () => {
    if (!pinValid || pin !== confirm) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch<{ ok: boolean; error?: string }>('/auth/set-pin', { method: 'POST', body: JSON.stringify({ pin }) });
      if (r.ok) { setMsg({ kind: 'ok', text: 'Lock-screen PIN updated' }); setPin(''); setConfirm(''); }
      else setMsg({ kind: 'err', text: r.error || 'Could not update PIN' });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Could not update PIN' });
    } finally { setBusy(false); }
  };

  const initials = user ? `${user.first_name?.[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase() || user.username.slice(0, 2).toUpperCase() : '?';
  return (
    <div className="settings-sections">
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Section title="Signed in">
        <div className="account-profile-card">
          <div className="account-avatar">{initials}</div>
          <div>
            <div className="account-name">{user?.full_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || 'Not signed in'}</div>
            <div className="account-badge">{user?.badge_number ? `Badge ${user.badge_number} · ` : ''}{user?.username ?? ''}</div>
            {user?.role && <span className="account-role">{formatEnumValue(user.role)}</span>}
          </div>
        </div>
      </Section>
      <Section title="Lock-screen PIN">
        <Row label="New PIN" desc="4–6 digits. Used to unlock the desktop lock screen and offline mode.">
          <input className={`settings-input pin-input ${pin && !pinValid ? 'input-error' : ''}`} aria-label="New PIN" type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        </Row>
        <Row label="Confirm PIN" desc={mismatch ? 'PINs do not match' : undefined}>
          <input className={`settings-input pin-input ${mismatch ? 'input-error' : ''}`} aria-label="Confirm PIN" type="password" inputMode="numeric" maxLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))} />
        </Row>
        <Row label="Save">
          <button type="button" className="settings-btn-primary" disabled={!pinValid || pin !== confirm || busy || !user} onClick={() => void save()}><Check size={13} /> {busy ? 'Saving…' : 'Update PIN'}</button>
        </Row>
      </Section>
    </div>
  );
}

const KIOSK_SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: 'Ctrl + Alt + Shift + K', action: 'Kiosk escape prompt (supervisor credentials)' },
  { keys: 'Ctrl + Shift + L', action: 'Lock the desktop' },
  { keys: 'Win + D', action: 'Show desktop' },
  { keys: 'Ctrl + Shift + P', action: 'Command palette' },
  { keys: 'Alt + Tab', action: 'Switch windows' },
];

function KioskTab({ b, onRequestExitKiosk }: { b: WindowsBridge; onRequestExitKiosk?: () => void }) {
  const kiosk = useLoader<KioskShellState | null>(() => b.getKioskShellState(), [b]);
  const auto = useLoader(() => b.getAutoLaunchState(), [b]);
  const tasks = useLoader(() => b.getScheduledTasks(), [b]);
  const [confirm, setConfirm] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [unitVar, setUnitVar] = useState('');

  const applyKiosk = async () => {
    const enable = confirm; setConfirm(null);
    if (enable === null) return;
    const r = await b.setKioskShell(enable);
    setMsg(r?.ok ? { kind: 'ok', text: `Kiosk shell ${enable ? 'enabled' : 'disabled'} — takes effect at next sign-in` } : { kind: 'err', text: r?.error || 'Could not change kiosk shell' });
    void kiosk.reload();
  };
  const saveUnitVar = async () => {
    const r = await b.setEnvVar('RMPG_UNIT_ID', unitVar.trim() || null);
    setMsg(r.ok ? { kind: 'ok', text: 'Unit ID saved to the user environment' } : { kind: 'err', text: errText(r, 'Could not save') });
  };
  const taskList: ScheduledTask[] = tasks.data?.ok ? tasks.data.tasks : [];
  const k = kiosk.data;

  return (
    <div className="settings-sections">
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {confirm !== null && (
        <ConfirmDialog
          title={confirm ? 'Enable kiosk shell?' : 'Disable kiosk shell?'}
          body={confirm ? 'RMPG Flex replaces the Windows shell at sign-in. The escape shortcut and supervisor credentials remain available. After 3 failed boots the shell self-reverts to Explorer.' : 'Windows Explorer becomes the shell again at next sign-in.'}
          confirmLabel={confirm ? 'Enable' : 'Disable'}
          danger={Boolean(confirm)}
          onConfirm={() => void applyKiosk()}
          onCancel={() => setConfirm(null)}
        />
      )}
      <Section title="Shell">
        <Row label="Kiosk shell" desc={k ? (k.supported ? (k.enabled ? 'RMPG Flex is the Windows shell' : 'Explorer is the Windows shell') : 'Only available on Windows (Toughbook / FZ-55)') : b.available ? 'Reading…' : NOT_ELECTRON_NOTE}>
          <Toggle label="Kiosk shell" on={Boolean(k?.enabled)} disabled={!k?.supported} onChange={(v) => setConfirm(v)} />
        </Row>
        <Row label="Launch at sign-in" desc="Start RMPG Flex automatically when Windows signs in">
          <Toggle label="Launch at sign-in" on={Boolean(auto.data)} disabled={!b.available} onChange={(v) => { void b.setAutoLaunch(v).then(() => auto.reload()); }} />
        </Row>
        <Row label="Return to Windows" desc="Closes the kiosk shell for this session. Requires supervisor credentials.">
          <button type="button" className="settings-btn-sm danger" disabled={!k?.enabled || !onRequestExitKiosk} onClick={onRequestExitKiosk}><X size={13} /> Exit kiosk</button>
        </Row>
      </Section>
      <Section title="Unit identity">
        <Row label="Unit ID environment variable" desc="Stored as RMPG_UNIT_ID in the user environment for edge tools">
          <div className="settings-input-row">
            <input className="settings-input" aria-label="Unit ID" placeholder="e.g. A12" maxLength={32} value={unitVar} onChange={(e) => setUnitVar(e.target.value)} />
            <button type="button" className="settings-btn-sm" disabled={!b.extendedAvailable} onClick={() => void saveUnitVar()}>Save</button>
          </div>
        </Row>
      </Section>
      <Section title="Keyboard shortcuts">
        {KIOSK_SHORTCUTS.map((s) => (
          <div key={s.keys} className="shortcut-row"><kbd className="shortcut-keys">{s.keys}</kbd><span className="shortcut-action">{s.action}</span></div>
        ))}
      </Section>
      <Section title="Scheduled tasks (non-Microsoft)">
        {tasks.loading ? <div className="settings-loading">Reading Task Scheduler…</div>
          : !taskList.length ? <Note>{b.extendedAvailable ? 'No custom scheduled tasks.' : NEEDS_UPDATE_NOTE}</Note>
          : taskList.map((t) => (
            <Row key={`${t.path}${t.name}`} label={t.name} desc={`${t.path}${t.author ? ` · ${t.author}` : ''}`}>
              <span className={`adapter-status ${t.state === 'Ready' || t.state === 'Running' ? 'up' : 'down'}`}>{t.state}</span>
            </Row>
          ))}
      </Section>
    </div>
  );
}

function AboutTab({ b }: { b: WindowsBridge }) {
  const info = useLoader<SystemInfo | null>(() => b.getSystemInfo(), [b]);
  const version = useLoader(() => b.getVersion(), [b]);
  const bridgeHealth = useLoader(() => b.getBridgeHealth(), [b]);
  const [perf, setPerf] = useState<SystemPerformance | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => { const r = await b.getSystemPerformance(); if (alive && r.ok) setPerf(r); };
    void tick();
    const id = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [b]);
  const i = info.data;
  const spec = (label: string, value: React.ReactNode) => (
    <div className="about-spec-row"><span className="about-spec-label">{label}</span><span className="about-spec-value">{value}</span></div>
  );
  return (
    <div className="settings-sections">
      <Section title="RMPG Flex">
        <div className="about-hero">
          <ShieldAlert size={40} className="about-logo" />
          <div>
            <div className="about-app-name">RMPG Flex Desktop</div>
            <div className="about-app-sub">Rocky Mountain Protective Group · CAD / RMS</div>
            <div className="about-app-version">App {version.data ?? '—'} · Web {import.meta.env.VITE_GIT_SHA ?? 'dev'} · {import.meta.env.MODE}</div>
          </div>
        </div>
      </Section>
      <Section title="Live performance">
        <div className="about-specs">
          {spec('CPU', perf ? `${perf.cpuBusyPercent ?? '—'}% busy · ${perf.cpuCount} cores` : b.extendedAvailable ? '…' : NEEDS_UPDATE_NOTE)}
          {spec('Memory', perf ? `${perf.memory.usedPercent}% · ${fmtBytes(perf.memory.totalBytes - perf.memory.freeBytes)} of ${fmtBytes(perf.memory.totalBytes)}` : '—')}
          {spec('Disk', perf?.disk ? `${fmtBytes(perf.disk.freeBytes)} free of ${fmtBytes(perf.disk.totalBytes)}` : i?.disk_free_gb != null ? `${i.disk_free_gb} GB free` : '—')}
          {spec('Uptime', fmtUptime(perf?.uptimeSeconds ?? i?.uptime_seconds))}
        </div>
      </Section>
      <Section title="Device">
        <div className="about-specs">
          {spec('FlexOS runtime', b.runtimeState === 'native' ? 'Native bridge connected' : b.runtimeState === 'bridge-unavailable' ? 'Detected — native bridge unavailable' : 'Web browser')}
          {spec('Native bridge', bridgeHealth.data ? `v${bridgeHealth.data.bridgeVersion} · Electron ${bridgeHealth.data.electronVersion ?? '—'}${bridgeHealth.data.kioskShell ? ' · Kiosk shell' : ''}` : b.available ? 'Unavailable' : '—')}
          {spec('Hostname', i?.hostname ?? perf?.hostname ?? '—')}
          {spec('Processor', i?.cpu_model ?? perf?.cpuModel ?? '—')}
          {spec('Installed RAM', i ? `${(i.total_memory_mb / 1024).toFixed(1)} GB` : '—')}
          {spec('OS', i ? `${i.platform} ${i.os_version} (${i.arch})` : b.available ? '…' : NOT_ELECTRON_NOTE)}
          {spec('Time zone', 'America/Denver')}
        </div>
      </Section>
    </div>
  );
}

// ─── Shell ───────────────────────────────────────────────────

export default function SettingsPanel({ initialTab = 'display', extraTabs = [], onRequestExitKiosk, bridgeOverride }: SettingsPanelProps) {
  const realBridge = useWindowsBridge();
  const b = bridgeOverride ?? realBridge;
  const { user } = useAuth();
  const allTabs: TabDef[] = useMemo(
    () => [...extraTabs.map((t) => ({ id: t.id, label: t.label, icon: t.icon, group: t.group ?? 'Desktop' })), ...SETTINGS_TABS],
    [extraTabs],
  );
  const [tab, setTab] = useState<string>(() => allTabs.some((t) => t.id === initialTab) ? initialTab : allTabs[0]?.id ?? 'display');
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, TabDef[]>();
    for (const t of allTabs) { if (!map.has(t.group)) { map.set(t.group, []); order.push(t.group); } map.get(t.group)!.push(t); }
    return order.map((g) => ({ group: g, tabs: map.get(g)! }));
  }, [allTabs]);
  const active = allTabs.find((t) => t.id === tab) ?? allTabs[0];
  const extra = extraTabs.find((t) => t.id === tab);
  const initials = user ? `${user.first_name?.[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase() || user.username.slice(0, 2).toUpperCase() : '—';

  const content = extra ? extra.render() : (() => {
    switch (tab as SettingsTabId) {
      case 'display': return <DisplayTab b={b} />;
      case 'sound': return <SoundTab b={b} />;
      case 'network': return <NetworkTab b={b} />;
      case 'bluetooth': return <BluetoothTab b={b} />;
      case 'notifications': return <NotificationsTab b={b} />;
      case 'power': return <PowerTab b={b} />;
      case 'storage': return <StorageTab b={b} />;
      case 'apps': return <AppsTab b={b} />;
      case 'clipboard': return <ClipboardTab b={b} />;
      case 'eventlog': return <EventLogTab b={b} />;
      case 'account': return <AccountTab />;
      case 'kiosk': return <KioskTab b={b} onRequestExitKiosk={onRequestExitKiosk} />;
      case 'about': return <AboutTab b={b} />;
      default: return null;
    }
  })();

  const ActiveIcon = active?.icon ?? Info;
  return (
    <div className="settings-root" data-testid="settings-root">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-header">
          <div className="settings-user-avatar" aria-hidden="true">{initials}</div>
          <div className="settings-user-info">
            <span className="settings-user-name">{user?.full_name || user?.username || 'Not signed in'}</span>
            <span className="settings-user-badge">{user?.badge_number ? `Badge ${user.badge_number}` : formatEnumValue(user?.role) ?? ''}</span>
          </div>
        </div>
        <nav className="settings-nav" aria-label="Settings sections">
          {groups.map(({ group, tabs }) => (
            <div key={group} className="settings-nav-group">
              <span className="settings-nav-group-label">{group}</span>
              {tabs.map((t) => {
                const Icon = t.icon;
                return (
                  <button key={t.id} type="button" className={`settings-nav-item ${t.id === tab ? 'active' : ''}`} aria-current={t.id === tab ? 'page' : undefined} onClick={() => setTab(t.id)}>
                    <Icon size={15} className="nav-icon" /> {t.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      <main className="settings-main">
        <header className="settings-content-header">
          <h2><ActiveIcon size={18} /> {active?.label}</h2>
        </header>
        <div className="settings-content-body">
          {!b.available && (
            <Msg kind="err">
              {b.shellDetected
                ? 'FlexOS is running, but its native system bridge did not load. Restart FlexOS to restore Windows controls.'
                : `${NOT_ELECTRON_NOTE} Controls are shown read-only.`}
            </Msg>
          )}
          {content}
        </div>
      </main>
    </div>
  );
}
