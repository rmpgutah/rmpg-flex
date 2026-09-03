import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { Wifi, WifiOff, Battery, BatteryCharging, BatteryLow, Navigation, RefreshCw, Cpu, Satellite, Radio } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../ToastProvider';
import { toastClockLinkWarnings, type ClockLinkFlags } from '../../utils/corporateOpsClient';
import WifiSelector from './WifiSelector';
import ClockInOutMileageModal from '../time/ClockInOutMileageModal';

interface BatteryStatus {
  charging: boolean;
  percent: number;
}

type ConnectivityState = 'online' | 'offline' | 'degraded';

interface ConnectivityDetail {
  lastPingMs: number | null;
  latencyMs: number | null;
}

interface GpsStatus {
  accuracyFt: number | null;
  source: 'device' | 'api' | null;
}

function useTrayPolling() {
  const [battery, setBattery] = useState<BatteryStatus | null>(null);
  const [connectivity, setConnectivity] = useState<ConnectivityState>('online');
  const [connectivityDetail, setConnectivityDetail] = useState<ConnectivityDetail>({ lastPingMs: null, latencyMs: null });
  const [gps, setGps] = useState<GpsStatus>({ accuracyFt: null, source: null });
  const [syncPending, setSyncPending] = useState(0);
  const [cpuPercent, setCpuPercent] = useState<number | null>(null);
  const [onDuty, setOnDuty] = useState<boolean | null>(null);
  const [radioChannel, setRadioChannel] = useState<string | null>(null);

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
      const id = setInterval(poll, 60_000);
      return () => { cancelled = true; clearInterval(id); };
    }
    // Web Battery API (Chrome/Edge)
    const nav = navigator as any;
    if (!nav.getBattery) return;
    let cancelled = false;
    nav.getBattery().then((bm: any) => {
      if (cancelled) return;
      const update = () => {
        if (!cancelled) setBattery({ charging: bm.charging, percent: Math.round(bm.level * 100) });
      };
      update();
      bm.addEventListener('chargingchange', update);
      bm.addEventListener('levelchange', update);
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
          setConnectivityDetail({ lastPingMs: Date.now(), latencyMs: latency });
        }
      } catch {
        if (!cancelled) {
          setConnectivity(navigator.onLine ? 'degraded' : 'offline');
          setConnectivityDetail(d => ({ ...d, lastPingMs: Date.now(), latencyMs: null }));
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

  // GPS: device Geolocation API, fallback to API last-known
  useEffect(() => {
    if (!navigator.geolocation) return;
    let cancelled = false;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!cancelled) setGps({ accuracyFt: Math.round(pos.coords.accuracy * 3.28084), source: 'device' });
      },
      () => {
        // On device error, poll API for last-known position
        apiFetch<{ accuracy?: number }>('/gps/my-location').then(res => {
          if (!cancelled && res?.accuracy != null) {
            setGps({ accuracyFt: Math.round(res.accuracy * 3.28084), source: 'api' });
          }
        }).catch(() => { /* silent */ });
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
    return () => { cancelled = true; navigator.geolocation.clearWatch(watchId); };
  }, []);

  // Electron-only: GPS hardware presence, sync queue, CPU
  useEffect(() => {
    const el = (window as any).electron;
    if (!el?.isElectron || !el?.checkGpsHardwarePresent) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await el.checkGpsHardwarePresent();
        const locked = typeof result === 'boolean' ? result : !!result?.present;
        if (!cancelled && locked) setGps(g => g.source === 'device' ? g : { accuracyFt: 0, source: 'device' });
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

  // Shift status: poll every 5 min
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      apiFetch<{ active: boolean }>('/personnel/time/mine/active')
        .then(res => { if (!cancelled) setOnDuty(res.active); })
        .catch(() => { /* silent */ });
    };
    poll();
    const id = setInterval(poll, 300_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Radio channel from unit assignment
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ radio_channel?: string; channel?: string }>('/dispatch/units/my-assignment')
      .then(res => {
        if (!cancelled) setRadioChannel(res?.radio_channel ?? res?.channel ?? null);
      })
      .catch(() => { /* silent */ });
  }, []);

  return { battery, connectivity, connectivityDetail, gps, syncPending, cpuPercent, onDuty, setOnDuty, radioChannel, isElectron };
}

function BatteryIcon({ battery }: { battery: BatteryStatus }) {
  if (battery.charging) return <BatteryCharging className="w-3.5 h-3.5" style={{ color: 'var(--sev-ok)' }} />;
  if (battery.percent <= 15) return <BatteryLow className="w-3.5 h-3.5" style={{ color: 'var(--sev-critical)' }} />;
  return <Battery className="w-3.5 h-3.5" style={{ color: battery.percent > 30 ? 'var(--text-secondary)' : 'var(--sev-high)' }} />;
}

function GpsAccuracyColor(ft: number): string {
  if (ft <= 30) return 'var(--sev-ok)';
  if (ft <= 100) return 'var(--sev-warn)';
  return 'var(--sev-critical)';
}

