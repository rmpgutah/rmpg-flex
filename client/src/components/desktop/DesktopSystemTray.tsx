import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import {
  Wifi, WifiOff, BatteryCharging, BatteryLow, BatteryMedium,
  BatteryFull, BatteryWarning, RefreshCw, Cpu, Satellite,
  Radio, Signal,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../ToastProvider';
import { toastClockLinkWarnings, type ClockLinkFlags } from '../../utils/corporateOpsClient';
import WifiSelector from './WifiSelector';
import ClockInOutMileageModal from '../time/ClockInOutMileageModal';

// ─── Types ──────────────────────────────────────────────────────────────────

interface BatteryStatus {
  charging: boolean;
  percent: number;
  dischargingTime?: number | null; // seconds remaining; Infinity = unknown
}

type ConnectivityState = 'online' | 'offline' | 'degraded';

interface ConnectivityDetail {
  lastPingMs: number | null;
  latencyMs: number | null;
  wsConnected?: boolean;
}

interface GpsStatus {
  accuracyFt: number | null;
  source: 'device' | 'api' | null;
  lat?: number | null;
  lon?: number | null;
  altitudeFt?: number | null;
  heading?: number | null;
  speedMph?: number | null;
  timestamp?: number | null;
}

interface RadioChannel {
  id: number;
  name: string;
  description?: string | null;
  frequency?: string | null;
  talkgroup?: string | null;
  color?: string | null;
  sort_order?: number;
  tx_count?: number;
}

const RADIO_CHANNEL_KEY = 'rmpg_radio_channel_id';
const RADIO_CHANNEL_NAME_KEY = 'rmpg_radio_channel_name';

// ─── useTrayPolling ─────────────────────────────────────────────────────────

function useTrayPolling() {
  const [battery, setBattery] = useState<BatteryStatus | null>(null);
  const [connectivity, setConnectivity] = useState<ConnectivityState>('online');
  const [connectivityDetail, setConnectivityDetail] = useState<ConnectivityDetail>({ lastPingMs: null, latencyMs: null, wsConnected: false });
  const [gps, setGps] = useState<GpsStatus>({ accuracyFt: null, source: null });
  const [syncPending, setSyncPending] = useState(0);
  const [cpuPercent, setCpuPercent] = useState<number | null>(null);
  const [onDuty, setOnDuty] = useState<boolean | null>(null);
  const [dutyStartMs, setDutyStartMs] = useState<number | null>(null);
  const [radioChannel, setRadioChannel] = useState<string | null>(() =>
    localStorage.getItem(RADIO_CHANNEL_NAME_KEY) ?? null
  );
  const [radioChannelId, setRadioChannelId] = useState<number | null>(() => {
    const v = localStorage.getItem(RADIO_CHANNEL_KEY);
    return v ? parseInt(v, 10) : null;
  });

  const isElectron = !!(window as any).electron?.isElectron;

  // Battery: Electron IPC or Web Battery API
  useEffect(() => {
    const el = (window as any).electron;
    if (el?.isElectron && el?.getBatteryStatus) {
      let cancelled = false;
      const poll = async () => {
        try {
          const b: BatteryStatus = await el.getBatteryStatus();
          if (!cancelled) setBattery(b);
        } catch { /* silent */ }
      };
      poll();
      const id = setInterval(poll, 30_000);
      return () => { cancelled = true; clearInterval(id); };
    }
    const nav = navigator as any;
    if (!nav.getBattery) return;
    let cancelled = false;
    nav.getBattery().then((bm: any) => {
      if (cancelled) return;
      const update = () => {
        if (!cancelled) setBattery({
          charging: bm.charging,
          percent: Math.round(bm.level * 100),
          dischargingTime: bm.dischargingTime,
        });
      };
      update();
      bm.addEventListener('chargingchange', update);
      bm.addEventListener('levelchange', update);
      bm.addEventListener('dischargingtimechange', update);
    }).catch(() => { /* not available */ });
    return () => { cancelled = true; };
  }, []);

  // Network: browser online/offline events + API health probe every 30s
  useEffect(() => {
    const onOnline = () => setConnectivity('online');
    const onOffline = () => setConnectivity('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if (!navigator.onLine) setConnectivity('offline');

    let cancelled = false;
    const probe = async () => {
      if (!navigator.onLine) { if (!cancelled) setConnectivity('offline'); return; }
      const t0 = Date.now();
      try {
        const r = await fetch('https://api.rmpgutah.us/api/health', { signal: AbortSignal.timeout(4000) });
        const latency = Date.now() - t0;
        if (!cancelled) {
          setConnectivity(r.ok ? 'online' : 'degraded');
          setConnectivityDetail((d: ConnectivityDetail) => ({ ...d, lastPingMs: Date.now(), latencyMs: latency }));
        }
      } catch {
        if (!cancelled) {
          setConnectivity(navigator.onLine ? 'degraded' : 'offline');
          setConnectivityDetail((d: ConnectivityDetail) => ({ ...d, lastPingMs: Date.now(), latencyMs: null }));
        }
      }
    };
    probe();
    const id = setInterval(probe, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // GPS: full device Geolocation with coords, fallback to API last-known
  useEffect(() => {
    if (!navigator.geolocation) return;
    let cancelled = false;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!cancelled) setGps({
          accuracyFt: Math.round(pos.coords.accuracy * 3.28084),
          source: 'device',
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          altitudeFt: pos.coords.altitude != null ? Math.round(pos.coords.altitude * 3.28084) : null,
          heading: pos.coords.heading,
          speedMph: pos.coords.speed != null ? Math.round(pos.coords.speed * 2.23694) : null,
          timestamp: pos.timestamp,
        });
      },
      () => {
        apiFetch<{ accuracy?: number; latitude?: number; longitude?: number }>('/gps/my-location')
          .then(res => {
            if (!cancelled && res?.accuracy != null) {
              setGps({
                accuracyFt: Math.round(res.accuracy * 3.28084),
                source: 'api',
                lat: res.latitude ?? null,
                lon: res.longitude ?? null,
              });
            }
          }).catch(() => { /* silent */ });
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
    return () => { cancelled = true; navigator.geolocation.clearWatch(watchId); };
  }, []);

  // Electron-only: GPS hardware, sync queue, CPU
  useEffect(() => {
    const el = (window as any).electron;
    if (!el?.isElectron || !el?.checkGpsHardwarePresent) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await el.checkGpsHardwarePresent();
        const locked = typeof result === 'boolean' ? result : !!result?.present;
        if (!cancelled && locked) setGps((g: GpsStatus) => g.source === 'device' ? g : { accuracyFt: 0, source: 'device' });
      } catch { /* silent */ }
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    const el = (window as any).electron;
    if (!el?.isElectron || !el?.getOfflineWriteQueueSize) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const count: number = await el.getOfflineWriteQueueSize();
        if (!cancelled) setSyncPending(count ?? 0);
      } catch { /* silent */ }
    };
    poll();
    const id = setInterval(poll, 20_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    const el = (window as any).electron;
    if (!el?.isElectron || !el?.getCpuUsage) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const pct: number = await el.getCpuUsage();
        if (!cancelled) setCpuPercent(pct);
      } catch { /* silent */ }
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Shift status: poll every 5 min, also capture start time for elapsed display
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      apiFetch<{ active: boolean; entry?: { clock_in?: string } | null }>('/personnel/time/mine/active')
        .then(res => {
          if (!cancelled) {
            setOnDuty(res.active);
            if (res.active && res.entry?.clock_in) {
              setDutyStartMs(new Date(res.entry.clock_in).getTime());
            } else if (!res.active) {
              setDutyStartMs(null);
            }
          }
        })
        .catch(() => { /* silent */ });
    };
    poll();
    const id = setInterval(poll, 300_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Radio channel — load from unit assignment if no local override
  useEffect(() => {
    const localName = localStorage.getItem(RADIO_CHANNEL_NAME_KEY);
    if (localName) return; // officer already chose one this session
    apiFetch<{ radio_channel?: string; channel?: string }>('/dispatch/units/my-assignment')
      .then(res => {
        const name = res?.radio_channel ?? res?.channel ?? null;
        if (name) {
          setRadioChannel(name);
          localStorage.setItem(RADIO_CHANNEL_NAME_KEY, name);
        }
      })
      .catch(() => { /* silent */ });
  }, []);

  const selectChannel = useCallback((ch: RadioChannel) => {
    setRadioChannel(ch.name);
    setRadioChannelId(ch.id);
    localStorage.setItem(RADIO_CHANNEL_NAME_KEY, ch.name);
    localStorage.setItem(RADIO_CHANNEL_KEY, String(ch.id));
  }, []);

  return {
    battery, connectivity, connectivityDetail, gps,
    syncPending, cpuPercent, onDuty, setOnDuty, dutyStartMs,
    radioChannel, radioChannelId, selectChannel, isElectron,
  };
}

// ─── Shared panel shell ─────────────────────────────────────────────────────

function TrayPanel({ onClose, children, width = 260 }: {
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);
  return (
    <div ref={ref} style={{
      position: 'absolute', bottom: '100%', right: 0, marginBottom: 6,
      width, background: 'var(--surface-raised)', border: '1px solid var(--border-default)',
      boxShadow: '0 8px 32px rgba(0 0 0 / 0.55)', zIndex: 99990, padding: '10px 12px',
    }}>
      {children}
    </div>
  );
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--field-label-color)', letterSpacing: '0.09em', marginBottom: 8, textTransform: 'uppercase' }}>
      {children}
    </div>
  );
}

function PanelRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
      <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: 10, color: accent ? 'var(--sev-ok)' : 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

// ─── GPS Panel ──────────────────────────────────────────────────────────────

function GpsPanel({ gps, onClose }: { gps: GpsStatus; onClose: () => void }) {
  const accuracyFt = gps.accuracyFt ?? 0;
  const qualityLabel = accuracyFt <= 15 ? 'Excellent' : accuracyFt <= 30 ? 'Good' : accuracyFt <= 100 ? 'Fair' : 'Poor';
  const qualityColor = accuracyFt <= 30 ? 'var(--sev-ok)' : accuracyFt <= 100 ? 'var(--sev-warn)' : 'var(--sev-critical)';
  const fixAge = gps.timestamp ? Math.round((Date.now() - gps.timestamp) / 1000) : null;

  const copyCoords = () => {
    if (gps.lat != null && gps.lon != null) {
      navigator.clipboard?.writeText(`${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}`).catch(() => {});
    }
  };

  return (
    <TrayPanel onClose={onClose} width={240}>
      <PanelLabel>GPS Fix</PanelLabel>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <div style={{
          flex: 1, height: 4, background: 'var(--border-default)', borderRadius: 2, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: accuracyFt <= 15 ? '100%' : accuracyFt <= 30 ? '75%' : accuracyFt <= 100 ? '40%' : '15%',
            background: qualityColor, borderRadius: 2, transition: 'width 0.4s ease',
          }} />
        </div>
        <span style={{ fontSize: 9, fontWeight: 700, color: qualityColor, whiteSpace: 'nowrap' }}>{qualityLabel}</span>
      </div>
      <PanelRow label="Accuracy" value={`±${accuracyFt} ft`} />
      <PanelRow label="Source" value={gps.source === 'device' ? 'Device GPS' : 'Server last-known'} />
      {gps.lat != null && gps.lon != null && (
        <div
          onClick={copyCoords}
          title="Click to copy coordinates"
          style={{
            fontSize: 9, color: 'var(--text-secondary)', marginTop: 6,
            padding: '4px 6px', background: 'var(--surface-sunken)', cursor: 'copy',
            borderRadius: 2, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em',
          }}
        >
          {gps.lat.toFixed(6)}, {gps.lon.toFixed(6)}
        </div>
      )}
      {gps.altitudeFt != null && <PanelRow label="Altitude" value={`${gps.altitudeFt} ft`} />}
      {gps.speedMph != null && <PanelRow label="Speed" value={`${gps.speedMph} mph`} />}
      {gps.heading != null && <PanelRow label="Heading" value={`${Math.round(gps.heading)}°`} />}
      {fixAge != null && <PanelRow label="Fix age" value={fixAge < 5 ? 'Live' : `${fixAge}s ago`} accent={fixAge < 10} />}
    </TrayPanel>
  );
}

// ─── Radio Channel Panel ────────────────────────────────────────────────────

function RadioChannelPanel({
  currentName, currentId, onSelect, onClose,
}: {
  currentName: string | null;
  currentId: number | null;
  onSelect: (ch: RadioChannel) => void;
  onClose: () => void;
}) {
  const [channels, setChannels] = useState<RadioChannel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<RadioChannel[]>('/radio/channels')
      .then(list => setChannels(Array.isArray(list) ? list : []))
      .catch(() => setChannels([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <TrayPanel onClose={onClose} width={220}>
      <PanelLabel>Radio Channel</PanelLabel>
      {loading ? (
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', padding: '4px 0' }}>Loading channels…</div>
      ) : channels.length === 0 ? (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 0' }}>No channels configured</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {channels.map((ch: RadioChannel) => {
            const active = ch.id === currentId || ch.name === currentName;
            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => { onSelect(ch); onClose(); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 7px', borderRadius: 2, border: 'none', cursor: 'pointer', textAlign: 'left',
                  background: active ? 'rgba(var(--sev-ok-rgb),0.12)' : 'transparent',
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { (e.currentTarget as HTMLElement).style.background = active ? 'rgba(var(--sev-ok-rgb),0.12)' : 'transparent'; }}
              >
                {ch.color ? (
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: ch.color, flexShrink: 0 }} />
                ) : (
                  <Radio style={{ width: 10, height: 10, color: active ? 'var(--sev-ok)' : 'var(--text-secondary)', flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: active ? 'var(--sev-ok)' : 'var(--text-primary)', fontWeight: active ? 700 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {ch.name}
                  </div>
                  {ch.frequency && (
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{ch.frequency}</div>
                  )}
                </div>
                {active && (
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--sev-ok)', flexShrink: 0 }} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </TrayPanel>
  );
}

// ─── Connectivity Panel ─────────────────────────────────────────────────────

function ConnectivityPanel({ detail, connectivity, onClose }: {
  detail: ConnectivityDetail;
  connectivity: ConnectivityState;
  onClose: () => void;
}) {
  const lastPingStr = detail.lastPingMs
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(new Date(detail.lastPingMs)) // new-date-ok — epoch ms
    : '—';

  const latencyLabel =
    detail.latencyMs == null ? '—' :
    detail.latencyMs < 100  ? `${detail.latencyMs} ms ✓` :
    detail.latencyMs < 300  ? `${detail.latencyMs} ms` :
    `${detail.latencyMs} ms ⚠`;

  const statusColor =
    connectivity === 'online'   ? 'var(--sev-ok)' :
    connectivity === 'degraded' ? 'var(--sev-warn)' :
    'var(--sev-critical)';

  return (
    <TrayPanel onClose={onClose} width={240}>
      <PanelLabel>Network Status</PanelLabel>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor }} />
        <span style={{ fontSize: 10, color: statusColor, fontWeight: 700, textTransform: 'capitalize' }}>{connectivity}</span>
      </div>
      <PanelRow label="Endpoint" value="api.rmpgutah.us" />
      <PanelRow label="Last probe" value={lastPingStr} />
      <PanelRow label="Latency" value={latencyLabel} />
      <PanelRow label="Browser" value={navigator.onLine ? 'Online' : 'Offline'} />
      {detail.wsConnected !== undefined && (
        <PanelRow label="WebSocket" value={detail.wsConnected ? 'Connected' : 'Disconnected'} />
      )}
    </TrayPanel>
  );
}

// ─── Battery helpers ─────────────────────────────────────────────────────────

function BatteryIcon({ battery }: { battery: BatteryStatus }) {
  if (battery.charging) return <BatteryCharging className="w-3.5 h-3.5" style={{ color: 'var(--sev-ok)' }} />;
  if (battery.percent <= 10) return <BatteryWarning className="w-3.5 h-3.5" style={{ color: 'var(--sev-critical)' }} />;
  if (battery.percent <= 20) return <BatteryLow className="w-3.5 h-3.5" style={{ color: 'var(--sev-critical)' }} />;
  if (battery.percent <= 40) return <BatteryLow className="w-3.5 h-3.5" style={{ color: 'var(--sev-warn)' }} />;
  if (battery.percent <= 70) return <BatteryMedium className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />;
  return <BatteryFull className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />;
}

function batteryColor(battery: BatteryStatus): string {
  if (battery.charging) return 'var(--sev-ok)';
  if (battery.percent <= 20) return 'var(--sev-critical)';
  if (battery.percent <= 40) return 'var(--sev-warn)';
  return 'var(--text-secondary)';
}

function batteryTitle(battery: BatteryStatus): string {
  const base = `Battery: ${battery.percent}%${battery.charging ? ' (charging)' : ''}`;
  if (!battery.charging && battery.dischargingTime && isFinite(battery.dischargingTime)) {
    const hrs = Math.floor(battery.dischargingTime / 3600);
    const min = Math.floor((battery.dischargingTime % 3600) / 60);
    return `${base} — ~${hrs}h ${min}m remaining`;
  }
  return base;
}

// ─── GPS color helper ────────────────────────────────────────────────────────

function gpsAccuracyColor(ft: number): string {
  if (ft <= 30) return 'var(--sev-ok)';
  if (ft <= 100) return 'var(--sev-warn)';
  return 'var(--sev-critical)';
}

// ─── Duty elapsed time ───────────────────────────────────────────────────────

function useDutyElapsed(dutyStartMs: number | null): string | null {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!dutyStartMs) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [dutyStartMs]);
  if (!dutyStartMs) return null;
  const ms = now - dutyStartMs;
  const totalMin = Math.floor(ms / 60_000);
  const hrs = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return hrs > 0 ? `${hrs}h ${min}m` : `${min}m`;
}

// ─── Main component ──────────────────────────────────────────────────────────

export interface DesktopSystemTrayProps {
  className?: string;
}

export default function DesktopSystemTray({ className }: DesktopSystemTrayProps) {
  const navigate = useNavigate();
  const {
    battery, connectivity, connectivityDetail, gps,
    syncPending, cpuPercent, onDuty, setOnDuty, dutyStartMs,
    radioChannel, radioChannelId, selectChannel, isElectron,
  } = useTrayPolling();
  const { user } = useAuth();
  const { addToast } = useToast();
  const [gpsPanelOpen, setGpsPanelOpen] = useState(false);
  const [radioPanelOpen, setRadioPanelOpen] = useState(false);
  const [connPanelOpen, setConnPanelOpen] = useState(false);
  const [wifiSelectorOpen, setWifiSelectorOpen] = useState(false);
  const [clockMileageModalOpen, setClockMileageModalOpen] = useState(false);

  const dutyElapsed = useDutyElapsed(dutyStartMs);

  const toggleDuty = useCallback(() => {
    if (!user?.id) return;
    setClockMileageModalOpen(true);
  }, [user]);

  return (
    <div
      className={className}
      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
      role="status"
      aria-label="System status"
    >
      {/* Sync queue — Electron only */}
      {isElectron && syncPending > 0 && (
        <div
          title={`${syncPending} item${syncPending !== 1 ? 's' : ''} queued for sync`}
          style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'default' }}
        >
          <RefreshCw className="w-3 h-3 animate-spin" style={{ color: 'var(--sev-warn)' }} />
          <span style={{ fontSize: 9, color: 'var(--sev-warn)', fontVariantNumeric: 'tabular-nums' }}>{syncPending}</span>
        </div>
      )}

      {/* GPS accuracy — click to open coordinate detail panel */}
      {gps.accuracyFt != null && (
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => { setGpsPanelOpen((v: boolean) => !v); setRadioPanelOpen(false); setConnPanelOpen(false); }}
            title={`GPS ${gps.source === 'device' ? 'lock' : 'last known'}: ±${gps.accuracyFt} ft — click for detail`}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 2 }}
            aria-label="GPS accuracy"
          >
            <Satellite
              className="w-3 h-3"
              style={{ color: gps.source === 'device' ? gpsAccuracyColor(gps.accuracyFt) : 'var(--text-secondary)' }}
            />
            <span style={{ fontSize: 9, color: gpsAccuracyColor(gps.accuracyFt), fontVariantNumeric: 'tabular-nums' }}>
              ±{gps.accuracyFt}ft
            </span>
          </button>
          {gpsPanelOpen && (
            <GpsPanel gps={gps} onClose={() => setGpsPanelOpen(false)} />
          )}
        </div>
      )}

      {/* Radio channel — click to switch channels */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => { setRadioPanelOpen((v: boolean) => !v); setGpsPanelOpen(false); setConnPanelOpen(false); }}
          title={radioChannel ? `Radio: ${radioChannel} — click to change` : 'Radio channel — click to select'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 2 }}
          aria-label={`Radio channel: ${radioChannel ?? 'none'}`}
        >
          <Radio className="w-3 h-3" style={{ color: radioChannel ? 'var(--accent-silver-400, var(--text-secondary))' : 'var(--text-muted)' }} />
          {radioChannel && (
            <span style={{ fontSize: 9, color: 'var(--text-secondary)', maxWidth: 88, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {radioChannel}
            </span>
          )}
        </button>
        {radioPanelOpen && (
          <RadioChannelPanel
            currentName={radioChannel}
            currentId={radioChannelId}
            onSelect={(ch) => {
              selectChannel(ch);
              addToast(`Switched to ${ch.name}`, 'info');
            }}
            onClose={() => setRadioPanelOpen(false)}
          />
        )}
      </div>

      {/* CPU — Electron, elevated only */}
      {isElectron && cpuPercent != null && cpuPercent >= 70 && (
        <div
          title={`CPU: ${cpuPercent}%`}
          style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'default' }}
        >
          <Cpu
            className="w-3 h-3"
            style={{ color: cpuPercent >= 90 ? 'var(--sev-critical)' : 'var(--sev-warn)' }}
          />
          <span style={{ fontSize: 9, color: cpuPercent >= 90 ? 'var(--sev-critical)' : 'var(--sev-warn)', fontVariantNumeric: 'tabular-nums' }}>
            {cpuPercent}%
          </span>
        </div>
      )}

      {/* Network — Electron: WifiSelector; browser: ConnectivityPanel */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          title={
            connectivity === 'online'   ? (isElectron ? 'Wi-Fi — click to manage' : 'Online — click for details')
            : connectivity === 'degraded' ? 'Network degraded — click for details'
            : 'Offline — click for details'
          }
          onClick={() => {
            if (isElectron) {
              setWifiSelectorOpen((v: boolean) => !v);
            } else {
              setConnPanelOpen((v: boolean) => !v);
              setGpsPanelOpen(false);
              setRadioPanelOpen(false);
            }
          }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
          aria-label={connectivity === 'online' ? 'Online' : connectivity === 'degraded' ? 'Network degraded' : 'Offline'}
        >
          {connectivity === 'online' ? (
            <Wifi className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
          ) : connectivity === 'degraded' ? (
            <Wifi className="w-3.5 h-3.5" style={{ color: 'var(--sev-warn)' }} />
          ) : (
            <WifiOff className="w-3.5 h-3.5" style={{ color: 'var(--sev-critical)' }} />
          )}
        </button>
        {wifiSelectorOpen && (
          <WifiSelector onClose={() => setWifiSelectorOpen(false)} />
        )}
        {connPanelOpen && (
          <ConnectivityPanel
            detail={connectivityDetail}
            connectivity={connectivity}
            onClose={() => setConnPanelOpen(false)}
          />
        )}
      </div>

      {/* Signal / Device Scanner — Electron only: navigate to scanner */}
      {isElectron && (
        <button
          type="button"
          title="Device Capture Scanner — scan surrounding devices"
          onClick={() => navigate('/device-scanner')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
          aria-label="Device capture scanner"
        >
          <Signal className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
        </button>
      )}

      {/* Battery */}
      {battery != null && (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'default' }}
          title={batteryTitle(battery)}
        >
          <BatteryIcon battery={battery} />
          <span style={{ fontSize: 9, color: batteryColor(battery), fontVariantNumeric: 'tabular-nums' }}>
            {battery.percent}%
          </span>
        </div>
      )}

      {/* Shift status badge — click opens clock-in/out with mileage */}
      {onDuty !== null && (
        <button
          type="button"
          onClick={toggleDuty}
          title={onDuty
            ? `On duty${dutyElapsed ? ` — ${dutyElapsed}` : ''} — click to clock out`
            : 'Off duty — click to clock in'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', gap: 3,
          }}
        >
          <span style={{
            fontSize: 8, fontWeight: 700, letterSpacing: '0.06em',
            padding: '2px 5px', borderRadius: 2, whiteSpace: 'nowrap',
            background: onDuty ? 'rgba(var(--sev-ok-rgb),0.15)' : 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.12)',
            color: onDuty ? 'var(--sev-ok)' : 'var(--text-muted)',
            border: `1px solid ${onDuty ? 'rgba(var(--sev-ok-rgb),0.3)' : 'var(--border-subtle)'}`,
          }}>
            {onDuty ? 'ON DUTY' : 'OFF DUTY'}
          </span>
          {onDuty && dutyElapsed && (
            <span style={{ fontSize: 8, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              {dutyElapsed}
            </span>
          )}
        </button>
      )}

      {/* Clock In / Clock Out Mileage Modal */}
      {clockMileageModalOpen && user?.id && (
        <ClockInOutMileageModal
          isOpen={clockMileageModalOpen}
          isClockingOut={!!onDuty}
          officerId={user.id}
          onClose={() => setClockMileageModalOpen(false)}
          onSuccess={(punch) => {
            const wasOnDuty = onDuty;
            setOnDuty((v: boolean | null) => !v);
            setClockMileageModalOpen(false);
            if (!wasOnDuty) {
              addToast('Clocked in — starting mileage recorded & vehicle assigned', 'success');
              toastClockLinkWarnings(addToast, punch as ClockLinkFlags);
            } else {
              addToast('Clocked out — ending mileage recorded & DAR generated', 'success');
            }
          }}
        />
      )}
    </div>
  );
}