function ConnectivityPanel({ detail, onClose }: {
  detail: { lastPingMs: number | null; latencyMs: number | null };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  const lastPingStr = detail.lastPingMs
    ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(detail.lastPingMs)) // new-date-ok — epoch ms, not a server timestamp string
    : '—';

  return (
    <div ref={ref} style={{
      position: 'absolute', bottom: '100%', right: 0, marginBottom: 6,
      width: 240, background: 'var(--surface-raised)', border: '1px solid var(--border-default)',
      boxShadow: '0 8px 24px rgba(0 0 0 / 0.5)', zIndex: 99990, padding: 12,
    }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em', marginBottom: 8 }}>API CONNECTIVITY</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Row label="Endpoint" value="api.rmpgutah.us" />
        <Row label="Last ping" value={lastPingStr} />
        <Row label="Latency" value={detail.latencyMs != null ? `${detail.latencyMs} ms` : '—'} />
        <Row label="Status" value={navigator.onLine ? 'Online' : 'Offline'} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: 10, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

export interface DesktopSystemTrayProps {
  className?: string;
}

export default function DesktopSystemTray({ className }: DesktopSystemTrayProps) {
  const navigate = useNavigate();
  const { battery, connectivity, connectivityDetail, gps, syncPending, cpuPercent, onDuty, setOnDuty, radioChannel, isElectron } = useTrayPolling();
  const { user } = useAuth();
  const { addToast } = useToast();
  const [connPanelOpen, setConnPanelOpen]   = useState(false);
  const [wifiSelectorOpen, setWifiSelectorOpen] = useState(false);
  const [clockMileageModalOpen, setClockMileageModalOpen] = useState(false);
  const dutyBusyRef = useRef(false);

  const toggleDuty = useCallback(() => {
    if (!user?.id || dutyBusyRef.current) return;
    setClockMileageModalOpen(true);
  }, [user]);

  return (
    <div
      className={className}
      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
      role="status"
      aria-label="System status"
    >
      {/* Sync queue indicator — Electron only */}
      {isElectron && syncPending > 0 && (
        <div
          title={`${syncPending} item${syncPending !== 1 ? 's' : ''} queued for sync`}
          style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'default' }}
        >
          <RefreshCw className="w-3 h-3 animate-spin" style={{ color: 'var(--sev-warn)' }} />
          <span style={{ fontSize: 9, color: 'var(--sev-warn)', fontVariantNumeric: 'tabular-nums' }}>{syncPending}</span>
        </div>
      )}

      {/* GPS accuracy indicator */}
      {gps.accuracyFt != null && (
        <div
          title={`GPS ${gps.source === 'device' ? 'lock' : 'last known'}: ±${gps.accuracyFt} ft`}
          style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'default' }}
        >
          <Satellite
            className="w-3 h-3"
            style={{ color: gps.source === 'device' ? GpsAccuracyColor(gps.accuracyFt) : 'var(--text-secondary)' }}
          />
          <span style={{ fontSize: 9, color: GpsAccuracyColor(gps.accuracyFt), fontVariantNumeric: 'tabular-nums' }}>
            ±{gps.accuracyFt}ft
          </span>
        </div>
      )}

      {/* Radio channel */}
      {radioChannel && (
        <div
          title={`Radio: ${radioChannel}`}
          style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'default' }}
        >
          <Radio className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
          <span style={{ fontSize: 9, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{radioChannel}</span>
        </div>
      )}

      {/* CPU usage — only when elevated (>70%) — Electron only */}
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

      {/* Network — Electron: opens WifiSelector; browser: opens ConnectivityPanel */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          title={
            connectivity === 'online'   ? (isElectron ? 'Wi-Fi — click to manage' : 'Online — click for details')
            : connectivity === 'degraded' ? 'Network degraded'
            : 'Offline'
          }
          onClick={() => isElectron ? setWifiSelectorOpen(v => !v) : setConnPanelOpen(v => !v)}
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
          <ConnectivityPanel detail={connectivityDetail} onClose={() => setConnPanelOpen(false)} />
        )}
      </div>

      {/* Device Scanner — Electron only */}
      {isElectron && (
        <button
          type="button"
          title="Device Capture Scanner — scan surrounding devices"
          onClick={() => navigate('/device-scanner')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
          aria-label="Device capture scanner"
        >
          <Radio className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
        </button>
      )}

      {/* Battery */}
      {battery != null && (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 2 }}
          title={`Battery: ${battery.percent}%${battery.charging ? ' (charging)' : ''}`}
        >
          <BatteryIcon battery={battery} />
          <span style={{ fontSize: 9, color: battery.percent <= 15 ? 'var(--sev-critical)' : 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
            {battery.percent}%
          </span>
        </div>
      )}

      {/* Shift status badge */}
      {onDuty !== null && (
        <button
          type="button"
          onClick={toggleDuty}
          title={onDuty ? 'On duty — click to clock out' : 'Off duty — click to clock in'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center',
          }}
        >
          <span style={{
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: '0.06em',
            padding: '2px 5px',
            borderRadius: 2,
            background: onDuty ? 'rgba(var(--sev-ok-rgb),0.15)' : 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.12)',
            color: onDuty ? 'var(--sev-ok)' : 'var(--text-muted)',
            border: `1px solid ${onDuty ? 'rgba(var(--sev-ok-rgb),0.3)' : 'var(--border-subtle)'}`,
            whiteSpace: 'nowrap',
          }}>
            {onDuty ? 'ON DUTY' : 'OFF DUTY'}
          </span>
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
            setOnDuty(v => !v);
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
